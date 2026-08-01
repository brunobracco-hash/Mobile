import { describe, expect, it } from 'vitest';

import { SUPPORTED_LANGUAGES } from '../src/core/text/language';
import { getProvider, resolveVoiceId, TTS_PROVIDERS, voicesFor } from '../src/core/tts/registry';
import { NARRATION_STYLE } from '../src/core/tts/types';
import { audioCacheKey, stableHash } from '../src/core/util/hash';

const NETWORK_PROVIDERS = TTS_PROVIDERS.filter((provider) => provider.requiresNetwork);

describe('catálogo de provedores', () => {
  it('todo provedor de rede tem voz padrão para os três idiomas', () => {
    for (const provider of NETWORK_PROVIDERS) {
      for (const language of SUPPORTED_LANGUAGES) {
        const voiceId = provider.defaultVoice[language];
        expect(voiceId, `${provider.id}/${language}`).toBeTruthy();
        const known = provider.voices.find((voice) => voice.id === voiceId);
        expect(known, `${provider.id}/${language} deve existir no catálogo`).toBeDefined();
        expect(known!.languages).toContain(language);
      }
    }
  });

  it('oferece pelo menos uma voz feminina e uma masculina por idioma', () => {
    for (const provider of NETWORK_PROVIDERS) {
      for (const language of SUPPORTED_LANGUAGES) {
        const voices = voicesFor(provider.id, language);
        expect(voices.map((voice) => voice.gender)).toContain('feminina');
        expect(voices.map((voice) => voice.gender)).toContain('masculina');
      }
    }
  });

  it('não tem IDs de voz repetidos dentro do mesmo provedor', () => {
    for (const provider of TTS_PROVIDERS) {
      const ids = provider.voices.map((voice) => voice.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('a voz do aparelho não exige chave nem rede', () => {
    const device = getProvider('device');
    expect(device.requiresApiKey).toBe(false);
    expect(device.requiresNetwork).toBe(false);
    expect(() => device.buildRequest({ text: 'a', voiceId: '', language: 'pt-BR', apiKey: '' })).toThrow();
  });
});

describe('resolveVoiceId', () => {
  it('usa a voz padrão quando nada foi escolhido', () => {
    expect(resolveVoiceId('google', 'pt-BR', undefined)).toBe('pt-BR-Neural2-C');
  });

  it('troca a voz quando a escolhida não serve para o idioma', () => {
    // Voz brasileira selecionada, documento em inglês.
    expect(resolveVoiceId('google', 'en-US', 'pt-BR-Neural2-C')).toBe('en-US-Neural2-F');
  });

  it('mantém a voz escolhida quando ela serve para o idioma', () => {
    expect(resolveVoiceId('openai', 'es-ES', 'onyx')).toBe('onyx');
  });

  it('aceita um ID personalizado digitado pelo usuário', () => {
    expect(resolveVoiceId('elevenlabs', 'pt-BR', 'minha-voz-clonada')).toBe('minha-voz-clonada');
  });
});

describe('requisições de síntese', () => {
  const base = { text: 'Olá, mundo.', language: 'pt-BR' as const, apiKey: 'CHAVE-DE-TESTE-123456' };

  it('ElevenLabs: manda a chave no cabeçalho e pede mp3 do modelo multilíngue', () => {
    const request = getProvider('elevenlabs').buildRequest({
      ...base,
      voiceId: '21m00Tcm4TlvDq8ikWAM',
    });
    expect(request.url).toContain('/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM');
    expect(request.url).toContain('output_format=mp3');
    expect(request.headers['xi-api-key']).toBe(base.apiKey);
    expect(request.responseKind).toBe('binary');
    const body = JSON.parse(request.body);
    expect(body.model_id).toBe('eleven_multilingual_v2');
    expect(body.text).toBe(base.text);
  });

  it('OpenAI: manda Bearer, formato mp3 e a direção de estilo quando fornecida', () => {
    const request = getProvider('openai').buildRequest({
      ...base,
      voiceId: 'nova',
      styleInstructions: NARRATION_STYLE['pt-BR'],
    });
    expect(request.url).toBe('https://api.openai.com/v1/audio/speech');
    expect(request.headers.Authorization).toBe(`Bearer ${base.apiKey}`);
    const body = JSON.parse(request.body);
    expect(body.response_format).toBe('mp3');
    expect(body.voice).toBe('nova');
    expect(body.instructions).toContain('audiolivro');
  });

  it('OpenAI: omite as instruções quando o estilo está desligado', () => {
    const request = getProvider('openai').buildRequest({ ...base, voiceId: 'nova' });
    expect(JSON.parse(request.body).instructions).toBeUndefined();
  });

  it('Google: deriva o código de idioma do nome da voz e pede base64', () => {
    const request = getProvider('google').buildRequest({
      ...base,
      language: 'es-ES',
      voiceId: 'es-US-Neural2-A',
    });
    expect(request.url).toContain('texttospeech.googleapis.com');
    expect(request.url).toContain(`key=${base.apiKey}`);
    expect(request.responseKind).toBe('json-base64');
    expect(request.base64Field).toBe('audioContent');
    const body = JSON.parse(request.body);
    // A voz é es-US, então o código enviado precisa ser es-US e não es-ES.
    expect(body.voice.languageCode).toBe('es-US');
    expect(body.audioConfig.audioEncoding).toBe('MP3');
    expect(body.audioConfig.speakingRate).toBe(1);
  });

  it('escapa caracteres especiais na URL', () => {
    const request = getProvider('elevenlabs').buildRequest({ ...base, voiceId: 'voz/estranha?x=1' });
    expect(request.url).toContain('voz%2Festranha%3Fx%3D1');
  });

  it('traduz os erros mais comuns de cada serviço', () => {
    expect(getProvider('elevenlabs').describeError?.(401, '')).toMatch(/inválida/i);
    expect(getProvider('openai').describeError?.(429, 'insufficient_quota')).toMatch(/crédito/i);
    expect(getProvider('google').describeError?.(403, 'API has not been used')).toMatch(/Ative a API/i);
    expect(getProvider('openai').describeError?.(500, '')).toBeNull();
  });
});

describe('chave de cache de áudio', () => {
  const base = {
    providerId: 'openai',
    voiceId: 'nova',
    language: 'pt-BR',
    speed: 1,
    text: 'Uma frase qualquer.',
  };

  it('é estável para a mesma entrada', () => {
    expect(audioCacheKey(base)).toBe(audioCacheKey({ ...base }));
    expect(audioCacheKey(base)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('muda quando texto, voz, provedor ou idioma mudam', () => {
    const original = audioCacheKey(base);
    expect(audioCacheKey({ ...base, text: 'Outra frase.' })).not.toBe(original);
    expect(audioCacheKey({ ...base, voiceId: 'onyx' })).not.toBe(original);
    expect(audioCacheKey({ ...base, providerId: 'google' })).not.toBe(original);
    expect(audioCacheKey({ ...base, language: 'en-US' })).not.toBe(original);
  });

  it('não colide em um volume equivalente a um livro longo', () => {
    const keys = new Set<string>();
    for (let index = 0; index < 20_000; index += 1) {
      keys.add(stableHash(`trecho número ${index} de um documento extenso`));
    }
    expect(keys.size).toBe(20_000);
  });
});
