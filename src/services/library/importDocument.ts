import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import type { DocumentRecord, ImportStage } from '@/core/library/types';
import { titleFromFileName } from '@/core/library/title';
import { buildChunks } from '@/core/text/chunk';
import { detectLanguage } from '@/core/text/language';
import { looksLikeScannedPdf, normalizePdfPages } from '@/core/text/normalize';

import { PdfExtractionError, type ExtractOptions } from '../pdf/PdfExtractorProvider';
import { ensureDocumentDirectory, pdfFile, textFile } from '../storage/paths';
import { saveDocument } from '../storage/library';

export interface ImportInput {
  uri: string;
  fileName: string;
  password?: string;
  onStage?: (stage: ImportStage) => void;
  signal?: AbortSignal;
}

type Extractor = (uri: string, options?: ExtractOptions) => Promise<{ pages: string[]; title?: string }>;

/**
 * Importa um PDF: copia o arquivo, extrai o texto, limpa, detecta o idioma e
 * grava tudo na biblioteca. Devolve o registro pronto para ser aberto.
 */
export async function importDocument(
  input: ImportInput,
  extract: Extractor
): Promise<DocumentRecord> {
  const { uri, fileName, password, onStage, signal } = input;
  const id = Crypto.randomUUID();

  onStage?.({ kind: 'copying' });
  ensureDocumentDirectory(id);
  const destination = pdfFile(id);
  await new File(uri).copy(destination);

  let extraction: { pages: string[]; title?: string };
  try {
    extraction = await extract(destination.uri, {
      password,
      signal,
      onProgress: (page, pages) => onStage?.({ kind: 'extracting', page, pages }),
    });
  } catch (error) {
    // Sem texto extraído não há documento: desfaz a cópia.
    if (destination.exists) destination.delete();
    throw error;
  }

  onStage?.({ kind: 'analyzing' });

  if (looksLikeScannedPdf(extraction.pages)) {
    if (destination.exists) destination.delete();
    throw new PdfExtractionError(
      'Este PDF parece ser digitalizado (só imagens). Não há texto para narrar — ' +
        'seria necessário passar por reconhecimento óptico antes.',
      'invalid_pdf'
    );
  }

  const text = normalizePdfPages(extraction.pages);
  const language = detectLanguage(text).language;
  const chunks = buildChunks(text);

  const output = textFile(id);
  if (output.exists) output.delete();
  output.create({ intermediates: true, overwrite: true });
  output.write(text);

  const title = (extraction.title ?? '').trim();
  const record: DocumentRecord = {
    id,
    title: title.length > 2 ? title : titleFromFileName(fileName),
    fileName,
    pdfPath: destination.uri,
    textPath: output.uri,
    pages: extraction.pages.length,
    chars: text.length,
    chunkCount: chunks.length,
    language,
    languageAuto: true,
    addedAt: Date.now(),
    lastOpenedAt: null,
  };

  await saveDocument(record);
  onStage?.({ kind: 'done' });
  return record;
}
