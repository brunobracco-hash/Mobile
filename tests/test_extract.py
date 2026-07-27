"""Extração: ordem de leitura, cabeçalhos, rodapés e números de página."""

from pdf2kindle.extract import _is_page_number, _normalize_running, extract


def _all_text(extraction) -> str:
    return "\n".join(line.text for b in extraction.blocks if b.kind == "text" for line in b.lines)


def test_cabecalho_repetido_some(extraction):
    assert "Manual de Testes" not in _all_text(extraction)


def test_numeros_de_pagina_somem(extraction):
    linhas = [line.text.strip() for b in extraction.blocks if b.kind == "text" for line in b.lines]
    assert not [l for l in linhas if l.isdigit()]


def test_texto_do_corpo_permanece(extraction):
    texto = _all_text(extraction)
    assert "A tipografia de um livro impresso" in texto
    assert "Capítulo 1" in texto


def test_duas_colunas_saem_na_ordem_de_leitura(extraction):
    pagina = [b for b in extraction.blocks if b.page == 4 and b.kind == "text"]
    texto = " ".join(line.text for b in pagina for line in b.lines)
    assert texto.index("porque o texto não pode mais") < texto.index("Segunda coluna")


def test_imagem_extraida(extraction):
    imagens = [b for b in extraction.blocks if b.kind == "image"]
    assert len(imagens) == 1
    assert imagens[0].image


def test_sem_imagens_quando_desligado(sample_pdf):
    resultado = extract(sample_pdf, keep_images=False)
    assert not [b for b in resultado.blocks if b.kind == "image"]


def test_pdf_com_texto_nao_e_marcado_como_digitalizado(extraction):
    assert extraction.scanned is False


def test_reconhece_numeracao_de_pagina():
    assert _is_page_number("12")
    assert _is_page_number("xiv")
    assert _is_page_number("- 7 -")
    assert _is_page_number("Página 3 de 200")
    assert not _is_page_number("Capítulo 2")
    assert not _is_page_number("1984 foi publicado")


def test_normalizacao_ignora_numero_da_pagina():
    assert _normalize_running("Introdução | 34") == _normalize_running("Introdução | 35")


def test_pdf_digitalizado_gera_aviso(tmp_path):
    """PDF sem camada de texto: precisa avisar em vez de gerar um .docx vazio."""
    import fitz

    caminho = tmp_path / "digitalizado.pdf"
    doc = fitz.open()
    for _ in range(3):
        pagina = doc.new_page(width=420, height=595)
        pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 300, 400))
        pix.set_rect(pix.irect, (240, 240, 235))
        pagina.insert_image(fitz.Rect(60, 100, 360, 500), pixmap=pix)
    doc.save(str(caminho))
    doc.close()

    resultado = extract(str(caminho))
    assert resultado.scanned
    assert any("digitalizado" in aviso for aviso in resultado.warnings)


def test_conversao_de_pdf_sem_texto_nao_quebra(tmp_path):
    import fitz

    from pdf2kindle.converter import Options, convert

    caminho = tmp_path / "vazio.pdf"
    doc = fitz.open()
    doc.new_page(width=420, height=595)
    doc.save(str(caminho))
    doc.close()

    resultado = convert(str(caminho), str(tmp_path / "vazio.docx"), Options(ocr="off"))
    assert (tmp_path / "vazio.docx").exists()
    assert resultado.document.stats["paragraphs"] == 0
