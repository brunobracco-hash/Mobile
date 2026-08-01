import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

import { buildExtractorHtml } from '../src/core/pdf/extractorPage';
import { chunkBase64, parseExtractorMessage } from '../src/core/pdf/protocol';
import type { ExtractorOutboundMessage } from '../src/core/pdf/protocol';
import { buildChunks } from '../src/core/text/chunk';
import { detectLanguage } from '../src/core/text/language';
import { normalizePdfPages } from '../src/core/text/normalize';
import { makePdf, toBase64 } from './fixtures/makePdf';

/**
 * Teste de ponta a ponta da página do extrator: carrega o mesmo HTML que a
 * WebView do app carrega, entrega o PDF em pedaços base64 pela mesma API e
 * verifica as mensagens de volta. Roda em Chromium, que é o motor da WebView do
 * Android e um bom substituto para o WKWebView do iOS.
 */

const assetsDir = path.resolve(__dirname, '..', 'assets', 'pdfjs');

/** Coletor injetado na página no lugar de `window.ReactNativeWebView`. */
const TEST_SINK = `<script>
  window.__vozpdfMessages = [];
  window.__vozpdfTestSink = function (raw) { window.__vozpdfMessages.push(raw); };
</script>`;

function readBundles() {
  const lib = path.join(assetsDir, 'pdf.lib.pdfjsbundle');
  const worker = path.join(assetsDir, 'pdf.worker.pdfjsbundle');
  if (!fs.existsSync(lib) || !fs.existsSync(worker)) {
    throw new Error('Bundles do pdf.js ausentes. Rode `npm run prepare:pdfjs` antes dos testes.');
  }
  return {
    libSource: fs.readFileSync(lib, 'utf8'),
    workerSource: fs.readFileSync(worker, 'utf8'),
  };
}

async function readMessages(page: Page): Promise<ExtractorOutboundMessage[]> {
  const raw = await page.evaluate(
    () => (window as unknown as { __vozpdfMessages: string[] }).__vozpdfMessages
  );
  return raw
    .map(parseExtractorMessage)
    .filter((message): message is ExtractorOutboundMessage => message !== null);
}

