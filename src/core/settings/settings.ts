import type { LanguageCode } from '../text/language';
import { SUPPORTED_LANGUAGES } from '../text/language';
import type { TtsProviderId } from '../tts/types';

export const SPEED_RANGE = { min: 0.5, max: 2.5, step: 0.05 } as const;

export interface AppSettings {
  providerId: TtsProviderId;
  /** Voz escolhida por provedor e idioma. */
  voices: Partial<Record<TtsProviderId, Partial<Record<LanguageCode, string>>>>;
  /** Multiplicador de velocidade aplicado no player, não na síntese. */
  speed: number;
  /** Quantos trechos são sintetizados à frente do que está tocando. */
  prefetchCount: number;
  /** Envia a instrução de estilo de narração aos provedores que a aceitam. */
  narrationStyle: boolean;
  /** Minutos até a leitura parar sozinha; `null` desliga o temporizador. */
  sleepTimerMinutes: number | null;
  /** Limite do cache de áudio em disco, em megabytes. */
  audioCacheLimitMb: number;
  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: AppSettings = {
  providerId: 'device',
  voices: {},
  speed: 1,
  prefetchCount: 3,
  narrationStyle: true,
  sleepTimerMinutes: null,
  audioCacheLimitMb: 512,
  theme: 'system',
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Normaliza um objeto vindo do disco. Ajustes gravados por uma versão anterior
 * do app podem estar incompletos ou fora de faixa; nada aqui deve lançar.
 */
export function normalizeSettings(raw: unknown): AppSettings {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_SETTINGS };
  const input = raw as Partial<AppSettings>;

  const validProviders: TtsProviderId[] = ['elevenlabs', 'openai', 'google', 'device'];
  const providerId =
    input.providerId && validProviders.includes(input.providerId)
      ? input.providerId
      : DEFAULT_SETTINGS.providerId;

  const voices: AppSettings['voices'] = {};
  if (typeof input.voices === 'object' && input.voices !== null) {
    for (const provider of validProviders) {
      const perLanguage = input.voices[provider];
      if (typeof perLanguage !== 'object' || perLanguage === null) continue;
      const cleaned: Partial<Record<LanguageCode, string>> = {};
      for (const language of SUPPORTED_LANGUAGES) {
        const voice = perLanguage[language];
        if (typeof voice === 'string' && voice.trim().length > 0) cleaned[language] = voice.trim();
      }
      if (Object.keys(cleaned).length > 0) voices[provider] = cleaned;
    }
  }

  const sleepTimer =
    typeof input.sleepTimerMinutes === 'number' && input.sleepTimerMinutes > 0
      ? Math.round(clamp(input.sleepTimerMinutes, 1, 480))
      : null;

  return {
    providerId,
    voices,
    speed: clamp(input.speed ?? DEFAULT_SETTINGS.speed, SPEED_RANGE.min, SPEED_RANGE.max),
    prefetchCount: Math.round(clamp(input.prefetchCount ?? DEFAULT_SETTINGS.prefetchCount, 1, 10)),
    narrationStyle: input.narrationStyle ?? DEFAULT_SETTINGS.narrationStyle,
    sleepTimerMinutes: sleepTimer,
    audioCacheLimitMb: Math.round(
      clamp(input.audioCacheLimitMb ?? DEFAULT_SETTINGS.audioCacheLimitMb, 64, 8192)
    ),
    theme:
      input.theme === 'light' || input.theme === 'dark' || input.theme === 'system'
        ? input.theme
        : DEFAULT_SETTINGS.theme,
  };
}

export function selectedVoice(
  settings: AppSettings,
  providerId: TtsProviderId,
  language: LanguageCode
): string | undefined {
  return settings.voices[providerId]?.[language];
}

export function withVoice(
  settings: AppSettings,
  providerId: TtsProviderId,
  language: LanguageCode,
  voiceId: string
): AppSettings {
  return {
    ...settings,
    voices: {
      ...settings.voices,
      [providerId]: { ...settings.voices[providerId], [language]: voiceId },
    },
  };
}
