import { describe, expect, it } from 'vitest';

import { buildChunks, chunkIndexAtOffset, splitSentences } from '../src/core/text/chunk';

function texts(text: string) {
  return splitSentences(text).map((span) => text.slice(span.start, span.end).trim());
}

describe('splitSentences', () => {
  it('separa frases simples', () => {
    expect(texts('Primeira frase. Segunda frase! Terceira?')).toEqual([
      'Primeira frase.',
      'Segunda frase!',
      'Terceira?',
    ]);
  });

  it('não quebra em abreviações comuns dos três idiomas', () => {
    expect(texts('O Dr. Silva chegou.')).toEqual(['O Dr. Silva chegou.']);
    expect(texts('Mr. Smith arrived.')).toEqual(['Mr. Smith arrived.']);
    expect(texts('El Sr. Pérez llegó.')).toEqual(['El Sr. Pérez llegó.']);
  });

  it('não quebra em números decimais nem em iniciais', () => {
    expect(texts('O valor é 3.14 no total.')).toEqual(['O valor é 3.14 no total.']);
    expect(texts('J. R. R. Tolkien escreveu isso.')).toEqual(['J. R. R. Tolkien escreveu isso.']);
  });

  it('trata reticências e pontuação combinada como um só fim de frase', () => {
    expect(texts('Ele hesitou... Depois falou.')).toEqual(['Ele hesitou...', 'Depois falou.']);
    expect(texts('Sério?! Não acredito.')).toEqual(['Sério?!', 'Não acredito.']);
  });

  it('mantém aspas de fechamento na frase que termina', () => {
    expect(texts('Ele disse "vamos." Depois saiu.')).toEqual([
      'Ele disse "vamos."',
      'Depois saiu.',
    ]);
  });

  it('quebra em fim de parágrafo', () => {
    expect(texts('Sem ponto final\n\nOutro parágrafo')).toEqual([
      'Sem ponto final',
      'Outro parágrafo',
    ]);
  });

  it('cobre o texto inteiro sem lacunas nem sobreposições', () => {
    const text = 'Uma frase. Outra frase!\n\nUm parágrafo novo sem ponto';
    const spans = splitSentences(text);
    expect(spans[0]!.start).toBe(0);
    expect(spans[spans.length - 1]!.end).toBe(text.length);
    for (let i = 1; i < spans.length; i += 1) {
      expect(spans[i]!.start).toBe(spans[i - 1]!.end);
    }
  });
});

describe('buildChunks', () => {
  const paragraph =
    'A leitura de um livro inteiro em voz alta exige que o texto seja dividido em trechos. ' +
    'Cada trecho vira uma requisição ao serviço de voz e uma faixa na fila do player. ' +
    'Trechos curtos começam a tocar mais rápido; trechos longos soam mais naturais. ' +
    'O equilíbrio entre os dois é o que define a experiência de escuta.';

  it('agrupa frases curtas até chegar perto do tamanho alvo', () => {
    const chunks = buildChunks(paragraph, { targetChars: 200, maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(400);
    }
  });

  it('cobre o texto inteiro, sem lacunas, com índices sequenciais', () => {
    const chunks = buildChunks(paragraph, { targetChars: 120, maxChars: 200 });
    expect(chunks[0]!.start).toBe(0);
    expect(chunks[chunks.length - 1]!.end).toBe(paragraph.length);
    chunks.forEach((chunk, index) => {
      expect(chunk.index).toBe(index);
      expect(chunk.text).toBe(paragraph.slice(chunk.start, chunk.end));
      if (index > 0) expect(chunk.start).toBe(chunks[index - 1]!.end);
    });
  });

  it('quebra à força uma frase maior que o limite', () => {
    const enormous = `${'palavra '.repeat(200)}fim.`;
    const chunks = buildChunks(enormous, { targetChars: 300, maxChars: 400 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(400);
    }
    expect(chunks.map((chunk) => chunk.text).join('')).toBe(enormous);
  });

  it('devolve lista vazia para texto em branco', () => {
    expect(buildChunks('   \n\n  ')).toEqual([]);
  });

  it('nunca produz um trecho só de espaços', () => {
    const chunks = buildChunks('Uma frase.\n\n\n\nOutra frase.', { targetChars: 10, maxChars: 20 });
    for (const chunk of chunks) {
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('chunkIndexAtOffset', () => {
  const chunks = buildChunks('Uma frase. Outra frase. Terceira frase. Quarta frase.', {
    targetChars: 12,
    maxChars: 30,
  });

  it('encontra o trecho que contém o deslocamento', () => {
    for (const chunk of chunks) {
      expect(chunkIndexAtOffset(chunks, chunk.start)).toBe(chunk.index);
      expect(chunkIndexAtOffset(chunks, chunk.end - 1)).toBe(chunk.index);
    }
  });

  it('limita deslocamentos fora da faixa', () => {
    expect(chunkIndexAtOffset(chunks, -50)).toBe(0);
    expect(chunkIndexAtOffset(chunks, 10_000)).toBe(chunks.length - 1);
    expect(chunkIndexAtOffset([], 5)).toBe(0);
  });
});
