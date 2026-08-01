/**
 * Fatiamento do texto em trechos de narração.
 *
 * Cada trecho vira uma requisição ao serviço de voz e uma faixa na fila do
 * player. O tamanho é um compromisso: trechos curtos começam a tocar mais
 * rápido e dão granularidade fina para retomar a leitura; trechos longos
 * soam mais naturais (a IA controla melhor a prosódia) e custam menos
 * requisições.
 *
 * Todo trecho guarda o intervalo `[start, end)` no texto normalizado, que é o
 * que permite destacar a frase atual na tela e retomar exatamente de onde parou.
 */

export interface TextChunk {
  index: number;
  /** Deslocamento inicial no texto normalizado (inclusivo). */
  start: number;
  /** Deslocamento final no texto normalizado (exclusivo). */
  end: number;
  text: string;
}

export interface ChunkOptions {
  /** Tamanho alvo de um trecho, em caracteres. */
  targetChars?: number;
  /** Tamanho máximo absoluto; acima disso o trecho é quebrado à força. */
  maxChars?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetChars: 320,
  maxChars: 520,
};

/**
 * Abreviações que terminam em ponto sem encerrar a frase, nos três idiomas
 * suportados. Sem isso "Dr. Silva" viraria duas frases e a narração daria uma
 * pausa artificial no meio do nome.
 */
const ABBREVIATIONS = new Set([
  // Português
  'sr',
  'sra',
  'srta',
  'dr',
  'dra',
  'prof',
  'profa',
  'exmo',
  'exma',
  'ilmo',
  'av',
  'ed',
  'pág',
  'pag',
  'fl',
  'art',
  'cap',
  'séc',
  'sec',
  'obs',
  'etc',
  'ltda',
  'cia',
  'jr',
  // Espanhol
  'sres',
  'srs',
  'ud',
  'uds',
  'vd',
  'admón',
  'núm',
  'num',
  'pág',
  'ss',
  'ej',
  // Inglês
  'mr',
  'mrs',
  'ms',
  'st',
  'vs',
  'fig',
  'eq',
  'no',
  'vol',
  'ch',
  'pp',
  'ed',
  'al',
  'inc',
  'ltd',
  'approx',
  'i.e',
  'e.g',
]);

const MONTHS_AND_ORDINALS = /^\d+$/;

function isAbbreviation(word: string): boolean {
  const cleaned = word
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}.]+/u, '')
    .replace(/\.$/, '');
  if (cleaned.length === 0) return false;
  if (ABBREVIATIONS.has(cleaned)) return true;
  // Iniciais ("J. R. R. Tolkien") e siglas pontuadas ("E.U.A.").
  if (/^\p{L}$/u.test(cleaned)) return true;
  if (/^(?:\p{L}\.)+\p{L}$/u.test(cleaned)) return true;
  // "cap. 3" — número solto antes do ponto costuma ser numeração.
  return MONTHS_AND_ORDINALS.test(cleaned) && cleaned.length <= 2;
}

/**
 * Quebra o texto em frases preservando os deslocamentos originais.
 * Devolve intervalos `[start, end)` que cobrem o texto inteiro, inclusive os
 * espaços entre frases (atribuídos à frase anterior).
 */
