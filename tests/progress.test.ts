import { describe, expect, it } from 'vitest';

import { buildChunks } from '../src/core/text/chunk';
import {
  completionRatio,
  createProgress,
  estimateRemainingSeconds,
  formatDuration,
  progressAt,
  resolveProgress,
} from '../src/core/reading/progress';

const TEXT = Array.from(
  { length: 30 },
  (_, index) => `Esta é a frase número ${index + 1} de um documento de teste bastante comprido.`
).join(' ');

const chunks = buildChunks(TEXT, { targetChars: 160, maxChars: 300 });

describe('memória de leitura', () => {
  it('começa do início', () => {
    const progress = createProgress('doc-1');
    expect(progress.chunkIndex).toBe(0);
    expect(progress.charOffset).toBe(0);
    expect(completionRatio(progress, chunks)).toBe(0);
  });

  it('guarda o deslocamento em caracteres do trecho atual', () => {
    const target = chunks[4]!;
    const progress = progressAt('doc-1', chunks, 4, 0.5);
    expect(progress.charOffset).toBe(target.start);
    expect(progress.chunkFraction).toBe(0.5);
  });

  it('limita índices fora da faixa', () => {
    expect(progressAt('doc-1', chunks, -3).chunkIndex).toBe(0);
    expect(progressAt('doc-1', chunks, 9999).chunkIndex).toBe(chunks.length - 1);
  });

  it('reencontra a posição quando o fatiamento muda de tamanho', () => {
    const saved = progressAt('doc-1', chunks, 10, 0.4);
    const refatiado = buildChunks(TEXT, { targetChars: 90, maxChars: 140 });

    const resolved = resolveProgress(saved, refatiado);
    const chunk = refatiado[resolved.chunkIndex]!;

    // O novo trecho precisa conter o mesmo ponto do texto de antes.
    expect(chunk.start).toBeLessThanOrEqual(saved.charOffset);
    expect(chunk.end).toBeGreaterThan(saved.charOffset);
    // A fração do trecho antigo não vale para o novo.
    expect(resolved.chunkFraction).toBe(0);
  });

  it('preserva a fração quando o fatiamento não mudou', () => {
    const saved = progressAt('doc-1', chunks, 7, 0.75);
    const resolved = resolveProgress(saved, chunks);
    expect(resolved.chunkIndex).toBe(7);
    expect(resolved.chunkFraction).toBe(0.75);
  });

  it('lida com um documento vazio', () => {
    const resolved = resolveProgress(createProgress('doc-1'), []);
    expect(resolved.chunkIndex).toBe(0);
    expect(completionRatio(resolved, [])).toBe(0);
  });

  it('avança monotonicamente a fração concluída', () => {
    let previous = -1;
    for (let index = 0; index < chunks.length; index += 1) {
      const ratio = completionRatio(progressAt('doc-1', chunks, index), chunks);
      expect(ratio).toBeGreaterThanOrEqual(previous);
      expect(ratio).toBeLessThanOrEqual(1);
      previous = ratio;
    }
  });

  it('marca 100% quando a leitura é concluída', () => {
    const progress = { ...progressAt('doc-1', chunks, 0), completed: true };
    expect(completionRatio(progress, chunks)).toBe(1);
  });

  it('estima menos tempo restante conforme a leitura avança', () => {
    const inicio = estimateRemainingSeconds(progressAt('doc-1', chunks, 0), chunks);
    const meio = estimateRemainingSeconds(
      progressAt('doc-1', chunks, Math.floor(chunks.length / 2)),
      chunks
    );
    expect(meio).toBeLessThan(inicio);
  });

  it('estima menos tempo em velocidade maior', () => {
    const normal = estimateRemainingSeconds(progressAt('doc-1', chunks, 0), chunks, 1);
    const rapido = estimateRemainingSeconds(progressAt('doc-1', chunks, 0), chunks, 2);
    expect(rapido).toBeCloseTo(normal / 2, 5);
  });
});

describe('formatDuration', () => {
  it('formata segundos, minutos e horas', () => {
    expect(formatDuration(42)).toBe('42 s');
    expect(formatDuration(8 * 60)).toBe('8 min');
    expect(formatDuration(60 * 60)).toBe('1 h');
    expect(formatDuration(72 * 60)).toBe('1 h 12 min');
    expect(formatDuration(-5)).toBe('0 s');
  });
});
