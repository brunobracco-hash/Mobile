import { describe, expect, it } from 'vitest';

import {
  joinWrappedLines,
  looksLikeScannedPdf,
  normalizePdfPages,
  stripPageNumbers,
  stripRunningHeaders,
} from '../src/core/text/normalize';

describe('joinWrappedLines', () => {
  it('junta as linhas de um parágrafo quebrado pela largura da página', () => {
    const text = [
      'A leitura em voz alta de textos longos exige que o',
      'texto seja remontado, porque o PDF quebra cada linha',
      'na largura da coluna e não no fim da frase.',
    ].join('\n');

    expect(joinWrappedLines(text)).toBe(
      'A leitura em voz alta de textos longos exige que o texto seja remontado, porque o PDF ' +
        'quebra cada linha na largura da coluna e não no fim da frase.'
    );
  });

  it('remonta palavras hifenizadas na quebra de linha', () => {
    const text = ['O processo de reconstru-', 'ção do texto elimina a hifeniza-', 'ção de fim de linha.'].join(
      '\n'
    );
    expect(joinWrappedLines(text)).toContain('reconstrução');
    expect(joinWrappedLines(text)).toContain('hifenização');
  });

  it('preserva o hífen de palavras compostas', () => {
    const text = ['Ele buscava o bem-', 'Estar coletivo acima de tudo.'].join('\n');
    expect(joinWrappedLines(text)).toContain('bem-Estar');
  });

  it('separa parágrafos quando a linha final é mais curta que o bloco', () => {
    const text = [
      'Primeiro parágrafo com uma linha bem longa para definir a largura.',
      'Ele continua por mais uma linha igualmente longa, definindo a média.',
      'E termina aqui.',
      'Segundo parágrafo começa com outra linha longa o suficiente para medir.',
      'E também termina curto.',
    ].join('\n');

    const paragraphs = joinWrappedLines(text).split('\n\n');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toContain('Primeiro parágrafo');
    expect(paragraphs[1]).toContain('Segundo parágrafo');
  });

  it('trata linha em branco como separador de parágrafo', () => {
    expect(joinWrappedLines('Um.\n\nDois.')).toBe('Um.\n\nDois.');
  });
});

describe('stripPageNumbers', () => {
  it('remove linhas que só têm numeração', () => {
    const text = ['Texto de verdade.', '12', 'Mais texto.', 'Página 13', 'Fim.'].join('\n');
    expect(stripPageNumbers(text).split('\n')).toEqual(['Texto de verdade.', 'Mais texto.', 'Fim.']);
  });

  it('não remove uma frase que começa com número', () => {
    const text = '1968 foi um ano decisivo para o movimento estudantil brasileiro.';
    expect(stripPageNumbers(text)).toBe(text);
  });
});

describe('stripRunningHeaders', () => {
  it('remove o título corrente repetido no topo das páginas', () => {
    const pages = Array.from({ length: 6 }, (_, index) =>
      ['MANUAL DO USUÁRIO', `Conteúdo exclusivo da página ${index + 1}.`].join('\n')
    );

    const result = stripRunningHeaders(pages);
    expect(result.join('\n')).not.toContain('MANUAL DO USUÁRIO');
    expect(result.join('\n')).toContain('Conteúdo exclusivo da página 3.');
  });

  it('mantém uma linha que se repete apenas em poucas páginas', () => {
    const pages = [
      'Introdução\nTexto um.',
      'Introdução\nTexto dois.',
      'Outro título\nTexto três.',
      'Outro título\nTexto quatro.',
      'Mais um\nTexto cinco.',
      'E outro\nTexto seis.',
    ];
    expect(stripRunningHeaders(pages).join('\n')).toContain('Introdução');
  });

  it('não mexe em documentos com menos de três páginas', () => {
    const pages = ['Capa', 'Capa'];
    expect(stripRunningHeaders(pages)).toEqual(pages);
  });
});

describe('normalizePdfPages', () => {
  it('aplica a limpeza completa e produz parágrafos separados', () => {
    const pages = Array.from({ length: 4 }, (_, index) =>
      [
        'HISTÓRIA DO BRASIL',
        'A independência foi proclamada em um contexto de disputas polí-',
        `ticas internas e pressões externas na página ${index + 1}.`,
        `${index + 1}`,
      ].join('\n')
    );

    const text = normalizePdfPages(pages);
    expect(text).not.toContain('HISTÓRIA DO BRASIL');
    expect(text).toContain('políticas internas');
    expect(text).not.toMatch(/^\d+$/m);
  });

  it('normaliza ligaduras e aspas tipográficas', () => {
    const text = normalizePdfPages(['A ﬁgura “central” do relato.']);
    expect(text).toContain('figura');
    expect(text).toContain('"central"');
  });
});

describe('looksLikeScannedPdf', () => {
  it('reconhece um PDF digitalizado sem camada de texto', () => {
    expect(looksLikeScannedPdf(['', '  ', '\n'])).toBe(true);
  });

  it('não acusa um PDF com texto de verdade', () => {
    const pages = Array.from(
      { length: 3 },
      () => 'Um parágrafo com bastante texto legível para não parecer digitalizado.'
    );
    expect(looksLikeScannedPdf(pages)).toBe(false);
  });
});
