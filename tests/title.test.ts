import { describe, expect, it } from 'vitest';

import { titleFromFileName } from '../src/core/library/title';

describe('titleFromFileName', () => {
  it('remove a extensão e troca separadores por espaços', () => {
    expect(titleFromFileName('historia_do_brasil.pdf')).toBe('historia do brasil');
    expect(titleFromFileName('Relatorio+Anual+2025.PDF')).toBe('Relatorio Anual 2025');
  });

  it('trata o hífen entre palavras como separador do nome do arquivo', () => {
    expect(titleFromFileName('manual-do-usuario.pdf')).toBe('manual do usuario');
    expect(titleFromFileName('relatorio - 2025.pdf')).toBe('relatorio - 2025');
  });

  it('tem um nome de reserva para arquivos sem nome útil', () => {
    expect(titleFromFileName('.pdf')).toBe('Documento sem título');
    expect(titleFromFileName('   ')).toBe('Documento sem título');
  });
});
