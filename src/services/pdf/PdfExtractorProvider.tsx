import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { File } from 'expo-file-system';

import { chunkBase64, parseExtractorMessage } from '@/core/pdf/protocol';
import type { ExtractorErrorCode } from '@/core/pdf/protocol';

import { ensureExtractorHtml } from './extractorAsset';

export class PdfExtractionError extends Error {
  constructor(
    message: string,
    readonly code: ExtractorErrorCode | 'timeout' | 'unavailable'
  ) {
    super(message);
    this.name = 'PdfExtractionError';
  }
}

export interface ExtractionResult {
  pages: string[];
  title?: string;
}

export interface ExtractOptions {
  password?: string;
  onProgress?: (page: number, pages: number) => void;
  signal?: AbortSignal;
}

interface PdfExtractorApi {
  ready: boolean;
  extract(pdfUri: string, options?: ExtractOptions): Promise<ExtractionResult>;
}

const PdfExtractorContext = createContext<PdfExtractorApi | null>(null);

/** Uma extração em andamento. */
interface PendingRequest {
  id: string;
  pages: string[];
  title?: string;
  onProgress?: (page: number, pages: number) => void;
  resolve(result: ExtractionResult): void;
  reject(error: PdfExtractionError): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Silêncio máximo tolerado entre duas mensagens da WebView. */
const SILENCE_TIMEOUT_MS = 90_000;

/**
 * Mantém uma WebView invisível com o pdf.js carregado e expõe a extração de
 * texto como uma promessa.
 *
 * A WebView vive na raiz do app (e não na tela de importação) para que o
 * pdf.js — 1,5 MB de JavaScript — seja carregado uma única vez e a segunda
 * importação seja instantânea.
 */
export function PdfExtractorProvider({ children }: { children: React.ReactNode }) {
  const webViewRef = useRef<WebView>(null);
  const [htmlUri, setHtmlUri] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pendingRef = useRef<PendingRequest | null>(null);
  const readyWaitersRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    let cancelled = false;
    ensureExtractorHtml()
      .then((uri) => {
        if (!cancelled) setHtmlUri(uri);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const settle = useCallback((finish: (request: PendingRequest) => void) => {
    const request = pendingRef.current;
    if (!request) return;
    clearTimeout(request.timer);
    pendingRef.current = null;
    finish(request);
  }, []);

  const armTimeout = useCallback(() => {
    const request = pendingRef.current;
    if (!request) return;
    clearTimeout(request.timer);
    request.timer = setTimeout(() => {
      settle((pending) =>
        pending.reject(
          new PdfExtractionError('A leitura do PDF demorou demais e foi interrompida.', 'timeout')
        )
      );
    }, SILENCE_TIMEOUT_MS);
  }, [settle]);

  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      const message = parseExtractorMessage(event.nativeEvent.data);
      if (!message) return;

      if (message.type === 'ready') {
        setReady(true);
        readyWaitersRef.current.splice(0).forEach((resolve) => resolve());
        return;
      }

      const request = pendingRef.current;
      if (!request || message.id !== request.id) return;

      switch (message.type) {
        case 'meta':
          request.title = message.title;
          armTimeout();
          break;
        case 'pageText':
          request.pages[message.page - 1] = message.text;
          request.onProgress?.(message.page, message.pages);
          armTimeout();
          break;
        case 'done':
          settle((pending) =>
            pending.resolve({
              // Páginas sem texto viram string vazia em vez de buraco no array.
              pages: Array.from({ length: message.pages }, (_, i) => pending.pages[i] ?? ''),
              title: pending.title,
            })
          );
          break;
        case 'error':
          settle((pending) => pending.reject(new PdfExtractionError(message.message, message.code)));
          break;
      }
    },
    [armTimeout, settle]
  );

  const waitForReady = useCallback(async () => {
    if (ready) return;
    if (loadError) throw new PdfExtractionError(loadError, 'unavailable');
    await new Promise<void>((resolve) => {
      readyWaitersRef.current.push(resolve);
    });
  }, [loadError, ready]);

  const extract = useCallback(
    async (pdfUri: string, options: ExtractOptions = {}): Promise<ExtractionResult> => {
      await waitForReady();

      const webView = webViewRef.current;
      if (!webView) throw new PdfExtractionError('O leitor de PDF não está pronto.', 'unavailable');
      if (pendingRef.current) {
        throw new PdfExtractionError('Já existe uma importação em andamento.', 'unavailable');
      }

      const base64 = await new File(pdfUri).base64();
      const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      return new Promise<ExtractionResult>((resolve, reject) => {
        const request: PendingRequest = {
          id,
          pages: [],
          onProgress: options.onProgress,
          resolve,
          reject,
          timer: setTimeout(() => undefined, 0),
        };
        pendingRef.current = request;
        armTimeout();

        options.signal?.addEventListener('abort', () => {
          settle((pending) =>
            pending.reject(new PdfExtractionError('Importação cancelada.', 'unavailable'))
          );
          webView.injectJavaScript('window.VozPDF && window.VozPDF.reset(); true;');
        });

        webView.injectJavaScript('window.VozPDF.reset(); true;');
        for (const chunk of chunkBase64(base64)) {
          // O alfabeto base64 não contém aspas nem barras invertidas, então
          // interpolar diretamente no literal é seguro.
          webView.injectJavaScript(`window.VozPDF.push("${chunk}"); true;`);
        }
        const password = options.password ? JSON.stringify(options.password) : 'undefined';
        webView.injectJavaScript(
          `window.VozPDF.extract(${JSON.stringify(id)}, ${password}); true;`
        );
      });
    },
    [armTimeout, settle, waitForReady]
  );

  const api = useMemo<PdfExtractorApi>(() => ({ ready, extract }), [extract, ready]);

  return (
    <PdfExtractorContext.Provider value={api}>
      {children}
      <View style={styles.hidden} pointerEvents="none">
        {htmlUri ? (
          <WebView
            ref={webViewRef}
            source={{ uri: htmlUri }}
            originWhitelist={['*']}
            javaScriptEnabled
            // Necessário para carregar o HTML gravado no diretório de cache.
            allowFileAccess
            allowFileAccessFromFileURLs
            allowUniversalAccessFromFileURLs
            allowingReadAccessToURL={htmlUri.slice(0, htmlUri.lastIndexOf('/') + 1)}
            onMessage={handleMessage}
            onError={({ nativeEvent }) => setLoadError(nativeEvent.description)}
            // A página não navega para lugar nenhum; qualquer tentativa é bloqueada.
            onShouldStartLoadWithRequest={(request) => request.url === htmlUri}
            androidLayerType="software"
          />
        ) : null}
      </View>
    </PdfExtractorContext.Provider>
  );
}

export function usePdfExtractor(): PdfExtractorApi {
  const context = useContext(PdfExtractorContext);
  if (!context) throw new Error('usePdfExtractor precisa estar dentro de PdfExtractorProvider.');
  return context;
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -1000,
    top: -1000,
  },
});
