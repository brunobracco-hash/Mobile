package com.bracco.pdf2word

import java.io.BufferedWriter
import java.io.Closeable
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.OutputStreamWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * Gera um .docx contendo somente texto (nenhuma imagem e nunca embutida).
 *
 * A escrita e feita em streaming: cada paragrafo vai direto para um arquivo
 * temporario com o corpo do documento. Somente no final o pacote OOXML e
 * montado e compactado. Com isso o uso de memoria independe do tamanho do
 * PDF de origem, e o arquivo final fica pequeno (texto puro comprimido).
 */
class DocxWriter(private val bodyFile: File) : Closeable {

    private val out: BufferedWriter =
        BufferedWriter(OutputStreamWriter(FileOutputStream(bodyFile), Charsets.UTF_8), 1 shl 16)

    var paragraphs: Int = 0
        private set

    var characters: Long = 0L
        private set

    /** Paragrafo comum de texto. */
    fun paragraph(text: String) {
        val clean = sanitize(text)
        if (clean.isEmpty()) return
        out.write("<w:p><w:r><w:t xml:space=\"preserve\">")
        out.write(clean)
        out.write("</w:t></w:r></w:p>")
        paragraphs++
        characters += text.length.toLong()
    }

    /** Marcador discreto e centralizado, ex.: "pagina 12". */
    fun marker(text: String) {
        val clean = sanitize(text)
        if (clean.isEmpty()) return
        out.write("<w:p><w:pPr><w:jc w:val=\"center\"/><w:spacing w:before=\"120\" w:after=\"120\"/></w:pPr>")
        out.write("<w:r><w:rPr><w:i/><w:color w:val=\"808080\"/><w:sz w:val=\"16\"/></w:rPr>")
        out.write("<w:t xml:space=\"preserve\">")
        out.write(clean)
        out.write("</w:t></w:r></w:p>")
    }

    fun pageBreak() {
        out.write("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>")
    }

    override fun close() {
        out.close()
    }

    /**
     * Monta o pacote .docx final a partir do corpo ja gravado.
     * Deve ser chamado depois de [close].
     */
    fun assembleInto(target: File, title: String) {
        ZipOutputStream(FileOutputStream(target).buffered(1 shl 16)).use { zip ->
            zip.setLevel(Deflater.BEST_COMPRESSION)

            writeEntry(zip, "[Content_Types].xml", CONTENT_TYPES)
            writeEntry(zip, "_rels/.rels", ROOT_RELS)
            writeEntry(zip, "word/_rels/document.xml.rels", DOC_RELS)
            writeEntry(zip, "word/styles.xml", STYLES)
            writeEntry(zip, "docProps/core.xml", coreProps(title))
            writeEntry(zip, "docProps/app.xml", APP_PROPS)

            zip.putNextEntry(ZipEntry("word/document.xml"))
            zip.write(DOC_PREFIX.toByteArray(Charsets.UTF_8))
            FileInputStream(bodyFile).use { input ->
                val buffer = ByteArray(1 shl 16)
                while (true) {
                    val read = input.read(buffer)
                    if (read <= 0) break
                    zip.write(buffer, 0, read)
                }
            }
            zip.write(DOC_SUFFIX.toByteArray(Charsets.UTF_8))
            zip.closeEntry()
        }
    }

    private fun writeEntry(zip: ZipOutputStream, name: String, content: String) {
        zip.putNextEntry(ZipEntry(name))
        zip.write(content.toByteArray(Charsets.UTF_8))
        zip.closeEntry()
    }

    companion object {

        /** Escapa XML e remove caracteres de controle invalidos em XML 1.0. */
        fun sanitize(raw: String): String {
            val sb = StringBuilder(raw.length + 16)
            for (ch in raw) {
                when {
                    ch == '&' -> sb.append("&amp;")
                    ch == '<' -> sb.append("&lt;")
                    ch == '>' -> sb.append("&gt;")
                    ch == '\t' -> sb.append("    ")
                    ch == '\n' || ch == '\r' -> sb.append(' ')
                    ch.code < 0x20 -> Unit
                    ch.code == 0xFFFE || ch.code == 0xFFFF -> Unit
                    else -> sb.append(ch)
                }
            }
            return sb.toString().trim()
        }

        private fun coreProps(title: String): String {
            val fmt = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US)
            fmt.timeZone = TimeZone.getTimeZone("UTC")
            val now = fmt.format(Date())
            return "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<cp:coreProperties " +
                "xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" " +
                "xmlns:dc=\"http://purl.org/dc/elements/1.1/\" " +
                "xmlns:dcterms=\"http://purl.org/dc/terms/\" " +
                "xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">" +
                "<dc:title>" + sanitize(title) + "</dc:title>" +
                "<dc:creator>PDF para Word</dc:creator>" +
                "<cp:lastModifiedBy>PDF para Word</cp:lastModifiedBy>" +
                "<dcterms:created xsi:type=\"dcterms:W3CDTF\">" + now + "</dcterms:created>" +
                "<dcterms:modified xsi:type=\"dcterms:W3CDTF\">" + now + "</dcterms:modified>" +
                "</cp:coreProperties>"
        }

        private const val CONTENT_TYPES =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>" +
                "<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>" +
                "<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>" +
                "<Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/>" +
                "</Types>"

        private const val ROOT_RELS =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>" +
                "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>" +
                "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/>" +
                "</Relationships>"

        private const val DOC_RELS =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>" +
                "</Relationships>"

        private const val STYLES =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<w:styles xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
                "<w:docDefaults>" +
                "<w:rPrDefault><w:rPr>" +
                "<w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/>" +
                "<w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/>" +
                "<w:lang w:val=\"pt-BR\"/>" +
                "</w:rPr></w:rPrDefault>" +
                "<w:pPrDefault><w:pPr>" +
                "<w:spacing w:after=\"120\" w:line=\"276\" w:lineRule=\"auto\"/>" +
                "</w:pPr></w:pPrDefault>" +
                "</w:docDefaults>" +
                "<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\">" +
                "<w:name w:val=\"Normal\"/><w:qFormat/>" +
                "<w:rPr>" +
                "<w:rFonts w:ascii=\"Calibri\" w:hAnsi=\"Calibri\" w:cs=\"Calibri\"/>" +
                "<w:sz w:val=\"22\"/><w:szCs w:val=\"22\"/>" +
                "</w:rPr>" +
                "</w:style>" +
                "</w:styles>"

        private const val APP_PROPS =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\" " +
                "xmlns:vt=\"http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes\">" +
                "<Application>PDF para Word (Android)</Application>" +
                "</Properties>"

        private const val DOC_PREFIX =
            "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\">" +
                "<w:body>"

        private const val DOC_SUFFIX =
            "<w:sectPr>" +
                "<w:pgSz w:w=\"11906\" w:h=\"16838\"/>" +
                "<w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\" " +
                "w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/>" +
                "</w:sectPr></w:body></w:document>"
    }
}