export function splitSentences(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;

    if (char === '\n') {
      // Quebra de parágrafo é sempre fim de frase.
      const next = text[i + 1];
      if (next === '\n' || next === undefined) {
        let end = i + 1;
        while (text[end] === '\n') end += 1;
        if (end > start) spans.push({ start, end });
        start = end;
        i = end - 1;
      }
      continue;
    }

    if (char !== '.' && char !== '!' && char !== '?' && char !== '…') continue;

    // Reticências e "!?" contam como um único terminador.
    let end = i + 1;
    while (end < text.length && '.!?…'.includes(text[end]!)) end += 1;
    // Aspas e parênteses de fechamento pertencem à frase que termina.
    while (end < text.length && `”"'»)]`.includes(text[end]!)) end += 1;

    const rest = text.slice(end);
    const followedByBreak = /^\s*$/.test(rest) || /^\s/.test(rest);
    if (!followedByBreak) continue; // "3.14", "www.site.com"

    if (char === '.' && end === i + 1) {
      const word = text.slice(start, i + 1).split(/\s+/).pop() ?? '';
      if (isAbbreviation(word)) continue;
      // Ponto seguido de minúscula raramente encerra frase de verdade.
      const nextLetter = rest.match(/\S/)?.[0];
      if (nextLetter && /\p{Ll}/u.test(nextLetter)) continue;
    }

    // Consome o espaço em branco que separa as frases.
    while (end < text.length && /\s/.test(text[end]!)) end += 1;
    if (end > start) spans.push({ start, end });
    start = end;
    i = end - 1;
  }

  if (start < text.length) spans.push({ start, end: text.length });
  return spans;
}

/** Ponto de corte razoável dentro de uma frase longa demais. */
function findBreakPoint(text: string, from: number, to: number): number {
  const window = text.slice(from, to);
  for (const pattern of [/[;:](?=\s)/g, /,(?=\s)/g, /\s(?=\S)/g]) {
    let best = -1;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(window)) !== null) {
      // Prefere um corte próximo do fim da janela, mas não colado nele.
      if (match.index > window.length * 0.4) {
        best = match.index + 1;
        break;
      }
      best = match.index + 1;
    }
    if (best > 0) return from + best;
  }
  return to;
}

/**
 * Agrupa frases em trechos de narração, unindo frases curtas e quebrando as
 * longas demais. Os trechos cobrem o texto inteiro, sem lacunas.
 */
export function buildChunks(text: string, options: ChunkOptions = {}): TextChunk[] {
  const { targetChars, maxChars } = { ...DEFAULTS, ...options };
  if (text.trim().length === 0) return [];

  const chunks: TextChunk[] = [];
  const push = (start: number, end: number) => {
    const slice = text.slice(start, end);
    if (slice.trim().length === 0) {
      // Espaço em branco puro é anexado ao trecho anterior para não deixar buracos.
      const previous = chunks[chunks.length - 1];
      if (previous) {
        previous.end = end;
        previous.text = text.slice(previous.start, end);
      }
      return;
    }
    chunks.push({ index: chunks.length, start, end, text: slice });
  };

  let pending: { start: number; end: number } | null = null;

  const flushPending = () => {
    if (!pending) return;
    let { start } = pending;
    const { end } = pending;
    // Quebra forçada de frases muito longas.
    while (end - start > maxChars) {
      const cut = findBreakPoint(text, start + Math.floor(maxChars * 0.5), start + maxChars);
      if (cut <= start) break;
      push(start, cut);
      start = cut;
    }
    push(start, end);
    pending = null;
  };

  for (const span of splitSentences(text)) {
    if (!pending) {
      pending = { ...span };
    } else if (span.end - pending.start <= targetChars) {
      // Junta frases curtas consecutivas até chegar perto do alvo.
      pending.end = span.end;
    } else {
      flushPending();
      pending = { ...span };
    }

    if (pending && pending.end - pending.start >= targetChars) flushPending();
  }
  flushPending();

  return chunks;
}

/** Índice do trecho que contém um deslocamento do texto. */
export function chunkIndexAtOffset(chunks: TextChunk[], offset: number): number {
  if (chunks.length === 0) return 0;
  let low = 0;
  let high = chunks.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    const chunk = chunks[mid]!;
    if (offset < chunk.start) high = mid - 1;
    else if (offset >= chunk.end) low = mid + 1;
    else return mid;
  }
  return Math.min(chunks.length - 1, Math.max(0, low));
}

/**
 * Estimativa de duração da narração de um trecho, usada para mostrar o tempo
 * restante antes de o áudio ser sintetizado. ~14 caracteres por segundo é a
 * média observada em vozes neurais a 1,0x nos três idiomas suportados.
 */
export function estimateSeconds(chars: number, speed = 1): number {
  if (speed <= 0) return 0;
  return chars / 14 / speed;
}
