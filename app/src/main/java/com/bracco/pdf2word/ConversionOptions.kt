package com.bracco.pdf2word

import android.content.Intent

/** Opcoes de conversao escolhidas na tela inicial. */
data class ConversionOptions(
    /** Ignora a camada de texto do PDF e roda OCR em todas as paginas. */
    val forceOcr: Boolean = false,
    /** Junta linhas quebradas pela largura da pagina num unico paragrafo. */
    val joinLines: Boolean = true,
    /** Insere quebra de pagina no Word a cada pagina do PDF. */
    val pageBreaks: Boolean = true,
    /** Insere um marcador discreto "pagina N". */
    val pageMarkers: Boolean = false,
    /** Resolucao usada para rasterizar a pagina antes do OCR. */
    val ocrDpi: Int = 200
) {

    fun writeTo(intent: Intent) {
        intent.putExtra(EXTRA_FORCE_OCR, forceOcr)
        intent.putExtra(EXTRA_JOIN_LINES, joinLines)
        intent.putExtra(EXTRA_PAGE_BREAKS, pageBreaks)
        intent.putExtra(EXTRA_PAGE_MARKERS, pageMarkers)
        intent.putExtra(EXTRA_OCR_DPI, ocrDpi)
    }

    companion object {
        private const val EXTRA_FORCE_OCR = "force_ocr"
        private const val EXTRA_JOIN_LINES = "join_lines"
        private const val EXTRA_PAGE_BREAKS = "page_breaks"
        private const val EXTRA_PAGE_MARKERS = "page_markers"
        private const val EXTRA_OCR_DPI = "ocr_dpi"

        fun readFrom(intent: Intent): ConversionOptions = ConversionOptions(
            forceOcr = intent.getBooleanExtra(EXTRA_FORCE_OCR, false),
            joinLines = intent.getBooleanExtra(EXTRA_JOIN_LINES, true),
            pageBreaks = intent.getBooleanExtra(EXTRA_PAGE_BREAKS, true),
            pageMarkers = intent.getBooleanExtra(EXTRA_PAGE_MARKERS, false),
            ocrDpi = intent.getIntExtra(EXTRA_OCR_DPI, 200)
        )
    }
}
