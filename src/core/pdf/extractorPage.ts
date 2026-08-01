/**
 * Código que roda *dentro* da WebView, ao lado do pdf.js.
 *
 * É mantido como string (e não como módulo transpilado) porque precisa ser
 * embutido literalmente no HTML carregado pela WebView. Por isso usa apenas
 * sintaxe ES5/ES2017 e nenhuma dependência do bundle do app.
 *
 * A API exposta é `window.VozPDF`:
 *   - `push(base64Chunk)`  — acumula pedaços do arquivo;
 *   - `extract(id, password)` — abre o PDF acumulado e emite o texto;
 *   - `reset()` — descarta o buffer atual.
 */
export const EXTRACTOR_PAGE_SCRIPT = String.raw`
(function () {
  'use strict';

  var chunks = [];

  function send(message) {
    var payload = JSON.stringify(message);
    if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
      window.ReactNativeWebView.postMessage(payload);
    } else if (typeof window.__vozpdfTestSink === 'function') {
      window.__vozpdfTestSink(payload);
    }
  }

  function base64ToBytes(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  function concatChunks(list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i].length;
    var merged = new Uint8Array(total);
    var offset = 0;
    for (var j = 0; j < list.length; j++) {
      merged.set(list[j], offset);
      offset += list[j].length;
    }
    return merged;
  }

  // O pdf.js entrega fragmentos posicionados; 'hasEOL' marca o fim de uma linha
  // visual. A reconstrução de parágrafos acontece do lado do app (normalize.ts),
  // aqui preservamos apenas as quebras de linha originais.
  function itemsToText(items) {
    var parts = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (typeof item.str !== 'string') continue; // itens de marked content
      parts.push(item.str);
      if (item.hasEOL) parts.push('\n');
    }
    return parts.join('');
  }

  function classifyError(error) {
    var name = error && error.name ? String(error.name) : '';
    var message = error && error.message ? String(error.message) : String(error);
    if (name === 'PasswordException') {
      // code 1 = NEED_PASSWORD, 2 = INCORRECT_PASSWORD
      return error.code === 2 ? 'invalid_password' : 'password_required';
    }
    if (name === 'InvalidPDFException') return 'invalid_pdf';
    if (/Invalid PDF structure|not a PDF file/i.test(message)) return 'invalid_pdf';
    return 'unknown';
  }

  function extract(id, password) {
    var lib = globalThis.pdfjsLib;
    var doc = null;
    var chars = 0;

    Promise.resolve()
      .then(function () {
        var data = concatChunks(chunks);
        chunks = [];
        if (data.length === 0) throw new Error('Nenhum dado de PDF recebido');
        return lib.getDocument({
          data: data,
          password: password || undefined,
          // A WebView não tem acesso à rede nem às fontes padrão do pdf.js:
          // desabilitamos tudo que não é necessário para extrair texto.
          isEvalSupported: false,
          useWorkerFetch: false,
          useSystemFonts: false,
          disableFontFace: true,
          stopAtErrors: false,
          verbosity: 0,
        }).promise;
      })
      .then(function (loaded) {
        doc = loaded;
        return doc.getMetadata().catch(function () {
          return null;
        });
      })
      .then(function (metadata) {
        var title =
          metadata && metadata.info && metadata.info.Title ? String(metadata.info.Title) : undefined;
        send({ type: 'meta', id: id, pages: doc.numPages, title: title });
        return readPages(1);
      })
      .then(function () {
        send({ type: 'done', id: id, pages: doc.numPages, chars: chars });
        return doc.destroy();
      })
      .catch(function (error) {
        send({
          type: 'error',
          id: id,
          code: classifyError(error),
          message: error && error.message ? String(error.message) : String(error),
        });
        if (doc) {
          try {
            doc.destroy();
          } catch (ignored) {}
        }
      });

    function readPages(pageNumber) {
      if (pageNumber > doc.numPages) return Promise.resolve();
      return doc
        .getPage(pageNumber)
        .then(function (page) {
          return page.getTextContent().then(function (content) {
            var text = itemsToText(content.items);
            chars += text.length;
            send({
              type: 'pageText',
              id: id,
              page: pageNumber,
              pages: doc.numPages,
              text: text,
            });
            page.cleanup();
          });
        })
        .then(function () {
          return readPages(pageNumber + 1);
        });
    }
  }

  window.VozPDF = {
    push: function (base64Chunk) {
      chunks.push(base64ToBytes(base64Chunk));
    },
    reset: function () {
      chunks = [];
    },
    extract: extract,
  };

  send({
    type: 'ready',
    pdfjsVersion: globalThis.pdfjsLib ? globalThis.pdfjsLib.version : 'desconhecida',
  });
})();
`;

/**
 * Monta o documento HTML completo do extrator.
 *
 * Os dois bundles do pdf.js são embutidos como scripts clássicos inline: assim
 * a página funciona a partir de uma URL `file://` sem depender de `fetch`, de
 * módulos ES ou da criação de um `Worker` — tudo sujeito a bloqueio por origem
 * no WebView do Android.
 */
export function buildExtractorHtml(options: { libSource: string; workerSource: string }): string {
  return [
    '<!DOCTYPE html>',
    '<html lang="pt-BR">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    '<title>VozPDF extractor</title>',
    '</head>',
    '<body>',
    // O worker precisa vir primeiro: ao encontrar `globalThis.pdfjsWorker` já
    // definido, o pdf.js usa o handler na thread principal e nunca tenta
    // instanciar um Worker.
    `<script>${options.workerSource}</script>`,
    `<script>${options.libSource}</script>`,
    `<script>${EXTRACTOR_PAGE_SCRIPT}</script>`,
    '</body>',
    '</html>',
  ].join('\n');
}
