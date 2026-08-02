package com.bracco.pdf2word

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import android.util.Log
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.Text
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.TextRecognizer
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.io.MemoryUsageSetting
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.text.PDFTextStripper
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import java.io.File
import java.util.concurrent.TimeUnit
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sqrt

/**
 * Converte um PDF (digital, escaneado ou misto) em um .docx somente texto.
 *
 * Estrategia por pagina:
 *  1. tenta ler a camada de texto do PDF (rapido e perfeito em PDFs digitais);
 *  2. se a pagina nao tiver texto util (PDF escaneado), rasteriza a pagina e
 *     roda OCR offline (ML Kit) sobre a imagem;
 *  3. o texto vira paragrafos e e gravado direto no arquivo de saida.
 *
 * Nenhuma imagem e copiada para o documento final, e nada e mantido em
 * memoria alem da pagina corrente -- por isso nao ha limite de tamanho de PDF.
 */
class PdfToDocxConverter(
    private val context: Context,
    private val options: ConversionOptions,
    private val onProgress: (page: Int, total: Int, ocrPages: Int) -> Unit
) {

    class ConversionException(message: String) : Exception(message)

    suspend fun convert(input: File, output: File, title: String): ConversionResult {
        val started = System.currentTimeMillis()
        val bodyFile = File(context.cacheDir, "docx-body-${System.currentTimeMillis()}.xml")

        var descriptor: ParcelFileDescriptor? = null
        var renderer: PdfRenderer? = null
        var document: PDDocument? = null
        var recognizer: TextRecognizer? = null
        var ocrPages = 0
        var pages: Int

        val writer = DocxWriter(bodyFile)
        try {
            // Rasterizador nativo: usado para OCR e como fonte da contagem de paginas.
            try {
                descriptor = ParcelFileDescriptor.open(input, ParcelFileDescriptor.MODE_READ_ONLY)
                renderer = PdfRenderer(descriptor)
            } catch (e: Throwable) {
                Log.w(TAG, "PdfRenderer indisponivel: ${e.message}")
                closeQuietly(descriptor)
                descriptor = null
                renderer = null
            }

            // Camada de texto (nao carrega o PDF inteiro na memoria: usa arquivo temporario).
            if (!options.forceOcr) {
                document = openDocument(input)
            }

            pages = renderer?.pageCount ?: document?.numberOfPages ?: 0
            if (pages <= 0) {
                throw ConversionException(
                    context.getString(R.string.error_cannot_open_pdf)
                )
            }

            val stripper = if (document != null) {
                PDFTextStripper().apply {
                    sortByPosition = true
                    lineSeparator = "\n"
                    paragraphStart = ""
                    paragraphEnd = "\n"
                }
            } else {
                null
            }

            onProgress(0, pages, 0)

            for (index in 0 until pages) {
                currentCoroutineContext().ensureActive()

                var text = ""
                if (stripper != null && document != null) {
                    text = try {
                        stripper.startPage = index + 1
                        stripper.endPage = index + 1
                        stripper.getText(document)
                    } catch (e: Throwable) {
                        Log.w(TAG, "Falha ao ler texto da pagina ${index + 1}: ${e.message}")
                        ""
                    }
                }

                val needsOcr = options.forceOcr || TextLayout.meaningfulChars(text) < MIN_TEXT_CHARS
                if (needsOcr && renderer != null) {
                    if (recognizer == null) {
                        recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
                    }
                    val ocrText = ocrPage(renderer, recognizer, index)
                    if (TextLayout.meaningfulChars(ocrText) >= TextLayout.meaningfulChars(text)) {
                        text = ocrText
                        ocrPages++
                    }
                }

                if (options.pageMarkers) {
                    writer.marker(context.getString(R.string.page_marker, index + 1))
                }
                for (paragraph in TextLayout.toParagraphs(text, options.joinLines)) {
                    writer.paragraph(paragraph)
                }
                if (options.pageBreaks && index < pages - 1) {
                    writer.pageBreak()
                }

                onProgress(index + 1, pages, ocrPages)
            }

            writer.close()
            writer.assembleInto(output, title)

            return ConversionResult(
                outputPath = output.absolutePath,
                fileName = output.name,
                pages = pages,
                ocrPages = ocrPages,
                paragraphs = writer.paragraphs,
                characters = writer.characters,
                sizeBytes = output.length(),
                elapsedMs = System.currentTimeMillis() - started
            )
        } finally {
            closeQuietly(writer)
            try {
                recognizer?.close()
            } catch (e: Throwable) {
                Log.w(TAG, "close recognizer: ${e.message}")
            }
            closeQuietly(document)
            closeQuietly(renderer)
            closeQuietly(descriptor)
            bodyFile.delete()
        }
    }

    private fun openDocument(input: File): PDDocument? = try {
        PDFBoxResourceLoader.init(context.applicationContext)
        val memory = MemoryUsageSetting
            .setupMixed(MAX_PDFBOX_MEMORY)
            .setTempDir(context.cacheDir)
        val doc = PDDocument.load(input, "", memory)
        if (doc.isEncrypted) {
            doc.setAllSecurityToBeRemoved(true)
        }
        doc
    } catch (e: Throwable) {
        Log.w(TAG, "PDFBox nao conseguiu abrir o PDF, seguindo so com OCR: ${e.message}")
        null
    }

    private fun ocrPage(renderer: PdfRenderer, recognizer: TextRecognizer, index: Int): String {
        var bitmap: Bitmap? = null
        return try {
            bitmap = renderPage(renderer, index, options.ocrDpi)
            val image = InputImage.fromBitmap(bitmap, 0)
            val result = Tasks.await(recognizer.process(image), OCR_TIMEOUT_MINUTES, TimeUnit.MINUTES)
            flatten(result)
        } catch (e: Throwable) {
            Log.w(TAG, "OCR falhou na pagina ${index + 1}: ${e.message}")
            ""
        } finally {
            bitmap?.recycle()
        }
    }

    /** Rasteriza a pagina limitando a memoria usada pelo bitmap. */
    private fun renderPage(renderer: PdfRenderer, index: Int, dpi: Int): Bitmap {
        val page = renderer.openPage(index)
        try {
            val scale = dpi / 72f
            var width = max(1, (page.width * scale).roundToInt())
            var height = max(1, (page.height * scale).roundToInt())

            val longest = max(width, height)
            if (longest > MAX_SIDE_PX) {
                val factor = MAX_SIDE_PX.toFloat() / longest
                width = max(1, (width * factor).roundToInt())
                height = max(1, (height * factor).roundToInt())
            }
            val pixels = width.toLong() * height.toLong()
            if (pixels > MAX_PIXELS) {
                val factor = sqrt(MAX_PIXELS.toDouble() / pixels.toDouble()).toFloat()
                width = max(1, (width * factor).roundToInt())
                height = max(1, (height * factor).roundToInt())
            }

            val bitmap = createBitmap(width, height)
            Canvas(bitmap).drawColor(Color.WHITE)
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            return bitmap
        } finally {
            try {
                page.close()
            } catch (e: Throwable) {
                Log.w(TAG, "close page: ${e.message}")
            }
        }
    }

    /** Aloca o bitmap reduzindo a resolucao caso a memoria nao seja suficiente. */
    private fun createBitmap(width: Int, height: Int): Bitmap {
        var w = width
        var h = height
        while (true) {
            try {
                return Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            } catch (e: OutOfMemoryError) {
                if (w <= 800 || h <= 800) throw e
                w = max(1, (w * 0.7f).roundToInt())
                h = max(1, (h * 0.7f).roundToInt())
                Log.w(TAG, "Sem memoria para o bitmap, reduzindo para ${w}x$h")
            }
        }
    }

    /** Junta blocos do OCR em ordem de leitura (de cima para baixo, da esquerda para a direita). */
    private fun flatten(result: Text): String {
        val blocks = result.textBlocks.sortedWith(
            compareBy(
                { it.boundingBox?.top ?: Int.MAX_VALUE },
                { it.boundingBox?.left ?: 0 }
            )
        )
        val sb = StringBuilder()
        for (block in blocks) {
            for (line in block.lines) {
                sb.append(line.text).append('\n')
            }
            sb.append('\n')
        }
        return sb.toString()
    }

    private fun closeQuietly(closeable: AutoCloseable?) {
        try {
            closeable?.close()
        } catch (e: Throwable) {
            Log.w(TAG, "close: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "PdfToDocx"

        /** Abaixo disso a pagina e tratada como digitalizada e vai para o OCR. */
        private const val MIN_TEXT_CHARS = 15

        private const val MAX_SIDE_PX = 3000
        private const val MAX_PIXELS = 6_000_000L
        private const val MAX_PDFBOX_MEMORY = 16L * 1024L * 1024L
        private const val OCR_TIMEOUT_MINUTES = 3L
    }
}
