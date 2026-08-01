import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  selectedVoice,
  withVoice,
} from '../src/core/settings/settings';

describe('normalizeSettings', () => {
  it('devolve os padrões para entrada inválida', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings('lixo')).toEqual(DEFAULT_SETTINGS);
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS);
  });

  it('mantém o motor do aparelho como padrão, por funcionar sem chave', () => {
    expect(DEFAULT_SETTINGS.providerId).toBe('device');
  });

  it('rejeita um provedor desconhecido gravado por outra versão', () => {
    expect(normalizeSettings({ providerId: 'azure' }).providerId).toBe('device');
  });

  it('limita a velocidade à faixa suportada pelo player', () => {
    expect(normalizeSettings({ speed: 9 }).speed).toBe(2.5);
    expect(normalizeSettings({ speed: 0.1 }).speed).toBe(0.5);
    expect(normalizeSettings({ speed: Number.NaN }).speed).toBe(0.5);
    expect(normalizeSettings({ speed: 1.5 }).speed).toBe(1.5);
  });

  it('limita o prefetch e o tamanho do cache', () => {
    expect(normalizeSettings({ prefetchCount: 99 }).prefetchCount).toBe(10);
    expect(normalizeSettings({ prefetchCount: 0 }).prefetchCount).toBe(1);
    expect(normalizeSettings({ audioCacheLimitMb: 1 }).audioCacheLimitMb).toBe(64);
  });

  it('descarta um temporizador de sono inválido', () => {
    expect(normalizeSettings({ sleepTimerMinutes: 0 }).sleepTimerMinutes).toBeNull();
    expect(normalizeSettings({ sleepTimerMinutes: -10 }).sleepTimerMinutes).toBeNull();
    expect(normalizeSettings({ sleepTimerMinutes: 30 }).sleepTimerMinutes).toBe(30);
    expect(normalizeSettings({ sleepTimerMinutes: 9999 }).sleepTimerMinutes).toBe(480);
  });

  it('preserva apenas vozes de provedores e idiomas conhecidos', () => {
    const settings = normalizeSettings({
      voices: {
        openai: { 'pt-BR': 'nova', 'fr-FR': 'x', 'en-US': '   ' },
        azure: { 'pt-BR': 'y' },
      },
    });
    expect(settings.voices.openai).toEqual({ 'pt-BR': 'nova' });
    expect(Object.keys(settings.voices)).toEqual(['openai']);
  });
});

describe('seleção de voz', () => {
  it('grava e lê a voz por provedor e idioma', () => {
    let settings = DEFAULT_SETTINGS;
    settings = withVoice(settings, 'openai', 'pt-BR', 'coral');
    settings = withVoice(settings, 'openai', 'en-US', 'onyx');
    settings = withVoice(settings, 'google', 'pt-BR', 'pt-BR-Neural2-B');

    expect(selectedVoice(settings, 'openai', 'pt-BR')).toBe('coral');
    expect(selectedVoice(settings, 'openai', 'en-US')).toBe('onyx');
    expect(selectedVoice(settings, 'google', 'pt-BR')).toBe('pt-BR-Neural2-B');
    expect(selectedVoice(settings, 'google', 'es-ES')).toBeUndefined();
  });

  it('não altera o objeto original', () => {
    const updated = withVoice(DEFAULT_SETTINGS, 'openai', 'pt-BR', 'coral');
    expect(DEFAULT_SETTINGS.voices).toEqual({});
    expect(updated).not.toBe(DEFAULT_SETTINGS);
  });
});
