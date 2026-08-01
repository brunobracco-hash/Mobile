import { Directory, File, Paths } from 'expo-file-system';

/**
 * Organização dos arquivos no aparelho:
 *
 *   documentos/<id>/source.pdf   PDF original (para reextrair se necessário)
 *   documentos/<id>/text.txt     texto já normalizado
 *   cache/audio/<chave>.mp3      áudio sintetizado, descartável
 *
 * O texto e o PDF ficam no diretório de documentos, que o sistema não apaga.
 * O áudio fica no cache: perdê-lo custa apenas uma nova síntese.
 */

const DOCUMENTS_DIR = 'documents';
const AUDIO_DIR = 'audio';

export function documentDirectory(documentId: string): Directory {
  return new Directory(Paths.document, DOCUMENTS_DIR, documentId);
}

export function ensureDocumentDirectory(documentId: string): Directory {
  const directory = documentDirectory(documentId);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function pdfFile(documentId: string): File {
  return new File(documentDirectory(documentId), 'source.pdf');
}

export function textFile(documentId: string): File {
  return new File(documentDirectory(documentId), 'text.txt');
}

export function audioDirectory(): Directory {
  const directory = new Directory(Paths.cache, AUDIO_DIR);
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function audioFile(cacheKey: string): File {
  return new File(audioDirectory(), `${cacheKey}.mp3`);
}

/** Diretório de trabalho da WebView do extrator (HTML + bundles do pdf.js). */
export function extractorDirectory(): Directory {
  const directory = new Directory(Paths.cache, 'pdfjs');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

export function deleteDocumentFiles(documentId: string): void {
  const directory = documentDirectory(documentId);
  if (directory.exists) directory.delete();
}
