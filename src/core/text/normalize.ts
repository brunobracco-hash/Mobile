/**
 * Limpeza do texto cru vindo do pdf.js.
 *
 * O objetivo não é fidelidade visual, e sim um texto que soe bem quando lido em
 * voz alta: sem cabeçalhos repetidos a cada página, sem números de página
 * soltos no meio da frase e sem palavras quebradas por hifenização de linha.
 */

/** Caracteres que o pdf.js costuma entregar e que atrapalham a narração. */
const LIGATURES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\uFB00/g, 'ff'],
  [/\uFB01/g, 'fi'],
  [/\uFB02/g, 'fl'],
  [/\uFB03/g, 'ffi'],
  [/\uFB04/g, 'ffl'],
  [/\uFB05/g, 'st'],
  [/\uFB06/g, 'st'],
];

const SENTENCE_END = /[.!?\u2026][\u201D'"\u00BB)\]]?$/;

/** Uma linha que é só um número (ou "12 | Capítulo 3") é numeração de página. */
const PAGE_NUMBER_LINE = /^\s*(?:[-–—[(]\s*)?(?:p[áa]g(?:ina)?\.?\s*)?\d{1,4}(?:\s*[-–—\])|/]\s*.*)?$/i;

export interface NormalizeOptions {
  /**
   * Fração mínima de páginas em que uma linha precisa aparecer para ser
   * considerada cabeçalho/rodapé recorrente.
   */
  runningHeaderThreshold?: number;
  /** Número de linhas do topo e da base examinadas em busca de recorrência. */
  runningHeaderWindow?: number;
}

const DEFAULT_OPTIONS: Required<NormalizeOptions> = {
  runningHeaderThreshold: 0.6,
  runningHeaderWindow: 2,
};

function stripInvisible(text: string): string {
  return text
    .replace(/\u00AD/g, '') // hifen opcional (soft hyphen)
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // caracteres de largura zero
    .replace(/[\u00A0\u2007\u202F]/g, ' '); // espacos inquebraveis
}

function applyLigatures(text: string): string {
  return LIGATURES.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);
}

function normalizeQuotes(text: string): string {
  return text.replace(/[‘’‛]/g, "'").replace(/[“”‟]/g, '"');
}

function cleanLine(line: string): string {
  return line.replace(/[\t ]+/g, ' ').trim();
}

/**
 * Identifica linhas que se repetem no topo ou na base da maioria das páginas
 * (título corrente, nome do autor, rodapé institucional) e as remove.
 */
export function stripRunningHeaders(pages: string[], options: NormalizeOptions = {}): string[] {
  const { runningHeaderThreshold, runningHeaderWindow } = { ...DEFAULT_OPTIONS, ...options };
  if (pages.length < 3) return pages;

  const occurrences = new Map<string, number>();
  const candidatesPerPage = pages.map((page) => {
    const lines = page
      .split('\n')
      .map(cleanLine)
      .filter((line) => line.length > 0);
    const head = lines.slice(0, runningHeaderWindow);
    const tail = lines.slice(Math.max(0, lines.length - runningHeaderWindow));
    return new Set([...head, ...tail]);
  });

  for (const candidates of candidatesPerPage) {
    for (const line of candidates) {
      // Linhas longas raramente são cabeçalho; linhas idênticas curtas, sim.
      if (line.length > 90) continue;
      // Uma linha terminada em hífen é uma palavra quebrada, nunca um cabeçalho:
      // removê-la deixaria a palavra seguinte mutilada.
      if (/[-‐]$/.test(line)) continue;
      occurrences.set(line, (occurrences.get(line) ?? 0) + 1);
    }
  }

  const minPages = Math.max(3, Math.ceil(pages.length * runningHeaderThreshold));
  const repeated = new Set(
    [...occurrences.entries()].filter(([, count]) => count >= minPages).map(([line]) => line)
  );
  if (repeated.size === 0) return pages;

  return pages.map((page, pageIndex) =>
    page
      .split('\n')
      .filter((line) => {
        const cleaned = cleanLine(line);
        if (cleaned.length === 0) return true;
        if (!repeated.has(cleaned)) return true;
        // Só remove se a linha estiver na janela de topo/base desta página.
        return !candidatesPerPage[pageIndex]?.has(cleaned);
      })
      .join('\n')
  );
}

