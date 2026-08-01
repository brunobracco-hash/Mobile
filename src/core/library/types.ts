import type { LanguageCode } from '../text/language';

/** Um PDF importado para a biblioteca. */
export interface DocumentRecord {
  id: string;
  title: string;
  /** Nome original do arquivo escolhido pelo usuário. */
  fileName: string;
  /** Caminho do PDF copiado para o armazenamento do app. */
  pdfPath: string;
  /** Caminho do texto já normalizado, pronto para narrar. */
  textPath: string;
  pages: number;
  chars: number;
  chunkCount: number;
  language: LanguageCode;
  /** `true` enquanto o idioma vier da detecção automática, e não do usuário. */
  languageAuto: boolean;
  addedAt: number;
  lastOpenedAt: number | null;
}

/** Onde a leitura parou. É isto que o app restaura ao reabrir um documento. */
export interface ReadingProgress {
  documentId: string;
  /** Índice do trecho de narração atual. */
  chunkIndex: number;
  /** Deslocamento no texto normalizado — sobrevive a mudanças no fatiamento. */
  charOffset: number;
  /** Fração já reproduzida do trecho atual, de 0 a 1. */
  chunkFraction: number;
  updatedAt: number;
  completed: boolean;
}

export type ImportStage =
  | { kind: 'copying' }
  | { kind: 'extracting'; page: number; pages: number }
  | { kind: 'analyzing' }
  | { kind: 'done' };
