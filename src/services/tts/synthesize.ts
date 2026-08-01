import type { LanguageCode } from '@/core/text/language';
import { getProvider } from '@/core/tts/registry';
import { NARRATION_STYLE, SynthesisError, type TtsProviderId } from '@/core/tts/types';
import { audioCacheKey } from '@/core/util/hash';

import { audioFile } from '../storage/paths';
import { postForBinary, postForText } from './http';

export interface SynthesizeParams {
  providerId: TtsProviderId;
  voiceId: string;
  language: LanguageCode;
  apiKey: string;
  text: string;
  /** Envia a direção de estilo aos provedores que a aceitam. */
  narrationStyle: boolean;
  signal?: AbortSignal;
}

export interface SynthesizedAudio {
  uri: string;
  cacheKey: string;
  /** `true` quando o áudio já estava em disco e não houve requisição. */
  fromCache: boolean;
}

function classify(status: number): SynthesisError['kind'] {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'quota';
  if (status >= 500) return 'server';
  return 'unknown';
}

function fail(providerId: TtsProviderId, status: number, body: string): never {
  const provider = getProvider(providerId);
  const friendly = provider.describeError?.(status, body);
  const fallback = `O serviço ${provider.name} respondeu com erro ${status}.`;
  throw new SynthesisError(friendly ?? fallback, classify(status), status);
}

/**
 * Sintetiza um trecho e devolve o caminho do arquivo de áudio.
 *
 * O resultado é gravado no cache em disco com uma chave derivada de texto,
 * provedor, voz e idioma: reabrir o mesmo livro na mesma voz não gasta nada, e
 * trocar a voz gera áudio novo sem invalidar o anterior.
 *
 * A velocidade **não** entra na chave: ela é aplicada no player, então o mesmo
 * arquivo serve para qualquer velocidade.
 */
export async function synthesizeChunk(params: SynthesizeParams): Promise<SynthesizedAudio> {
  const { providerId, voiceId, language, apiKey, text, narrationStyle, signal } = params;
  const provider = getProvider(providerId);

  if (!provider.requiresNetwork) {
    throw new SynthesisError(
      'A voz do aparelho não gera arquivos de áudio.',
      'unsupported'
    );
  }
  if (provider.requiresApiKey && apiKey.trim().length === 0) {
    throw new SynthesisError(
      `Informe a chave de API do ${provider.name} nos ajustes para usar esta voz.`,
      'auth'
    );
  }

  const cacheKey = audioCacheKey({ providerId, voiceId, language, speed: 1, text });
  const file = audioFile(cacheKey);
  if (file.exists && file.size > 0) {
    return { uri: file.uri, cacheKey, fromCache: true };
  }

  const request = provider.buildRequest({
    text,
    voiceId,
    language,
    apiKey,
    styleInstructions: narrationStyle ? NARRATION_STYLE[language] : undefined,
  });

  const httpOptions = {
    url: request.url,
    method: request.method,
    headers: request.headers,
    body: request.body,
    signal,
  } as const;

  if (request.responseKind === 'binary') {
    const response = await postForBinary(httpOptions);
    if (response.status < 200 || response.status >= 300) {
      fail(providerId, response.status, response.errorText ?? '');
    }
    if (response.bytes.byteLength === 0) {
      throw new SynthesisError(`O ${provider.name} devolveu um áudio vazio.`, 'server');
    }
    writeAudio(file, response.bytes);
  } else {
    const response = await postForText(httpOptions);
    if (response.status < 200 || response.status >= 300) {
      fail(providerId, response.status, response.text);
    }
    const base64 = extractBase64(response.text, request.base64Field ?? 'audioContent');
    if (!base64) {
      throw new SynthesisError(`Resposta do ${provider.name} sem áudio.`, 'server');
    }
    writeAudio(file, base64, 'base64');
  }

  return { uri: file.uri, cacheKey, fromCache: false };
}

function extractBase64(body: string, field: string): string | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      const value = (parsed as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  } catch {
    // Corpo não-JSON cai no retorno nulo.
  }
  return null;
}

function writeAudio(
  file: ReturnType<typeof audioFile>,
  content: Uint8Array | string,
  encoding?: 'base64'
): void {
  if (file.exists) file.delete();
  file.create({ intermediates: true, overwrite: true });
  file.write(content, encoding ? { encoding } : undefined);
}