describe('página do extrator de PDF', () => {
  let browser: Browser;
  let html: string;

  beforeAll(async () => {
    // O sink de teste precisa existir antes dos bundles, porque a mensagem
    // `ready` é emitida durante o carregamento da página.
    html = buildExtractorHtml(readBundles()).replace('<body>', `<body>\n${TEST_SINK}`);
    // Permite apontar para um Chromium já instalado no ambiente.
    const executablePath = process.env.CHROMIUM_PATH;
    browser = await chromium.launch(executablePath ? { executablePath } : {});
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
  });

  async function extract(
    pdfBytes: Uint8Array,
    options: { password?: string; chunkSize?: number } = {}
  ) {
    const { password, chunkSize } = options;
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await page.setContent(html, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as unknown as { VozPDF?: unknown }).VozPDF));

    for (const chunk of chunkBase64(toBase64(pdfBytes), chunkSize)) {
      await page.evaluate(
        (value) => (window as unknown as { VozPDF: { push(c: string): void } }).VozPDF.push(value),
        chunk
      );
    }

    await page.evaluate(
      (args) =>
        (
          window as unknown as { VozPDF: { extract(id: string, password?: string): void } }
        ).VozPDF.extract(args.id, args.password),
      { id: 'req-1', password }
    );

    await page.waitForFunction(
      () =>
        (window as unknown as { __vozpdfMessages: string[] }).__vozpdfMessages.some((raw) =>
          /"type":"(done|error)"/.test(raw)
        ),
      undefined,
      { timeout: 30_000 }
    );

    const messages = await readMessages(page);
    await page.close();
    return { messages, pageErrors };
  }

  it('carrega o pdf.js como script clássico, sem worker e sem erros de sintaxe', async () => {
    const pdf = await makePdf([['Ola mundo']]);
    const { messages, pageErrors } = await extract(pdf);

    expect(pageErrors).toEqual([]);
    const ready = messages.find((m) => m.type === 'ready');
    expect(ready).toBeDefined();
    expect(ready && ready.type === 'ready' && ready.pdfjsVersion).toMatch(/^\d+\.\d+\.\d+$/);
  }, 120_000);

  it('extrai o texto de todas as páginas, na ordem, com título do documento', async () => {
    const pdf = await makePdf(
      [
        ['A leitura em voz alta', 'comeca aqui.'],
        ['Segunda pagina do', 'documento de teste.'],
        ['Terceira e ultima.'],
      ],
      { title: 'Documento de teste' }
    );

    const { messages } = await extract(pdf);

    expect(messages.find((m) => m.type === 'error')).toBeUndefined();

    const meta = messages.find((m) => m.type === 'meta');
    expect(meta && meta.type === 'meta' && meta.pages).toBe(3);
    expect(meta && meta.type === 'meta' && meta.title).toBe('Documento de teste');

    const pageTexts = messages.filter((m) => m.type === 'pageText');
    expect(pageTexts.map((m) => (m.type === 'pageText' ? m.page : 0))).toEqual([1, 2, 3]);

    const joined = pageTexts.map((m) => (m.type === 'pageText' ? m.text : '')).join('\n');
    expect(joined).toContain('A leitura em voz alta');
    expect(joined).toContain('Segunda pagina do');
    expect(joined).toContain('Terceira e ultima.');

    const done = messages.find((m) => m.type === 'done');
    expect(done && done.type === 'done' && done.pages).toBe(3);
  }, 120_000);

  it('remonta o arquivo quando ele chega em vários pedaços pela ponte', async () => {
    const pages = Array.from({ length: 40 }, (_, index) => [
      `Pagina numero ${index + 1}`,
      'Texto suficiente para o arquivo passar de um pedaco base64.',
    ]);
    const pdf = await makePdf(pages);
    const chunkSize = 8 * 1024;
    expect(chunkBase64(toBase64(pdf), chunkSize).length).toBeGreaterThan(1);

    const { messages } = await extract(pdf, { chunkSize });

    expect(messages.find((m) => m.type === 'error')).toBeUndefined();
    expect(messages.filter((m) => m.type === 'pageText')).toHaveLength(40);
    const last = messages.find((m) => m.type === 'pageText' && m.page === 40);
    expect(last && last.type === 'pageText' && last.text).toContain('Pagina numero 40');
  }, 120_000);

  it('alimenta o pipeline completo: PDF real → texto limpo → trechos → idioma', async () => {
    // Um documento com as marcas típicas de um PDF de verdade: cabeçalho
    // repetido, número de página e parágrafos quebrados na largura da coluna.
    const body = [
      'A independencia do Brasil nao foi um acontecimento isolado, mas o',
      'resultado de um longo processo politico que envolveu disputas entre as',
      'elites locais e a corte portuguesa ao longo de muitas decadas.',
      'Quando a familia real chegou ao Rio de Janeiro, muita coisa ja estava em',
      'movimento, e as provincias do norte reagiram de maneira bastante',
      'diferente das provincias do sul do pais.',
    ];
    const pages = Array.from({ length: 5 }, (_, index) => [
      'HISTORIA DO BRASIL',
      ...body,
      String(index + 1),
    ]);

    const { messages } = await extract(await makePdf(pages));
    const extracted = messages
      .filter((m) => m.type === 'pageText')
      .map((m) => (m.type === 'pageText' ? m.text : ''));
    expect(extracted).toHaveLength(5);

    const text = normalizePdfPages(extracted);

    // O cabeçalho corrente e a numeração de página não devem ser narrados.
    expect(text).not.toContain('HISTORIA DO BRASIL');
    expect(text).not.toMatch(/^\d+$/m);
    // As linhas quebradas pela largura da coluna viraram frases contínuas.
    expect(text).toContain('processo politico que envolveu disputas');

    expect(detectLanguage(text).language).toBe('pt-BR');

    const chunks = buildChunks(text);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBe(text.length);
    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('reporta um código de erro tratável quando os bytes não são um PDF', async () => {
    const notAPdf = new TextEncoder().encode('isto definitivamente nao e um PDF');
    const { messages } = await extract(notAPdf);

    const error = messages.find((m) => m.type === 'error');
    expect(error).toBeDefined();
    expect(error && error.type === 'error' && error.code).toBe('invalid_pdf');
  }, 120_000);
});
