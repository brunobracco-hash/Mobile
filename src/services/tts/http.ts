/**
 * Cliente HTTP para as APIs de voz.
 *
 * Usa `XMLHttpRequest` diretamente em vez de `fetch` porque precisamos do corpo
 * da resposta em binário: no React Native, `Response.arrayBuffer()` passa pelo
 * caminho de Blob e nem sempre está disponível, enquanto
 * `xhr.responseType = 'arraybuffer'` é suportado nativamente.
 */

export interface BinaryResponse {
  status: number;
  bytes: Uint8Array;
  /** Corpo lido como texto — só é preenchido em respostas de erro. */
  errorText?: string;
}

export interface TextResponse {
  status: number;
  text: string;
}

export interface HttpOptions {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    let out = '';
    for (const byte of bytes) out += String.fromCharCode(byte);
    return out;
  }
}

function send<T>(
  options: HttpOptions,
  responseType: 'arraybuffer' | 'text',
  extract: (xhr: XMLHttpRequest) => T
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(options.method, options.url);
    xhr.responseType = responseType;
    xhr.timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    for (const [name, value] of Object.entries(options.headers)) {
      xhr.setRequestHeader(name, value);
    }

    const onAbort = () => xhr.abort();
    options.signal?.addEventListener('abort', onAbort);
    const cleanup = () => options.signal?.removeEventListener('abort', onAbort);

    xhr.onload = () => {
      cleanup();
      resolve(extract(xhr));
    };
    xhr.onerror = () => {
      cleanup();
      reject(new Error('Falha de rede ao contatar o serviço de voz.'));
    };
    xhr.ontimeout = () => {
      cleanup();
      reject(new Error('O serviço de voz demorou demais para responder.'));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new Error('Requisição de voz cancelada.'));
    };

    xhr.send(options.body);
  });
}

export function postForBinary(options: HttpOptions): Promise<BinaryResponse> {
  return send(options, 'arraybuffer', (xhr) => {
    const bytes = new Uint8Array(xhr.response as ArrayBuffer);
    // Em caso de erro o corpo é JSON: decodificamos para mostrar a causa.
    const errorText = xhr.status >= 400 ? decodeUtf8(bytes.slice(0, 2048)) : undefined;
    return { status: xhr.status, bytes, errorText };
  });
}

export function postForText(options: HttpOptions): Promise<TextResponse> {
  return send(options, 'text', (xhr) => ({
    status: xhr.status,
    text: typeof xhr.response === 'string' ? xhr.response : String(xhr.response ?? ''),
  }));
}
