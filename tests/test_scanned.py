"""PDF digitalizado: o texto vem do OCR, quebrado de um jeito que o PDF
digital nunca quebra — cada linha (às vezes cada pedaço de linha) é um bloco
solto, e a página inteira é uma imagem por baixo do texto reconhecido."""

import fitz

from pdf2kindle.extract import extract
from pdf2kindle.structure import build_document

LARGURA, ALTURA = 420, 595


def _pagina_em_branco(doc):
    return doc.new_page(width=LARGURA, height=ALTURA)


def _texto(page, rect, texto, fontsize=10, fontname="times-roman"):
    """Escreve e confere que coube: o PyMuPDF descarta o texto em silêncio
    quando o retângulo é pequeno demais, e o teste passaria a validar nada."""
    sobra = page.insert_textbox(rect, texto, fontsize=fontsize, fontname=fontname)
    assert sobra >= 0, f"o texto {texto!r} não coube no retângulo do teste"


def _imagem_de_pagina_inteira(page):
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 420, 595))
    pix.set_rect(pix.irect, (245, 243, 238))
    page.insert_image(page.rect, pixmap=pix)


def _salva(doc, tmp_path, nome):
    caminho = tmp_path / nome
    doc.save(str(caminho))
    doc.close()
    return str(caminho)


def test_imagem_da_pagina_inteira_e_descartada_quando_ha_texto(tmp_path):
    """Depois do OCR, a digitalização só duplicaria o texto e pesaria no arquivo."""
    doc = fitz.open()
    for _ in range(3):
        page = _pagina_em_branco(doc)
        _imagem_de_pagina_inteira(page)
        _texto(page, fitz.Rect(40, 60, 380, 540), "Texto reconhecido por cima da digitalização. " * 20)
    caminho = _salva(doc, tmp_path, "ocr.pdf")

    resultado = extract(caminho)
    assert not [b for b in resultado.blocks if b.kind == "image"]
    assert resultado.full_page_images_dropped == 3


def test_imagem_da_pagina_inteira_e_mantida_quando_nao_ha_texto(tmp_path):
    """Sem OCR, a digitalização é o único conteúdo: descartá-la esvaziaria o livro."""
    doc = fitz.open()
    for _ in range(3):
        _imagem_de_pagina_inteira(_pagina_em_branco(doc))
    caminho = _salva(doc, tmp_path, "sem-ocr.pdf")

    resultado = extract(caminho)
    assert len([b for b in resultado.blocks if b.kind == "image"]) == 3
    assert resultado.full_page_images_dropped == 0


def test_fragmentos_do_ocr_viram_um_paragrafo(tmp_path):
    """O OCR devolve pedaços soltos; quem não terminou a frase continua nela."""
    doc = fitz.open()
    page = _pagina_em_branco(doc)
    for i, pedaco in enumerate(
        [
            "A tipografia de um livro impresso nasce de uma restrição",
            "física que o leitor eletrônico simplesmente não",
            "tem, e é por isso que a conversão precisa jogar fora coordenadas.",
        ]
    ):
        _texto(page, fitz.Rect(40, 80 + i * 40, 380, 115 + i * 40), pedaco)
    caminho = _salva(doc, tmp_path, "fragmentos.pdf")

    documento = build_document(extract(caminho))
    paragrafos = [el for el in documento.elements if el.kind == "paragraph"]
    assert len(paragrafos) == 1
    assert "restrição física que o leitor" in paragrafos[0].text
    assert "não tem, e é por isso" in paragrafos[0].text


def test_titulo_quebrado_em_duas_linhas_vira_um_titulo(tmp_path):
    doc = fitz.open()
    page = _pagina_em_branco(doc)
    _texto(page, fitz.Rect(40, 58, 380, 92), "Capítulo 4 - A tela de tinta", 17, "times-bold")
    _texto(page, fitz.Rect(40, 84, 380, 118), "eletrônica e seus limites", 17, "times-bold")
    _texto(page, fitz.Rect(40, 140, 380, 400), "Corpo do capítulo. " * 30)
    caminho = _salva(doc, tmp_path, "titulo-duas-linhas.pdf")

    documento = build_document(extract(caminho))
    titulos = [el for el in documento.elements if el.kind == "heading"]
    assert len(titulos) == 1, "duas entradas no sumário para o mesmo capítulo"
    assert titulos[0].text == "Capítulo 4 - A tela de tinta eletrônica e seus limites"


def test_titulo_quebrado_lado_a_lado_vira_um_titulo(tmp_path):
    """O OCR parte a mesma linha em dois blocos quando o papel está torto."""
    doc = fitz.open()
    page = _pagina_em_branco(doc)
    _texto(page, fitz.Rect(40, 58, 150, 92), "Capítulo 5 -", 17, "times-bold")
    _texto(page, fitz.Rect(155, 58, 380, 92), "O papel torto", 17, "times-bold")
    _texto(page, fitz.Rect(40, 140, 380, 400), "Corpo do capítulo. " * 30)
    caminho = _salva(doc, tmp_path, "titulo-lado-a-lado.pdf")

    documento = build_document(extract(caminho))
    titulos = [el for el in documento.elements if el.kind == "heading"]
    assert len(titulos) == 1
    assert titulos[0].text == "Capítulo 5 - O papel torto"


def test_titulos_diferentes_nao_sao_colados(tmp_path):
    """A junção só vale para o mesmo título: corpos diferentes ficam separados."""
    doc = fitz.open()
    page = _pagina_em_branco(doc)
    _texto(page, fitz.Rect(40, 55, 380, 100), "Parte I", 22, "times-bold")
    _texto(page, fitz.Rect(40, 102, 380, 134), "Capítulo 6 - O começo", 14, "times-bold")
    _texto(page, fitz.Rect(40, 150, 380, 400), "Corpo do capítulo. " * 30)
    caminho = _salva(doc, tmp_path, "dois-titulos.pdf")

    documento = build_document(extract(caminho))
    assert len([el for el in documento.elements if el.kind == "heading"]) == 2


def test_sujeira_do_ocr_no_pe_da_pagina_nao_vira_nota(tmp_path):
    doc = fitz.open()
    page = _pagina_em_branco(doc)
    _texto(page, fitz.Rect(40, 60, 380, 480), "Corpo do capítulo. " * 40)
    page.insert_text((40, 560), "O", fontsize=6, fontname="times-roman")
    caminho = _salva(doc, tmp_path, "ruido.pdf")

    documento = build_document(extract(caminho))
    assert not documento.notes
