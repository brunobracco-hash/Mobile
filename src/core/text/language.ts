/**
 * Detecção de idioma restrita aos três idiomas suportados pelo app:
 * português do Brasil, inglês dos EUA e espanhol.
 *
 * É uma pontuação por palavras funcionais (as mais frequentes de cada idioma)
 * com um reforço por marcas ortográficas exclusivas — suficiente e barato para
 * escolher a voz certa a partir das primeiras páginas de um documento, sem
 * depender de rede nem de modelo embarcado.
 */

export const SUPPORTED_LANGUAGES = ['pt-BR', 'en-US', 'es-ES'] as const;
export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number];

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  'pt-BR': 'Português (Brasil)',
  'en-US': 'Inglês (EUA)',
  'es-ES': 'Espanhol',
};

const STOPWORDS: Record<LanguageCode, readonly string[]> = {
  'pt-BR': [
    'de','que','não','uma','para','com','como','mas','por','mais','das','dos','ao','à','às','aos',
    'na','no','nas','nos','é','são','foi','ser','está','estão','pelo','pela','isso','esse','essa',
    'também','já','muito','quando','sobre','entre','até','depois','porque','então','você','nós',
  ],
  'en-US': [
    'the','of','and','to','in','that','is','was','it','for','on','with','as','but','they','be',
    'this','have','from','or','had','by','not','are','were','their','which','you','been','has',
    'would','there','what','about','when','who','will','more','if','than','into','could','other',
  ],
  'es-ES': [
    'de','que','no','una','para','con','como','pero','por','más','las','los','del','al','en','es',
    'son','fue','ser','está','están','ella','él','este','esta','eso','también','ya','muy','cuando',
    'sobre','entre','hasta','después','porque','entonces','usted','nosotros','sus','hay','así',
  ],
};

/** Sequências que praticamente só existem em um dos idiomas. */
const SIGNATURES: Record<LanguageCode, readonly RegExp[]> = {
  'pt-BR': [/ã/, /õ/, /ç/, /\bç/, /ções\b/, /\bnão\b/, /\bmuito\b/, /lh[aeiou]/, /nh[aeiou]/],
  'en-US': [/\bthe\b/, /\bof\b/, /'s\b/, /\bing\b/, /ough/],
  'es-ES': [/ñ/, /¿/, /¡/, /\bel\b/, /ción\b/, /\bpero\b/, /ll[aeiou]/],
};

export interface LanguageGuess {
  language: LanguageCode;
  /** 0 a 1. Abaixo de ~0.25 a diferença para o segundo colocado é pequena. */
  confidence: number;
  scores: Record<LanguageCode, number>;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}'’]+/u)
    .filter((token) => token.length > 0);
}

/**
 * @param sampleChars quantidade de caracteres analisados. O início de um livro
 * costuma ter capa, sumário e créditos, então amostramos um trecho generoso.
 */
export function detectLanguage(text: string, sampleChars = 20_000): LanguageGuess {
  const sample = text.slice(0, sampleChars);
  const tokens = tokenize(sample);
  const scores: Record<LanguageCode, number> = { 'pt-BR': 0, 'en-US': 0, 'es-ES': 0 };

  if (tokens.length === 0) {
    return { language: 'pt-BR', confidence: 0, scores };
  }

  const stopwordSets = SUPPORTED_LANGUAGES.map(
    (language) => [language, new Set(STOPWORDS[language])] as const
  );

  for (const token of tokens) {
    for (const [language, set] of stopwordSets) {
      if (set.has(token)) scores[language] += 1;
    }
  }

  // Normaliza pelo número de palavras e soma o reforço ortográfico.
  const lowerSample = sample.toLowerCase();
  for (const language of SUPPORTED_LANGUAGES) {
    scores[language] /= tokens.length;
    const hits = SIGNATURES[language].filter((pattern) => pattern.test(lowerSample)).length;
    scores[language] += (hits / SIGNATURES[language].length) * 0.15;
  }

  const ranked = SUPPORTED_LANGUAGES.map((language) => ({ language, score: scores[language] })).sort(
    (a, b) => b.score - a.score
  );

  const best = ranked[0]!;
  const second = ranked[1]!;
  const total = ranked.reduce((sum, entry) => sum + entry.score, 0);
  const confidence = total > 0 ? (best.score - second.score) / total : 0;

  return {
    language: best.score > 0 ? best.language : 'pt-BR',
    confidence: Math.max(0, Math.min(1, confidence)),
    scores,
  };
}

/** Converte um código arbitrário (ex.: "pt", "es-419") no idioma suportado mais próximo. */
export function coerceLanguage(code: string | undefined | null): LanguageCode | null {
  if (!code) return null;
  const lower = code.toLowerCase();
  if (lower.startsWith('pt')) return 'pt-BR';
  if (lower.startsWith('en')) return 'en-US';
  if (lower.startsWith('es') || lower.startsWith('ca') || lower.startsWith('gl')) return 'es-ES';
  return null;
}