/** Remove linhas que contêm apenas numeração de página. */
export function stripPageNumbers(text: string): string {
  return text
    .split('\n')
    .filter((line) => {
      const cleaned = cleanLine(line);
      if (cleaned.length === 0) return true;
      if (cleaned.length > 24) return true;
      return !PAGE_NUMBER_LINE.test(cleaned);
    })
    .join('\n');
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/**
 * Junta as linhas de um mesmo parágrafo.
 *
 * Um PDF não marca parágrafos: cada linha visual vira uma quebra. As regras:
 *
 *   - linha em branco sempre separa parágrafos;
 *   - linha terminada em hífen é emendada na seguinte (palavra quebrada);
 *   - linha terminada em pontuação final **e** visivelmente mais curta que a
 *     largura do bloco encerra o parágrafo — é a última linha dele;
 *   - nos demais casos as linhas são unidas por espaço.
 */
export function joinWrappedLines(text: string): string {
  const rawLines = text.split('\n').map(cleanLine);
  const nonEmpty = rawLines.filter((line) => line.length > 0);
  const typicalWidth = median(nonEmpty.map((line) => line.length));
  // Com poucas linhas não dá para estimar a largura do bloco: aí qualquer
  // término de frase encerra o parágrafo.
  const shortLineLimit = nonEmpty.length >= 4 ? typicalWidth * 0.85 : Number.POSITIVE_INFINITY;

  const paragraphs: string[] = [];
  let current = '';

  const flush = () => {
    const trimmed = current.trim();
    if (trimmed.length > 0) paragraphs.push(trimmed);
    current = '';
  };

  for (const line of rawLines) {
    if (line.length === 0) {
      flush();
      continue;
    }

    if (current.length === 0) {
      current = line;
    } else if (/[-‐]$/.test(current)) {
      const withoutHyphen = current.slice(0, -1);
      // "bem-\nestar" mantém o hífen; "conti-\nnuação" não.
      current = /^[a-zà-öø-ÿ]/.test(line) ? withoutHyphen + line : `${current}${line}`;
    } else {
      current = `${current} ${line}`;
    }

    if (SENTENCE_END.test(line) && line.length < shortLineLimit) flush();
  }
  flush();

  return paragraphs.join('\n\n');
}

/**
 * Pipeline completo: recebe o texto de cada página do PDF e devolve o texto
 * pronto para ser fatiado em trechos de narração.
 */
export function normalizePdfPages(pages: string[], options: NormalizeOptions = {}): string {
  const withoutHeaders = stripRunningHeaders(pages, options);
  const cleanedPages = withoutHeaders.map((page) => {
    let text = page.normalize('NFC');
    text = stripInvisible(text);
    text = applyLigatures(text);
    text = normalizeQuotes(text);
    text = stripPageNumbers(text);
    return joinWrappedLines(text);
  });

  return cleanedPages
    .filter((page) => page.trim().length > 0)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Um PDF digitalizado sem camada de texto devolve praticamente nada. Usamos
 * isso para avisar o usuário em vez de abrir um documento mudo.
 */
export function looksLikeScannedPdf(pages: string[]): boolean {
  if (pages.length === 0) return true;
  const totalChars = pages.reduce((sum, page) => sum + page.replace(/\s/g, '').length, 0);
  // Uma página digitalizada devolve zero ou um punhado de caracteres soltos;
  // qualquer página com texto de verdade passa de longe deste limite.
  return totalChars / pages.length < 25;
}
