#!/usr/bin/env node
/**
 * Prepara os bundles do pdf.js para serem embarcados no app.
 *
 * O `pdfjs-dist` só publica builds em ES module (`.mjs`). Dentro da WebView nós
 * precisamos carregar o código como *classic script* inline, porque:
 *
 *   - `<script type="module" src="file://...">` é bloqueado por CORS no WebView
 *     do Android (origem `null`);
 *   - um módulo inline não expõe seus bindings para o restante da página.
 *
 * Felizmente o build `legacy` já publica `globalThis.pdfjsLib` e
 * `globalThis.pdfjsWorker`, então basta tornar o arquivo válido como script
 * clássico. Duas transformações são necessárias:
 *
 *   1. remover a declaração `export{...}` final (ilegal fora de um módulo);
 *   2. substituir `import.meta.url` (também ilegal, e usado apenas em ramos
 *      exclusivos de Node.js que nunca executam na WebView).
 *
 * Com `globalThis.pdfjsWorker` definido, o pdf.js usa o *main thread worker* e
 * não tenta criar um `Worker`, o que evita qualquer problema de origem/CORS.
 *
 * O resultado é gravado em `assets/pdfjs/*.pdfjsbundle` (ver metro.config.js).
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const outDir = path.join(projectRoot, 'assets', 'pdfjs');

/** Remove a declaração `export{...}` final de um bundle ESM minificado. */
export function stripTrailingExport(source) {
  const trailingExport = /export\s*\{[^{}]*\}\s*;?\s*$/;
  if (!trailingExport.test(source)) {
    throw new Error('Bundle do pdf.js sem `export{...}` final: formato inesperado.');
  }
  return source.replace(trailingExport, '\n');
}

/**
 * Neutraliza `import.meta`, que é um erro de sintaxe em scripts clássicos.
 * Todas as ocorrências estão em código específico de Node.js (carregamento do
 * `@napi-rs/canvas` e do OpenJPEG), que nunca roda no navegador.
 */
export function neutralizeImportMeta(source) {
  return source.replace(/import\.meta\.url/g, '""').replace(/import\.meta/g, '({url:""})');
}

/**
 * Envolve o bundle em uma IIFE. Scripts clássicos compartilham o escopo léxico
 * global, e os dois bundles minificados usam os mesmos nomes de variável no
 * topo (`Rt`, `E`, ...) — sem o isolamento o segundo script falha com
 * "Identifier 'Rt' has already been declared". Os globais que nos interessam
 * (`globalThis.pdfjsLib` e `globalThis.pdfjsWorker`) são atribuídos
 * explicitamente pelo próprio bundle, então continuam visíveis.
 */
export function wrapInIife(source) {
  return `;(function(){\n${source}\n})();\n`;
}

export function toClassicScript(source) {
  return wrapInIife(neutralizeImportMeta(stripTrailingExport(source)));
}

function resolveDistFile(relative) {
  return require.resolve(`pdfjs-dist/legacy/build/${relative}`);
}

function main() {
  fs.mkdirSync(outDir, { recursive: true });

  const targets = [
    { input: 'pdf.min.mjs', output: 'pdf.lib.pdfjsbundle', expectGlobal: 'globalThis.pdfjsLib' },
    {
      input: 'pdf.worker.min.mjs',
      output: 'pdf.worker.pdfjsbundle',
      expectGlobal: 'globalThis.pdfjsWorker',
    },
  ];

  for (const target of targets) {
    const source = fs.readFileSync(resolveDistFile(target.input), 'utf8');
    if (!source.includes(target.expectGlobal)) {
      throw new Error(
        `${target.input} não define ${target.expectGlobal}; a versão do pdfjs-dist é incompatível.`
      );
    }
    const classic = toClassicScript(source);
    // `new Function` valida a sintaxe como script clássico sem executar o código.
    // eslint-disable-next-line no-new-func
    new Function(classic);
    fs.writeFileSync(path.join(outDir, target.output), classic, 'utf8');
    const kb = Math.round(Buffer.byteLength(classic) / 1024);
    console.log(`pdf.js › ${target.output} (${kb} KB)`);
  }

  const version = require('pdfjs-dist/package.json').version;
  fs.writeFileSync(
    path.join(outDir, 'version.json'),
    `${JSON.stringify({ pdfjs: version }, null, 2)}\n`,
    'utf8'
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  main();
}
