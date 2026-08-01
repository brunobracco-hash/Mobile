import TrackPlayer, { Event, State, type Track } from 'react-native-track-player';
import * as Speech from 'expo-speech';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

import type { DocumentRecord, ReadingProgress } from '@/core/library/types';
import { clampIndex, progressAt, resolveProgress } from '@/core/reading/progress';
import type { TextChunk } from '@/core/text/chunk';
import { getProvider, resolveVoiceId } from '@/core/tts/registry';
import type { AppSettings } from '@/core/settings/settings';
import { selectedVoice } from '@/core/settings/settings';
import { SynthesisError } from '@/core/tts/types';

import { saveProgress } from '../storage/library';
import { getApiKey } from '../storage/secrets';
import { trimAudioCache } from '../tts/audioCache';
import { synthesizeChunk } from '../tts/synthesize';
import { ensurePlayerSetup } from './setup';

export type PlaybackStatus =
  | 'idle'
  | 'preparing'
  | 'playing'
  | 'paused'
  | 'finished'
  | 'error';

export interface PlaybackSnapshot {
  documentId: string | null;
  title: string;
  status: PlaybackStatus;
  /** Trecho atualmente narrado. */
  chunkIndex: number;
  chunkCount: number;
  /** Fração já reproduzida do trecho atual, de 0 a 1. */
  chunkFraction: number;
  /** Quantos trechos à frente já estão sintetizados e prontos. */
  buffered: number;
  /** Motor em uso: arquivos de áudio (IA) ou a voz do sistema. */
  engine: 'audio' | 'device';
  speed: number;
  message: string | null;
}

const IDLE_SNAPSHOT: PlaybackSnapshot = {
  documentId: null,
  title: '',
  status: 'idle',
  chunkIndex: 0,
  chunkCount: 0,
  chunkFraction: 0,
  buffered: 0,
  engine: 'audio',
  speed: 1,
  message: null,
};

/** Intervalo mínimo entre duas gravações da posição de leitura. */
const PROGRESS_SAVE_INTERVAL_MS = 5_000;

/**
 * Orquestra a leitura em voz alta de um documento.
 *
 * Existem dois motores:
 *
 *  - **audio** — cada trecho é sintetizado em um arquivo mp3 e enfileirado no
 *    `react-native-track-player`. É o modo completo: toca com a tela apagada,
 *    aparece na tela bloqueada e sobrevive ao app sair da memória recente.
 *  - **device** — o sistema operacional fala o texto (`expo-speech`). Funciona
 *    offline e sem chave, mas não produz arquivo, então não há controles de
 *    mídia e o iOS interrompe a fala quando o app deixa a tela.
 *
 * A posição é gravada continuamente, de modo que fechar o app no meio de uma
 * frase e reabrir horas depois retoma do mesmo ponto.
 */
export class PlaybackController {
  private listeners = new Set<(snapshot: PlaybackSnapshot) => void>();
  private snapshot: PlaybackSnapshot = IDLE_SNAPSHOT;

  private document: DocumentRecord | null = null;
  private chunks: TextChunk[] = [];
  private settings: AppSettings | null = null;
  private apiKey = '';

