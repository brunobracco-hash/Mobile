/**
 * Protocolo de mensagens entre o app (React Native) e a WebView que executa o
 * pdf.js. Mantido puro para poder ser exercitado em testes fora do dispositivo.
 */

export type ExtractorOutboundMessage =
  /** A página carregou o pdf.js e está pronta para receber bytes. */
  | { type: 'ready'; pdfjsVersion: string }
  /** Metadados do documento, enviados assim que o PDF é aberto. */
  | { type: 'meta'; id: string; pages: number; title?: string }
  /** Texto de uma página. Enviado página a página para evitar mensagens enormes. */
  | { type: 'pageText'; id: string; page: number; pages: number; text: string }
  /** Extração concluída. */
  | { type: 'done'; id: string; pages: number; chars: number }
  /** Falha na extração. `code` distingue os casos tratáveis pela interface. */
  | { type: 'error'; id: string; code: ExtractorErrorCode; message: string };

export type ExtractorErrorCode =
  | 'password_required'
  | 'invalid_password'
  | 'invalid_pdf'
  | 'unknown';

export function parseExtractorMessage(raw: string): ExtractorOutboundMessage | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { type?: unknown }).type === 'string'
    ) {
      return parsed as ExtractorOutboundMessage;
    }
  } catch {
    // Mensagens não reconhecidas são ignoradas pelo chamador.
  }
  return null;
}

/** Tamanho de cada pedaço de base64 enviado do app para a WebView. */
export const PDF_CHUNK_SIZE = 192 * 1024;

/** Divide uma string base64 em pedaços transportáveis pela ponte da WebView. */
export function chunkBase64(base64: string, chunkSize: number = PDF_CHUNK_SIZE): string[] {
  if (chunkSize <= 0) throw new Error('chunkSize deve ser positivo');
  if (base64.length === 0) return [];
  const chunks: string[] = [];
  for (let offset = 0; offset < base64.length; offset += chunkSize) {
    chunks.push(base64.slice(offset, offset + chunkSize));
  }
  return chunks;
}
