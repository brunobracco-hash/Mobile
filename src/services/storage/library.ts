import type { DocumentRecord, ReadingProgress } from '@/core/library/types';
import { createProgress } from '@/core/reading/progress';

import { deleteDocumentFiles, textFile } from './paths';
import { readJson, remove, StorageKeys, writeJson } from './store';

/**
 * Repositório da biblioteca. Os metadados dos documentos ficam em uma lista no
 * armazenamento chave-valor; o texto de cada documento fica em arquivo, porque
 * pode ter alguns megabytes e não deve ser carregado a cada listagem.
 */

export async function listDocuments(): Promise<DocumentRecord[]> {
  const documents = (await readJson<DocumentRecord[]>(StorageKeys.documents)) ?? [];
  return documents.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
}

export async function getDocument(id: string): Promise<DocumentRecord | null> {
  const documents = await listDocuments();
  return documents.find((document) => document.id === id) ?? null;
}

export async function saveDocument(record: DocumentRecord): Promise<void> {
  const documents = await listDocuments();
  const index = documents.findIndex((document) => document.id === record.id);
  if (index >= 0) documents[index] = record;
  else documents.push(record);
  await writeJson(StorageKeys.documents, documents);
}

export async function deleteDocument(id: string): Promise<void> {
  const documents = await listDocuments();
  await writeJson(
    StorageKeys.documents,
    documents.filter((document) => document.id !== id)
  );
  await remove(StorageKeys.progress(id));
  try {
    deleteDocumentFiles(id);
  } catch {
    // Se os arquivos já sumiram, o registro removido acima basta.
  }
}

export async function readDocumentText(id: string): Promise<string> {
  const file = textFile(id);
  if (!file.exists) throw new Error('O texto deste documento não está mais disponível.');
  return file.text();
}

export async function loadProgress(documentId: string): Promise<ReadingProgress> {
  const saved = await readJson<ReadingProgress>(StorageKeys.progress(documentId));
  if (!saved || typeof saved.chunkIndex !== 'number') return createProgress(documentId);
  return {
    documentId,
    chunkIndex: Math.max(0, Math.trunc(saved.chunkIndex)),
    charOffset: Math.max(0, Math.trunc(saved.charOffset ?? 0)),
    chunkFraction: Math.max(0, Math.min(1, saved.chunkFraction ?? 0)),
    updatedAt: saved.updatedAt ?? Date.now(),
    completed: Boolean(saved.completed),
  };
}

export async function saveProgress(progress: ReadingProgress): Promise<void> {
  await writeJson(StorageKeys.progress(progress.documentId), progress);
}

export async function touchDocument(id: string): Promise<void> {
  const document = await getDocument(id);
  if (!document) return;
  await saveDocument({ ...document, lastOpenedAt: Date.now() });
}
