import type { LanguageCode } from '../../text/language';
import type { TtsProviderDefinition, VoiceOption } from '../types';

const ALL_LANGUAGES: readonly LanguageCode[] = ['pt-BR', 'en-US', 'es-ES'];

/** As vozes do `gpt-4o-mini-tts` são multilíngues e aceitam direção de estilo. */
const VOICES: readonly VoiceOption[] = [
  {
    id: 'nova',
    label: 'Nova',
    description: 'Feminina, clara e articulada',
    gender: 'feminina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'shimmer',
    label: 'Shimmer',
    description: 'Feminina, leve e agradável',
    gender: 'feminina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'coral',
    label: 'Coral',
    description: 'Feminina, calorosa — boa para ficção',
    gender: 'feminina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'onyx',
    label: 'Onyx',
    description: 'Masculina, grave e pausada',
    gender: 'masculina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'echo',
    label: 'Echo',
    description: 'Masculina, neutra e estável',
    gender: 'masculina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'fable',
    label: 'Fable',
    description: 'Masculina, expressiva — timbre de contador de histórias',
    gender: 'masculina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'alloy',
    label: 'Alloy',
    description: 'Neutra, sóbria — boa para textos técnicos',
    gender: 'neutra',
    languages: ALL_LANGUAGES,
  },
];

export const openAiProvider: TtsProviderDefinition = {
  id: 'openai',
  name: 'OpenAI',
  summary: 'Vozes naturais que aceitam direção de estilo. Requer chave e internet.',
  requiresApiKey: true,
  requiresNetwork: true,
  apiKeyHint: 'platform.openai.com › API keys',
  apiKeyPattern: /^sk-[A-Za-z0-9_-]{20,}$/,
  voices: VOICES,
  defaultVoice: {
    'pt-BR': 'nova',
    'en-US': 'nova',
    'es-ES': 'nova',
  },

  buildRequest({ text, voiceId, apiKey, styleInstructions }) {
    return {
      url: 'https://api.openai.com/v1/audio/speech',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini-tts',
        input: text,
        voice: voiceId,
        response_format: 'mp3',
        ...(styleInstructions ? { instructions: styleInstructions } : {}),
      }),
      responseKind: 'binary',
      mimeType: 'audio/mpeg',
      fileExtension: 'mp3',
    };
  },

  describeError(status, body) {
    if (status === 401) return 'Chave da OpenAI inválida.';
    if (status === 429) {
      return /quota/i.test(body)
        ? 'Sua conta OpenAI está sem crédito.'
        : 'Muitas requisições à OpenAI em pouco tempo.';
    }
    if (status === 400 && /voice/i.test(body)) return 'Voz não reconhecida pela OpenAI.';
    return null;
  },
};
