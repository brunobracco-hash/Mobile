import type { TtsProviderDefinition, VoiceOption } from '../types';

/**
 * O Google Cloud tem vozes específicas por idioma — o nome da voz já carrega o
 * código do idioma, então a lista é separada por região.
 */
const VOICES: readonly VoiceOption[] = [
  // Português do Brasil
  {
    id: 'pt-BR-Neural2-C',
    label: 'Camila (pt-BR)',
    description: 'Feminina, natural e equilibrada',
    gender: 'feminina',
    languages: ['pt-BR'],
  },
  {
    id: 'pt-BR-Neural2-A',
    label: 'Bianca (pt-BR)',
    description: 'Feminina, tom mais alto e expressivo',
    gender: 'feminina',
    languages: ['pt-BR'],
  },
  {
    id: 'pt-BR-Neural2-B',
    label: 'Bruno (pt-BR)',
    description: 'Masculina, grave e pausada',
    gender: 'masculina',
    languages: ['pt-BR'],
  },
  {
    id: 'pt-BR-Wavenet-A',
    label: 'Beatriz (pt-BR, WaveNet)',
    description: 'Feminina, alternativa caso as Neural2 não estejam liberadas',
    gender: 'feminina',
    languages: ['pt-BR'],
  },
  // Inglês dos EUA
  {
    id: 'en-US-Neural2-F',
    label: 'Faith (en-US)',
    description: 'Feminina, clara e neutra',
    gender: 'feminina',
    languages: ['en-US'],
  },
  {
    id: 'en-US-Neural2-J',
    label: 'James (en-US)',
    description: 'Masculina, grave — timbre de narrador',
    gender: 'masculina',
    languages: ['en-US'],
  },
  {
    id: 'en-US-Neural2-D',
    label: 'Daniel (en-US)',
    description: 'Masculina, firme e articulada',
    gender: 'masculina',
    languages: ['en-US'],
  },
  // Espanhol
  {
    id: 'es-US-Neural2-A',
    label: 'Ana (es-US)',
    description: 'Feminina, latino-americana',
    gender: 'feminina',
    languages: ['es-ES'],
  },
  {
    id: 'es-US-Neural2-B',
    label: 'Bruno (es-US)',
    description: 'Masculina, latino-americana',
    gender: 'masculina',
    languages: ['es-ES'],
  },
  {
    id: 'es-ES-Neural2-C',
    label: 'Carmen (es-ES)',
    description: 'Feminina, espanhola peninsular',
    gender: 'feminina',
    languages: ['es-ES'],
  },
];

/** O Google exige o código de idioma completo do nome da voz. */
function languageCodeFromVoice(voiceId: string, fallback: string): string {
  const match = voiceId.match(/^([a-z]{2}-[A-Z]{2})-/);
  return match?.[1] ?? fallback;
}

export const googleProvider: TtsProviderDefinition = {
  id: 'google',
  name: 'Google Cloud',
  summary: 'Vozes neurais por idioma, com custo baixo por caractere. Requer chave e internet.',
  requiresApiKey: true,
  requiresNetwork: true,
  apiKeyHint: 'console.cloud.google.com › APIs e serviços › Credenciais (chave de API)',
  apiKeyPattern: /^AIza[A-Za-z0-9_-]{20,}$/,
  voices: VOICES,
  defaultVoice: {
    'pt-BR': 'pt-BR-Neural2-C',
    'en-US': 'en-US-Neural2-F',
    'es-ES': 'es-US-Neural2-A',
  },

  buildRequest({ text, voiceId, language, apiKey }) {
    const languageCode = languageCodeFromVoice(voiceId, language);
    return {
      url: `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode, name: voiceId },
        audioConfig: {
          audioEncoding: 'MP3',
          // A velocidade é controlada no player, então o áudio é sempre 1.0x.
          speakingRate: 1,
          pitch: 0,
        },
      }),
      responseKind: 'json-base64',
      base64Field: 'audioContent',
      mimeType: 'audio/mpeg',
      fileExtension: 'mp3',
    };
  },

  describeError(status, body) {
    if (status === 400 && /API key not valid/i.test(body)) return 'Chave do Google inválida.';
    if (status === 403) {
      return /has not been used|disabled/i.test(body)
        ? 'Ative a API Cloud Text-to-Speech no seu projeto do Google Cloud.'
        : 'A chave do Google não tem permissão para o Text-to-Speech.';
    }
    if (status === 429) return 'Cota do Google Cloud Text-to-Speech esgotada.';
    if (status === 400 && /voice/i.test(body)) {
      return 'Voz indisponível para este idioma no Google Cloud.';
    }
    return null;
  },
};
