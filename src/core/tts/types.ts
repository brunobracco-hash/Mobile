import type { LanguageCode } from '../text/language';

export type TtsProviderId = 'elevenlabs' | 'openai' | 'google' | 'device';

export interface VoiceOption {
  id: string;
  /** Nome mostrado na interface. */
  label: string;
  /** Timbre, para o usuário escolher sem precisar ouvir todas. */
  description: string;
  gender: 'feminina' | 'masculina' | 'neutra';
  /**
   * Idiomas em que a voz é recomendada. Vozes multilíngues (ElevenLabs,
   * OpenAI) valem para os três.
   */
  languages: readonly LanguageCode[];
}

export interface SynthesisRequest {
  text: string;
  voiceId: string;
  language: LanguageCode;
  apiKey: string;
  /**
   * Orientação de estilo para provedores que a aceitam. É o que aproxima a
   * narração de uma leitura humana em vez de um leitor de tela.
   */
  styleInstructions?: string;
}

/**
 * Descrição declarativa da chamada HTTP de síntese. Manter isso como dado puro
 * (em vez de um `fetch` embutido no provedor) permite testar exatamente o que
 * cada serviço recebe, sem rede.
 */
export interface SynthesisHttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  /**
   * `binary`: o corpo da resposta já é o áudio.
   * `json-base64`: o áudio vem em base64 dentro do campo `base64Field`.
   */
  responseKind: 'binary' | 'json-base64';
  base64Field?: string;
  mimeType: string;
  fileExtension: 'mp3';
}

export interface TtsProviderDefinition {
  id: TtsProviderId;
  name: string;
  /** Uma linha explicando o compromisso do provedor (qualidade, custo, rede). */
  summary: string;
  requiresApiKey: boolean;
  /** `false` para o motor do próprio aparelho, que funciona sem internet. */
  requiresNetwork: boolean;
  /** Onde o usuário consegue a chave. */
  apiKeyHint?: string;
  /** Formato esperado da chave, para validação preventiva na tela de ajustes. */
  apiKeyPattern?: RegExp;
  voices: readonly VoiceOption[];
  defaultVoice: Record<LanguageCode, string>;
  buildRequest(request: SynthesisRequest): SynthesisHttpRequest;
  /** Traduz uma resposta de erro do serviço em algo compreensível. */
  describeError?(status: number, body: string): string | null;
}

/** Instrução de estilo padrão, em cada idioma, para provedores que a aceitam. */
export const NARRATION_STYLE: Record<LanguageCode, string> = {
  'pt-BR':
    'Narre como um audiolivro profissional em português do Brasil: ritmo calmo e constante, ' +
    'pausas naturais na pontuação, entonação expressiva mas discreta, sem pressa e sem soar robótico.',
  'en-US':
    'Narrate like a professional American English audiobook: calm steady pace, natural pauses at ' +
    'punctuation, expressive but understated intonation, unhurried and never robotic.',
  'es-ES':
    'Narra como un audiolibro profesional en español: ritmo pausado y constante, pausas naturales ' +
    'en la puntuación, entonación expresiva pero sobria, sin prisa y sin sonar robótico.',
};

export class SynthesisError extends Error {
  constructor(
    message: string,
    readonly kind: 'auth' | 'quota' | 'network' | 'server' | 'unsupported' | 'unknown',
    readonly status?: number
  ) {
    super(message);
    this.name = 'SynthesisError';
  }
}
