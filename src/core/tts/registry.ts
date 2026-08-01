import type { LanguageCode } from '../text/language';
import { elevenLabsProvider } from './providers/elevenlabs';
import { googleProvider } from './providers/google';
import { openAiProvider } from './providers/openai';
import type { TtsProviderDefinition, TtsProviderId, VoiceOption } from './types';

/**
 * Provedor do próprio aparelho (expo-speech). Não faz requisição HTTP: a fala é
 * gerada pelo sistema operacional, então `buildRequest` nunca é chamado.
 *
 * É o único que funciona sem internet e sem chave, mas tem duas limitações que
 * a interface precisa deixar claras: a voz é a do sistema (menos natural) e o
 * iOS interrompe a fala quando o app sai da tela, porque não há um arquivo de
 * áudio para o player tocar em segundo plano.
 */
export const deviceProvider: TtsProviderDefinition = {
  id: 'device',
  name: 'Voz do aparelho',
  summary: 'Funciona offline e sem chave, com a voz do sistema. Qualidade inferior à das vozes de IA.',
  requiresApiKey: false,
  requiresNetwork: false,
  voices: [],
  defaultVoice: { 'pt-BR': '', 'en-US': '', 'es-ES': '' },
  buildRequest() {
    throw new Error('A voz do aparelho não usa requisição HTTP.');
  },
};

export const TTS_PROVIDERS: readonly TtsProviderDefinition[] = [
  elevenLabsProvider,
  openAiProvider,
  googleProvider,
  deviceProvider,
];

const BY_ID = new Map<TtsProviderId, TtsProviderDefinition>(
  TTS_PROVIDERS.map((provider) => [provider.id, provider])
);

export function getProvider(id: TtsProviderId): TtsProviderDefinition {
  const provider = BY_ID.get(id);
  if (!provider) throw new Error(`Provedor de voz desconhecido: ${id}`);
  return provider;
}

/** Vozes de um provedor recomendadas para um idioma. */
export function voicesFor(providerId: TtsProviderId, language: LanguageCode): VoiceOption[] {
  return getProvider(providerId).voices.filter((voice) => voice.languages.includes(language));
}

/**
 * Resolve a voz efetiva: a escolhida pelo usuário, se ainda for válida para o
 * idioma, ou a padrão do provedor. Vozes digitadas à mão (IDs personalizados)
 * são aceitas como estão.
 */
export function resolveVoiceId(
  providerId: TtsProviderId,
  language: LanguageCode,
  selected: string | undefined
): string {
  const provider = getProvider(providerId);
  if (!selected) return provider.defaultVoice[language];

  const known = provider.voices.find((voice) => voice.id === selected);
  if (!known) return selected; // ID personalizado
  return known.languages.includes(language) ? selected : provider.defaultVoice[language];
}
