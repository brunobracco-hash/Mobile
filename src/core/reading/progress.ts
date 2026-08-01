import type { TextChunk } from '../text/chunk';
import { chunkIndexAtOffset, estimateSeconds } from '../text/chunk';
import type { ReadingProgress } from '../library/types';

/**
 * Memória de leitura.
 *
 * A posição é guardada em duas formas: o índice do trecho (rápido de usar) e o
 * deslocamento em caracteres (estável). Se o fatiamento mudar — porque o texto
 * foi reextraído ou o tamanho alvo do trecho mudou —, o deslocamento continua
 * apontando para o mesmo ponto do texto e o índice é recalculado a partir dele.
 */

export function createProgress(documentId: string): ReadingProgress {
  return {
    documentId,
    chunkIndex: 0,
    charOffset: 0,
    chunkFraction: 0,
    updatedAt: Date.now(),
    completed: false,
  };
}

export function progressAt(
  documentId: string,
  chunks: TextChunk[],
  chunkIndex: number,
  chunkFraction = 0
): ReadingProgress {
  const index = clampIndex(chunkIndex, chunks.length);
  const chunk = chunks[index];
  return {
    documentId,
    chunkIndex: index,
    charOffset: chunk ? chunk.start : 0,
    chunkFraction: Math.max(0, Math.min(1, chunkFraction)),
    updatedAt: Date.now(),
    completed: false,
  };
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (!Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(length - 1, Math.trunc(index)));
}

/**
 * Reconcilia uma posição salva com o fatiamento atual do documento.
 * O deslocamento em caracteres tem prioridade sobre o índice salvo.
 */
export function resolveProgress(progress: ReadingProgress, chunks: TextChunk[]): ReadingProgress {
  if (chunks.length === 0) return { ...progress, chunkIndex: 0, chunkFraction: 0 };

  const byOffset = chunkIndexAtOffset(chunks, progress.charOffset);
  const chunk = chunks[byOffset]!;
  const sameChunk = byOffset === progress.chunkIndex;

  return {
    ...progress,
    chunkIndex: byOffset,
    charOffset: chunk.start,
    // A fração só faz sentido se ainda estivermos no mesmo trecho de antes.
    chunkFraction: sameChunk ? progress.chunkFraction : 0,
  };
}

/** Fração concluída do documento, de 0 a 1, ponderada por caracteres. */
export function completionRatio(progress: ReadingProgress, chunks: TextChunk[]): number {
  if (chunks.length === 0) return 0;
  if (progress.completed) return 1;

  const totalChars = chunks[chunks.length - 1]!.end;
  if (totalChars <= 0) return 0;

  const index = clampIndex(progress.chunkIndex, chunks.length);
  const chunk = chunks[index]!;
  const consumed = chunk.start + (chunk.end - chunk.start) * progress.chunkFraction;
  return Math.max(0, Math.min(1, consumed / totalChars));
}

/** Segundos estimados para terminar a leitura a partir da posição atual. */
export function estimateRemainingSeconds(
  progress: ReadingProgress,
  chunks: TextChunk[],
  speed = 1
): number {
  if (chunks.length === 0) return 0;
  const totalChars = chunks[chunks.length - 1]!.end;
  const index = clampIndex(progress.chunkIndex, chunks.length);
  const chunk = chunks[index]!;
  const consumed = chunk.start + (chunk.end - chunk.start) * progress.chunkFraction;
  return estimateSeconds(Math.max(0, totalChars - consumed), speed);
}

/** "1 h 12 min" / "8 min" / "40 s" */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
