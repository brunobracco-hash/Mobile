package com.bracco.pdf2word

/**
 * Transforma o texto bruto de uma pagina (linhas soltas vindas da camada de
 * texto do PDF ou do OCR) em paragrafos legiveis no Word.
 */
object TextLayout {

    private val SPACES = Regex("[ \\t\\u00A0\\u2007\\u202F]+")
    private val BULLET_START = Regex("^([\\u2022\\u25CF\\u25AA\\u2023\\u2043*\\-\\u2013\\u2014]\\s+|\\(?[0-9]{1,3}[.)\\-]\\s+|[a-zA-Z][.)]\\s+|[IVXLC]{1,6}[.)\\-]\\s+)")
    private const val SENTENCE_END = ".!?:;\"”»"
    private const val SOFT_HYPHEN = '\u00AD'

    /** Quantidade de letras/digitos: usado para decidir se a pagina tem texto de verdade. */
    fun meaningfulChars(text: String): Int {
        var count = 0
        for (ch in text) if (ch.isLetterOrDigit()) count++
        return count
    }

    /**
     * @param raw texto da pagina, com quebras de linha.
     * @param joinLines se true, junta linhas da mesma frase num unico paragrafo
     *                  (recomendado: deixa o texto fluido no Word).
     */
    fun toParagraphs(raw: String, joinLines: Boolean): List<String> {
        val lines = raw.split('\n').map { normalize(it) }

        if (!joinLines) {
            return lines.filter { it.isNotEmpty() }
        }

        val result = ArrayList<String>()
        val current = StringBuilder()

        fun flush() {
            val text = current.toString().trim()
            if (text.isNotEmpty()) result.add(text)
            current.setLength(0)
        }

        for (line in lines) {
            if (line.isEmpty()) {
                flush()
                continue
            }
            if (current.isEmpty()) {
                current.append(line)
                continue
            }
            val previous = current.toString()
            if (endsHyphenated(previous) && line.first().isLowerCase()) {
                current.setLength(current.length - 1)
                current.append(line)
            } else if (shouldJoin(previous, line)) {
                current.append(' ').append(line)
            } else {
                flush()
                current.append(line)
            }
        }
        flush()
        return result
    }

    private fun normalize(line: String): String =
        line.replace(SPACES, " ").trim()

    private fun endsHyphenated(previous: String): Boolean {
        if (previous.length < 2) return false
        val last = previous.last()
        if (last != '-' && last != SOFT_HYPHEN) return false
        return previous[previous.length - 2].isLetter()
    }

    /**
     * Junta a linha seguinte no mesmo paragrafo quando ela e claramente
     * continuacao: a anterior nao terminou frase, era longa (ou seja, quebrou
     * por largura da pagina) e a nova nao comeca item de lista.
     */
    private fun shouldJoin(previous: String, next: String): Boolean {
        if (previous.length < 35) return false
        if (previous.last() in SENTENCE_END) return false
        if (BULLET_START.containsMatchIn(next)) return false
        if (next.first().isDigit() && next.length < 12) return false
        return true
    }
}
