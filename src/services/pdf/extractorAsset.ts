import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { buildExtractorHtml } from '@/core/pdf/extractorPage';

import { extractorDirectory } from '../storage/paths';

// Os bundles são gerados por `scripts/prepare-pdfjs.mjs` e registrados como
// assets no metro.config.js.
const LIB_MODULE = require('../../../assets/pdfjs/pdf.lib.pdfjsbundle');
const WORKER_MODULE = require('../../../assets/pdfjs/pdf.worker.pdfjsbundle');
const PDFJS_VERSION: { pdfjs: string } = require('../../../assets/pdfjs/version.json');

/**
 * Materializa o HTML do extrator em disco e devolve a URI para a WebView.
 *
 * São ~1,5 MB de JavaScript: montar isso a cada importação seria desperdício,
 * então o arquivo é escrito uma vez e reaproveitado. Um marcador com a versão
 * do pdf.js força a regravação quando o app é atualizado.
 */
export async function ensureExtractorHtml(): Promise<string> {
  const directory = extractorDirectory();
  const htmlFile = new File(directory, 'extractor.html');
  const stampFile = new File(directory, 'version.txt');
  const stamp = PDFJS_VERSION.pdfjs;

  if (htmlFile.exists && stampFile.exists) {
    try {
      if ((await stampFile.text()) === stamp) return htmlFile.uri;
    } catch {
      // Marcador ilegível: regrava.
    }
  }

  const [libAsset, workerAsset] = await Asset.loadAsync([LIB_MODULE, WORKER_MODULE]);
  const libUri = libAsset?.localUri ?? libAsset?.uri;
  const workerUri = workerAsset?.localUri ?? workerAsset?.uri;
  if (!libUri || !workerUri) {
    throw new Error('Não foi possível carregar os arquivos do pdf.js embarcados no app.');
  }

  const libSource = await new File(libUri).text();
  const workerSource = await new File(workerUri).text();
  const html = buildExtractorHtml({ libSource, workerSource });

  if (htmlFile.exists) htmlFile.delete();
  htmlFile.create({ intermediates: true, overwrite: true });
  htmlFile.write(html);

  if (stampFile.exists) stampFile.delete();
  stampFile.create({ intermediates: true, overwrite: true });
  stampFile.write(stamp);

  return htmlFile.uri;
}

export const PDFJS_BUNDLED_VERSION = PDFJS_VERSION.pdfjs;
