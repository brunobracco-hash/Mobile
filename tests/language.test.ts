import { describe, expect, it } from 'vitest';

import { coerceLanguage, detectLanguage } from '../src/core/text/language';

const PT = `A independência do Brasil não foi um acontecimento isolado, mas o resultado de um
longo processo político que envolveu disputas entre as elites locais e a corte portuguesa.
Quando a família real chegou ao Rio de Janeiro, muita coisa já estava em movimento, e as
províncias do norte reagiram de maneira bastante diferente das do sul.`;

const EN = `The independence of Brazil was not an isolated event, but the result of a long
political process that involved disputes between the local elites and the Portuguese court.
By the time the royal family arrived in Rio de Janeiro, a great deal was already in motion,
and the northern provinces reacted very differently from those in the south.`;

const ES = `La independencia de Brasil no fue un acontecimiento aislado, sino el resultado de un
largo proceso político que involucró disputas entre las élites locales y la corte portuguesa.
Cuando la familia real llegó a Río de Janeiro, muchas cosas ya estaban en movimiento, y las
provincias del norte reaccionaron de manera muy distinta a las del sur.`;

describe('detectLanguage', () => {
  it('reconhece português do Brasil', () => {
    expect(detectLanguage(PT).language).toBe('pt-BR');
  });

  it('reconhece inglês dos EUA', () => {
    expect(detectLanguage(EN).language).toBe('en-US');
  });

  it('reconhece espanhol', () => {
    expect(detectLanguage(ES).language).toBe('es-ES');
  });

  it('separa português de espanhol, que são os mais parecidos', () => {
    const pt = detectLanguage(PT);
    const es = detectLanguage(ES);
    expect(pt.scores['pt-BR']).toBeGreaterThan(pt.scores['es-ES']);
    expect(es.scores['es-ES']).toBeGreaterThan(es.scores['pt-BR']);
  });

  it('devolve confiança baixa para texto sem sinal de idioma', () => {
    const guess = detectLanguage('123 456 789 ---');
    expect(guess.confidence).toBeLessThan(0.25);
  });

  it('cai em português quando não há texto nenhum', () => {
    expect(detectLanguage('').language).toBe('pt-BR');
  });
});

describe('coerceLanguage', () => {
  it('mapeia variantes para os idiomas suportados', () => {
    expect(coerceLanguage('pt')).toBe('pt-BR');
    expect(coerceLanguage('pt-PT')).toBe('pt-BR');
    expect(coerceLanguage('en-GB')).toBe('en-US');
    expect(coerceLanguage('es-419')).toBe('es-ES');
    expect(coerceLanguage('ES-MX')).toBe('es-ES');
  });

  it('devolve nulo para idiomas fora do escopo do app', () => {
    expect(coerceLanguage('fr-FR')).toBeNull();
    expect(coerceLanguage('de')).toBeNull();
    expect(coerceLanguage(undefined)).toBeNull();
  });
});
