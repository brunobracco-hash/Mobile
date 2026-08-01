import type { LanguageCode } from '../../text/language';
import type { TtsProviderDefinition, VoiceOption } from '../types';

const ALL_LANGUAGES: readonly LanguageCode[] = ['pt-BR', 'en-US', 'es-ES'];

/**
 * O modelo multilíngue da ElevenLabs usa o mesmo timbre em qualquer idioma:
 * a mesma voz lê português, inglês e espanhol com sotaque nativo. Por isso a
 * lista não é separada por idioma.
 */
const VOICES: readonly VoiceOption[] = [
  {
    id: '21m00Tcm4TlvDq8ikWAM',
    label: 'Rachel',
    description: 'Feminina, serena e clara — boa para textos longos',
    gender: 'feminina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'EXAVITQu4vr4xnSDxMaL',
    label: 'Bella',
    description: 'Feminina, jovem e expressiva',
    gender: 'feminina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'MF3mGyEYCl7XYWbV9V6O',
    label: 'Elli',
    description: 'Feminina, suave e acolhedora',
    gender: 'feminina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'pNInz6obpgDQGcFmaJgB',
    label: 'Adam',
    description: 'Masculina, grave e firme — timbre de narrador',
    gender: 'masculina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'ErXwobaYiN019PkySvjV',
    label: 'Antoni',
    description: 'Masculina, calorosa e conversacional',
    gender: 'masculina',
    languages: ALL_LANGUAGES,
  },
  {
    id: 'TxGEqnHWrfWFTfGW9XjX',
    label: 'Josh',
    description: 'Masculina, jovem e enérgica',
    gender: 'masculina',
    languages: ALL_LANGUAGES,
  },
];

export const elevenLabsProvider: TtsProviderDefinition = {
  id: 'elevenlabs',
  name: 'ElevenLabs',
  summary: 'A narração mais próxima de uma leitura humana. Requer chave e internet.',
  requiresApiKey: true,
  requiresNetwork: true,
  apiKeyHint: 'elevenlabs.io › Profile › API Key',
  apiKeyPattern: /^[A-Za-z0-9_-]{20,}$/,
  voices: VOICES,
  defaultVoice: {
    'pt-BR': '21m00Tcm4TlvDq8ikWAM',
    'en-US': '21m00Tcm4TlvDq8ikWAM',
    'es-ES': '21m00Tcm4TlvDq8ikWAM',
  },

  buildRequest({ text, voiceId, apiKey }) {
    return {
      url:
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}` +
        '?output_format=mp3_44100_128',
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        // `eleven_multilingual_v2` cobre os três idiomas com o mesmo timbre.
        model_id: 'eleven_multilingual_v2',
        voice_settings: {
          // Estabilidade alta evita variações bruscas entre trechos
          // consecutivos, que numa leitura contínua ficam evidentes.
          stability: 0.55,
          similarity_boost: 0.75,
          style: 0.15,
          use_speaker_boost: true,
        },
      }),
      responseKind: 'binary',
      mimeType: 'audio/mpeg',
      fileExtension: 'mp3',
    };
  },

  describeError(status, body) {
    if (status === 401) return 'Chave da ElevenLabs inválida ou expirada.';
    if (status === 422 && /voice/i.test(body)) {
      return 'Esta voz não está disponível na sua conta ElevenLabs.';
    }
    if (status === 429) return 'Limite de caracteres da ElevenLabs atingido.';
    return null;
  },
};