  /** Índice do trecho de cada posição da fila do player. */
  private queueChunks: number[] = [];
  /** Invalida operações assíncronas em voo quando o documento muda. */
  private generation = 0;
  private prefetching = false;
  private lastSavedAt = 0;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
  private subscriptions: Array<{ remove(): void }> = [];
  private deviceSpeaking = false;

  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): PlaybackSnapshot {
    return this.snapshot;
  }

  private update(patch: Partial<PlaybackSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  // ---------------------------------------------------------------- ciclo de vida

  /** Prepara o documento para leitura, restaurando a posição salva. */
  async open(
    document: DocumentRecord,
    chunks: TextChunk[],
    progress: ReadingProgress,
    settings: AppSettings
  ): Promise<void> {
    // Reabrir a tela do documento que já está tocando não pode reiniciar nada:
    // a leitura pode estar em andamento em segundo plano.
    if (this.document?.id === document.id && this.snapshot.status !== 'idle') {
      this.document = document;
      this.chunks = chunks;
      await this.applySettings(settings);
      return;
    }

    this.generation += 1;
    const generation = this.generation;

    this.document = document;
    this.chunks = chunks;
    this.settings = settings;

    const provider = getProvider(settings.providerId);
    const engine: PlaybackSnapshot['engine'] = provider.requiresNetwork ? 'audio' : 'device';
    this.apiKey = provider.requiresApiKey ? ((await getApiKey(provider.id)) ?? '') : '';

    const restored = resolveProgress(progress, chunks);

    await this.teardownPlayback();

    this.update({
      documentId: document.id,
      title: document.title,
      status: 'paused',
      chunkIndex: restored.chunkIndex,
      chunkCount: chunks.length,
      chunkFraction: restored.chunkFraction,
      buffered: 0,
      engine,
      speed: settings.speed,
      message: null,
    });

    if (engine === 'audio') {
      await ensurePlayerSetup();
      if (generation !== this.generation) return;
      this.attachPlayerListeners();
      await TrackPlayer.setRate(settings.speed);
    }
  }

  /** Aplica ajustes alterados durante a leitura (voz, velocidade, prefetch). */
  async applySettings(settings: AppSettings): Promise<void> {
    const previous = this.settings;
    this.settings = settings;

    const provider = getProvider(settings.providerId);
    this.apiKey = provider.requiresApiKey ? ((await getApiKey(provider.id)) ?? '') : '';

    if (this.snapshot.speed !== settings.speed) {
      this.update({ speed: settings.speed });
      if (this.snapshot.engine === 'audio') await TrackPlayer.setRate(settings.speed);
    }

    const engineChanged =
      previous && getProvider(previous.providerId).requiresNetwork !== provider.requiresNetwork;
    const voiceChanged =
      previous &&
      this.document &&
      (previous.providerId !== settings.providerId ||
        selectedVoice(previous, previous.providerId, this.document.language) !==
          selectedVoice(settings, settings.providerId, this.document.language));

    if (engineChanged || voiceChanged) {
      // A fila contém áudio da voz antiga: refaz a partir do trecho atual.
      const wasPlaying = this.snapshot.status === 'playing';
      await this.restartFromCurrentChunk();
      this.update({ engine: provider.requiresNetwork ? 'audio' : 'device' });
      if (wasPlaying) await this.play();
    }

    this.scheduleSleepTimer();
  }

  /** Encerra a leitura e libera o player. */
  async close(): Promise<void> {
    this.generation += 1;
    await this.persistProgress(true);
    await this.teardownPlayback();
    this.document = null;
    this.chunks = [];
    this.snapshot = IDLE_SNAPSHOT;
    this.update({});
  }

  private async teardownPlayback(): Promise<void> {
    this.clearSleepTimer();
    this.queueChunks = [];
    this.deviceSpeaking = false;
    Speech.stop();
    deactivateKeepAwake().catch(() => undefined);
    for (const subscription of this.subscriptions.splice(0)) subscription.remove();
    try {
      await TrackPlayer.reset();
    } catch {
      // O player pode nem ter sido inicializado ainda.
    }
  }

  // ---------------------------------------------------------------- controles

  async play(): Promise<void> {
    if (!this.document || this.chunks.length === 0) return;
    this.scheduleSleepTimer();

    if (this.snapshot.engine === 'device') {
      await this.speakCurrentChunkOnDevice();
      return;
    }

    try {
      if (this.queueChunks.length === 0) {
        this.update({ status: 'preparing', message: 'Preparando a narração…' });
        await this.enqueueFrom(this.snapshot.chunkIndex);
      }
      await TrackPlayer.play();
      this.update({ status: 'playing', message: null });
      void this.prefetch();
    } catch (error) {
      this.reportError(error);
    }
  }

  async pause(): Promise<void> {
    this.clearSleepTimer();
    if (this.snapshot.engine === 'device') {
      this.deviceSpeaking = false;
      Speech.stop();
      deactivateKeepAwake().catch(() => undefined);
    } else {
      await TrackPlayer.pause();
    }
    this.update({ status: 'paused' });
    await this.persistProgress(true);
  }

  async toggle(): Promise<void> {
    if (this.snapshot.status === 'playing') await this.pause();
    else await this.play();
  }

  async skipChunks(delta: number): Promise<void> {
    const target = clampIndex(this.snapshot.chunkIndex + delta, this.chunks.length);
    await this.goToChunk(target);
  }

  /** Move a leitura para um trecho específico e recomeça a fila a partir dele. */
  async goToChunk(index: number): Promise<void> {
    if (this.chunks.length === 0) return;
    const target = clampIndex(index, this.chunks.length);
    const wasPlaying = this.snapshot.status === 'playing';

    this.update({ chunkIndex: target, chunkFraction: 0, buffered: 0 });
    await this.persistProgress(true);

    if (this.snapshot.engine === 'device') {
      Speech.stop();
      if (wasPlaying) await this.speakCurrentChunkOnDevice();
      return;
    }

    await this.restartFromCurrentChunk();
    if (wasPlaying) await this.play();
  }

  async setSpeed(speed: number): Promise<void> {
    this.update({ speed });
    if (this.snapshot.engine === 'audio') await TrackPlayer.setRate(speed);
    else if (this.snapshot.status === 'playing') await this.speakCurrentChunkOnDevice();
  }

  private async restartFromCurrentChunk(): Promise<void> {
    this.generation += 1;
    this.queueChunks = [];
    try {
      await TrackPlayer.reset();
    } catch {
      // Nada a limpar.
    }
  }

  // ---------------------------------------------------------------- fila de áudio

  private async enqueueFrom(startIndex: number): Promise<void> {
    const chunk = this.chunks[startIndex];
    if (!chunk) return;
    const track = await this.buildTrack(chunk);
    await TrackPlayer.add([track]);
    this.queueChunks = [startIndex];
  }

  private async buildTrack(chunk: TextChunk): Promise<Track> {
    const document = this.document;
    const settings = this.settings;
    if (!document || !settings) throw new Error('Nenhum documento aberto.');

    const voiceId = resolveVoiceId(
      settings.providerId,
      document.language,
      selectedVoice(settings, settings.providerId, document.language)
    );

    const audio = await synthesizeChunk({
      providerId: settings.providerId,
      voiceId,
      language: document.language,
      apiKey: this.apiKey,
      text: chunk.text.trim(),
      narrationStyle: settings.narrationStyle,
    });

    return {
      id: String(chunk.index),
      url: audio.uri,
      title: `${document.title} — trecho ${chunk.index + 1} de ${this.chunks.length}`,
      artist: document.title,
      album: 'VozPDF',
    };
  }

  /**
   * Mantém alguns trechos sintetizados à frente do que está tocando, para que a
   * narração não engasgue entre um trecho e o seguinte.
   */
  private async prefetch(): Promise<void> {
    if (this.prefetching || this.snapshot.engine !== 'audio') return;
    const settings = this.settings;
    if (!settings) return;

    this.prefetching = true;
    const generation = this.generation;

    try {
      while (generation === this.generation) {
        const last = this.queueChunks[this.queueChunks.length - 1];
        if (last === undefined) break;

        const activeQueueIndex = this.queueChunks.indexOf(this.snapshot.chunkIndex);
        const ahead = this.queueChunks.length - 1 - Math.max(0, activeQueueIndex);
        if (ahead >= settings.prefetchCount) break;

        const nextIndex = last + 1;
        const nextChunk = this.chunks[nextIndex];
        if (!nextChunk) break;

        const track = await this.buildTrack(nextChunk);
        if (generation !== this.generation) break;

        await TrackPlayer.add([track]);
        this.queueChunks.push(nextIndex);
        this.update({ buffered: this.queueChunks.length - 1 - Math.max(0, activeQueueIndex) });
      }

      await this.trimPlayedTracks();

      // Só depois de sintetizar é que o cache é aparado, e nunca os arquivos
      // que estão na fila prestes a tocar.
      const queued = new Set((await TrackPlayer.getQueue()).map((track) => track.url));
      trimAudioCache(settings.audioCacheLimitMb * 1024 * 1024, queued);
    } catch (error) {
      if (generation === this.generation) this.reportError(error);
    } finally {
      this.prefetching = false;
    }
  }

  /**
   * Um livro pode ter milhares de trechos; deixar todos na fila do player faria
   * a lista crescer sem limite. Descartamos os já narrados, mantendo alguns
   * atrás da posição atual para que "voltar um trecho" continue instantâneo.
   */
  private async trimPlayedTracks(): Promise<void> {
    const KEEP_BEHIND = 10;
    const TRIM_THRESHOLD = 40;

    const activeQueueIndex = this.queueChunks.indexOf(this.snapshot.chunkIndex);
    if (activeQueueIndex < TRIM_THRESHOLD) return;

    const removeCount = activeQueueIndex - KEEP_BEHIND;
    if (removeCount <= 0) return;

    const indexes = Array.from({ length: removeCount }, (_, i) => i);
    try {
      await TrackPlayer.remove(indexes);
      // Removemos sempre um prefixo, então o mapeamento posição→trecho
      // continua alinhado depois do splice.
      this.queueChunks.splice(0, removeCount);
    } catch {
      // Se o player recusar a remoção, a fila apenas continua maior.
    }
  }

  private attachPlayerListeners(): void {
    for (const subscription of this.subscriptions.splice(0)) subscription.remove();

    this.subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackActiveTrackChanged, ({ track }) => {
        const chunkIndex = Number(track?.id);
        if (!Number.isFinite(chunkIndex)) return;
        this.update({ chunkIndex, chunkFraction: 0 });
        void this.persistProgress(true);
        void this.prefetch();
      })
    );

    this.subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackProgressUpdated, ({ position, duration }) => {
        const fraction = duration > 0 ? Math.min(1, position / duration) : 0;
        this.update({ chunkFraction: fraction });
        void this.persistProgress(false);
      })
    );

    this.subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackState, ({ state }) => {
        if (state === State.Playing) this.update({ status: 'playing', message: null });
        else if (state === State.Paused || state === State.Stopped) {
          if (this.snapshot.status !== 'finished') this.update({ status: 'paused' });
        } else if (state === State.Buffering || state === State.Loading) {
          this.update({ status: 'preparing' });
        }
      })
    );

    this.subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackQueueEnded, () => {
        const last = this.queueChunks[this.queueChunks.length - 1] ?? 0;
        if (last >= this.chunks.length - 1) {
          this.update({ status: 'finished', chunkFraction: 1 });
          void this.markCompleted();
        } else {
          // A fila acabou antes do documento: a síntese não acompanhou.
          this.update({ status: 'preparing', message: 'Preparando o próximo trecho…' });
          void this.prefetch().then(() => TrackPlayer.play());
        }
      })
    );

    this.subscriptions.push(
      TrackPlayer.addEventListener(Event.PlaybackError, ({ message }) => {
        this.update({ status: 'error', message: `Falha ao tocar o áudio: ${message}` });
      })
    );
  }

  // ---------------------------------------------------------------- voz do sistema

  private async speakCurrentChunkOnDevice(): Promise<void> {
    const document = this.document;
    const settings = this.settings;
    const chunk = this.chunks[this.snapshot.chunkIndex];
    if (!document || !settings || !chunk) return;

    Speech.stop();
    this.deviceSpeaking = true;
    await activateKeepAwakeAsync('vozpdf-device-speech').catch(() => undefined);
    this.update({ status: 'playing', message: null });

    const voice = selectedVoice(settings, 'device', document.language);
    const generation = this.generation;

    Speech.speak(chunk.text.trim(), {
      language: document.language,
      voice: voice || undefined,
      rate: settings.speed,
      onDone: () => {
        if (!this.deviceSpeaking || generation !== this.generation) return;
        const next = this.snapshot.chunkIndex + 1;
        if (next >= this.chunks.length) {
          this.deviceSpeaking = false;
          deactivateKeepAwake().catch(() => undefined);
          this.update({ status: 'finished', chunkFraction: 1 });
          void this.markCompleted();
          return;
        }
        this.update({ chunkIndex: next, chunkFraction: 0 });
        void this.persistProgress(true);
        void this.speakCurrentChunkOnDevice();
      },
      onError: (error) => {
        this.deviceSpeaking = false;
        this.update({ status: 'error', message: `A voz do aparelho falhou: ${error.message}` });
      },
    });
  }

  // ---------------------------------------------------------------- posição salva

  private async persistProgress(force: boolean): Promise<void> {
    const document = this.document;
    if (!document) return;
    const now = Date.now();
    if (!force && now - this.lastSavedAt < PROGRESS_SAVE_INTERVAL_MS) return;
    this.lastSavedAt = now;

    await saveProgress(
      progressAt(document.id, this.chunks, this.snapshot.chunkIndex, this.snapshot.chunkFraction)
    );
  }

  private async markCompleted(): Promise<void> {
    const document = this.document;
    if (!document) return;
    await saveProgress({
      ...progressAt(document.id, this.chunks, this.chunks.length - 1, 1),
      completed: true,
    });
  }

  // ---------------------------------------------------------------- temporizador

  private scheduleSleepTimer(): void {
    this.clearSleepTimer();
    const minutes = this.settings?.sleepTimerMinutes;
    if (!minutes) return;
    this.sleepTimer = setTimeout(
      () => {
        void this.pause();
      },
      minutes * 60 * 1000
    );
  }

  private clearSleepTimer(): void {
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
  }

  // ---------------------------------------------------------------- erros

  private reportError(error: unknown): void {
    const message =
      error instanceof SynthesisError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Não foi possível narrar este trecho.';
    this.update({ status: 'error', message });
  }
}

export const playbackController = new PlaybackController();
