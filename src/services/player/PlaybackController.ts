import {
  createAudioPlayer,
  preload,
  requestNotificationPermissionsAsync,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
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

export type PlaybackStatus = 'idle' | 'preparing' | 'playing' | 'paused' | 'finished' | 'error';

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

/** Frequência dos eventos de posição do player, em milissegundos. */
const STATUS_UPDATE_INTERVAL_MS = 500;

/**
 * Orquestra a leitura em voz alta de um documento.
 *
 * Existem dois motores:
 *
 *  - **audio** — cada trecho é sintetizado em um arquivo mp3 e tocado pelo
 *    `expo-audio`. É o modo completo: no Android o áudio roda num serviço de
 *    mídia em primeiro plano e no iOS sob o modo de fundo `audio`, então a
 *    leitura continua com a tela apagada e aparece na tela bloqueada.
 *  - **device** — o sistema operacional fala o texto (`expo-speech`). Funciona
 *    offline e sem chave, mas não produz arquivo, então não há controles de
 *    mídia e o iOS interrompe a fala quando o app deixa a tela.
 *
 * Como o player toca um arquivo por vez, o encadeamento dos trechos é feito
 * aqui: ao terminar um trecho trocamos a fonte pelo seguinte, que já foi
 * sintetizado e pré-carregado enquanto o anterior tocava.
 */
export class PlaybackController {
  private listeners = new Set<(snapshot: PlaybackSnapshot) => void>();
  private snapshot: PlaybackSnapshot = IDLE_SNAPSHOT;

  private document: DocumentRecord | null = null;
  private chunks: TextChunk[] = [];
  private settings: AppSettings | null = null;
  private apiKey = '';

  private player: AudioPlayer | null = null;
  private playerSubscription: { remove(): void } | null = null;
  private audioModeReady = false;

  /** Arquivos já sintetizados, por índice de trecho. */
  private readyAudio = new Map<number, string>();
  /** Invalida operações assíncronas em voo quando o documento ou a voz mudam. */
  private generation = 0;
  private prefetching = false;
  private advancing = false;
  private lastSavedAt = 0;
  private sleepTimer: ReturnType<typeof setTimeout> | null = null;
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
  }

  /** Aplica ajustes alterados durante a leitura (voz, velocidade, prefetch). */
  async applySettings(settings: AppSettings): Promise<void> {
    const previous = this.settings;
    this.settings = settings;

    const provider = getProvider(settings.providerId);
    this.apiKey = provider.requiresApiKey ? ((await getApiKey(provider.id)) ?? '') : '';

    if (this.snapshot.speed !== settings.speed) {
      this.update({ speed: settings.speed });
      this.player?.setPlaybackRate(settings.speed, 'high');
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
      // O áudio em disco é da voz antiga: recomeça o trecho atual com a nova.
      const wasPlaying = this.snapshot.status === 'playing';
      await this.teardownPlayback();
      this.update({ engine: provider.requiresNetwork ? 'audio' : 'device', chunkFraction: 0 });
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
    this.generation += 1;
    this.clearSleepTimer();
    this.readyAudio.clear();
    this.advancing = false;

    this.deviceSpeaking = false;
    Speech.stop();
    deactivateKeepAwake().catch(() => undefined);

    this.playerSubscription?.remove();
    this.playerSubscription = null;

    if (this.player) {
      try {
        this.player.pause();
        this.player.clearLockScreenControls();
        this.player.remove();
      } catch {
        // O player já pode ter sido liberado.
      }
      this.player = null;
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
      if (this.player) {
        this.player.play();
        this.update({ status: 'playing', message: null });
        void this.prefetch();
        return;
      }

      this.update({ status: 'preparing', message: 'Preparando a narração…' });
      await this.ensureAudioMode();

      const generation = this.generation;
      const uri = await this.audioForChunk(this.snapshot.chunkIndex);
      if (generation !== this.generation) return;

      const player = createAudioPlayer(uri, { updateInterval: STATUS_UPDATE_INTERVAL_MS });
      this.player = player;
      this.playerSubscription = player.addListener('playbackStatusUpdate', (status) => {
        this.onStatus(status, generation);
      });

      player.setPlaybackRate(this.snapshot.speed, 'high');
      this.updateLockScreen();
      player.play();

      // Retoma de onde parou dentro do trecho.
      if (this.snapshot.chunkFraction > 0 && this.snapshot.chunkFraction < 1) {
        const seekTarget = this.snapshot.chunkFraction;
        void this.seekToFractionWhenLoaded(player, seekTarget, generation);
      }

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
      this.player?.pause();
    }
    this.update({ status: 'paused' });
    await this.persistProgress(true);
  }

  async toggle(): Promise<void> {
    if (this.snapshot.status === 'playing') await this.pause();
    else await this.play();
  }

  async skipChunks(delta: number): Promise<void> {
    await this.goToChunk(this.snapshot.chunkIndex + delta);
  }

  /** Move a leitura para um trecho específico. */
  async goToChunk(index: number): Promise<void> {
    if (this.chunks.length === 0) return;
    const target = clampIndex(index, this.chunks.length);
    const wasPlaying = this.snapshot.status === 'playing';

    this.update({ chunkIndex: target, chunkFraction: 0, status: wasPlaying ? 'preparing' : 'paused' });
    await this.persistProgress(true);

    if (this.snapshot.engine === 'device') {
      Speech.stop();
      if (wasPlaying) await this.speakCurrentChunkOnDevice();
      else this.update({ status: 'paused' });
      return;
    }

    if (!this.player) {
      if (wasPlaying) await this.play();
      else this.update({ status: 'paused' });
      return;
    }

    try {
      const generation = this.generation;
      const uri = await this.audioForChunk(target);
      if (generation !== this.generation || !this.player) return;

      this.player.replace(uri);
      this.updateLockScreen();
      if (wasPlaying) {
        this.player.play();
        this.update({ status: 'playing', message: null });
      }
      void this.prefetch();
    } catch (error) {
      this.reportError(error);
    }
  }

  async setSpeed(speed: number): Promise<void> {
    this.update({ speed });
    if (this.snapshot.engine === 'audio') this.player?.setPlaybackRate(speed, 'high');
    else if (this.snapshot.status === 'playing') await this.speakCurrentChunkOnDevice();
  }

  // ---------------------------------------------------------------- motor de áudio

  private async ensureAudioMode(): Promise<void> {
    if (this.audioModeReady) return;
    await setAudioModeAsync({
      // É o que mantém a narração tocando com a tela apagada.
      shouldPlayInBackground: true,
      playsInSilentMode: true,
      // Exigido para o sistema associar os controles da tela bloqueada ao player.
      interruptionMode: 'doNotMix',
    });
    // A notificação de mídia do Android 13+ depende desta permissão.
    await requestNotificationPermissionsAsync().catch(() => undefined);
    this.audioModeReady = true;
  }

  /** Caminho do arquivo de áudio de um trecho, sintetizando se necessário. */
  private async audioForChunk(index: number): Promise<string> {
    const cached = this.readyAudio.get(index);
    if (cached) return cached;

    const document = this.document;
    const settings = this.settings;
    const chunk = this.chunks[index];
    if (!document || !settings || !chunk) throw new Error('Nenhum trecho para narrar.');

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

    this.readyAudio.set(index, audio.uri);
    return audio.uri;
  }

  private onStatus(status: AudioStatus, generation: number): void {
    if (generation !== this.generation) return;

    if (status.duration > 0) {
      this.update({ chunkFraction: Math.min(1, status.currentTime / status.duration) });
      void this.persistProgress(false);
    }

    if (status.didJustFinish) void this.advanceToNextChunk(generation);
  }

  private async advanceToNextChunk(generation: number): Promise<void> {
    // `didJustFinish` pode chegar mais de uma vez para o mesmo fim de trecho.
    if (this.advancing || generation !== this.generation) return;
    this.advancing = true;

    try {
      const next = this.snapshot.chunkIndex + 1;
      if (next >= this.chunks.length) {
        this.update({ status: 'finished', chunkFraction: 1 });
        await this.markCompleted();
        return;
      }

      this.update({ chunkIndex: next, chunkFraction: 0 });
      await this.persistProgress(true);

      // Se a síntese ainda não alcançou este trecho, avisa em vez de emudecer.
      if (!this.readyAudio.has(next)) {
        this.update({ status: 'preparing', message: 'Preparando o próximo trecho…' });
      }
      const uri = await this.audioForChunk(next);
      if (generation !== this.generation || !this.player) return;

      this.player.replace(uri);
      this.updateLockScreen();
      this.player.play();
      this.update({ status: 'playing', message: null });
    } catch (error) {
      if (generation === this.generation) this.reportError(error);
    } finally {
      this.advancing = false;
      void this.prefetch();
    }
  }

  /**
   * Mantém alguns trechos sintetizados à frente do que está tocando, para que a
   * narração não engasgue na virada de um trecho para o outro.
   */
  private async prefetch(): Promise<void> {
    if (this.prefetching || this.snapshot.engine !== 'audio') return;
    const settings = this.settings;
    if (!settings) return;

    this.prefetching = true;
    const generation = this.generation;

    try {
      for (let offset = 1; offset <= settings.prefetchCount; offset += 1) {
        if (generation !== this.generation) return;
        const index = this.snapshot.chunkIndex + offset;
        if (index >= this.chunks.length) break;
        if (this.readyAudio.has(index)) continue;

        const uri = await this.audioForChunk(index);
        if (generation !== this.generation) return;

        // O trecho imediatamente seguinte também vai para o buffer do player,
        // para a troca de faixa ser instantânea.
        if (offset === 1) await preload(uri).catch(() => undefined);

        this.update({ buffered: this.countBufferedAhead() });
      }
      this.update({ buffered: this.countBufferedAhead() });

      // Só depois de sintetizar é que o cache é aparado, e nunca os arquivos
      // que estão prestes a tocar.
      trimAudioCache(
        settings.audioCacheLimitMb * 1024 * 1024,
        new Set(this.readyAudio.values())
      );
    } catch (error) {
      if (generation === this.generation) this.reportError(error);
    } finally {
      this.prefetching = false;
    }
  }

  private countBufferedAhead(): number {
    let count = 0;
    for (let index = this.snapshot.chunkIndex + 1; index < this.chunks.length; index += 1) {
      if (!this.readyAudio.has(index)) break;
      count += 1;
    }
    return count;
  }

  private updateLockScreen(): void {
    const player = this.player;
    const document = this.document;
    if (!player || !document) return;

    const metadata = {
      title: document.title,
      artist: `Trecho ${this.snapshot.chunkIndex + 1} de ${this.chunks.length}`,
      albumTitle: 'VozPDF',
    };

    try {
      player.setActiveForLockScreen(true, metadata, {
        showSeekForward: true,
        showSeekBackward: true,
      });
    } catch {
      // Sem controles na tela bloqueada a leitura continua normalmente.
    }
  }

  /** Retoma no meio do trecho: o `seek` só vale depois que a duração é conhecida. */
  private async seekToFractionWhenLoaded(
    player: AudioPlayer,
    fraction: number,
    generation: number
  ): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (generation !== this.generation || this.player !== player) return;
      if (player.isLoaded && player.duration > 0) {
        await player.seekTo(player.duration * fraction).catch(() => undefined);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
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
