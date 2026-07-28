"""OCR embutido: o motor de reconhecimento vem dentro do PyMuPDF, e os dados
de idioma viajam com o projeto — não há programa externo a instalar."""

import fitz
import pytest

from pdf2kindle.converter import Options, convert, ocr_disponivel
from pdf2kindle.extract import extract, idiomas_disponiveis, tessdata_dir

precisa_de_dados = pytest.mark.skipif(
    not ocr_disponivel(), reason="dados de idioma ausentes (rode scripts/fetch_tessdata.py)"
)


def _digitaliza(origem: str, destino: str, inclinacao: float = 0.5) -> str:
    """Transforma um PDF em 'fotografia das páginas': sem camada de texto,
    com a inclinação que todo scanner introduz."""
    entrada = fitz.open(origem)
    saida = fitz.open()
    for pagina in entrada:
        matriz = fitz.Matrix(200 / 72, 200 / 72).prerotate(inclinacao)
        pix = pagina.get_pixmap(matrix=matriz, colorspace=fitz.csGRAY, alpha=False)
        nova = saida.new_page(width=pagina.rect.width, height=pagina.rect.height)
        nova.insert_image(nova.rect, stream=pix.tobytes("jpeg", jpg_quality=60))
    entrada.close()
    saida.save(destino)
    saida.close()
    return destino


@pytest.fixture(scope="module")
def escaneado(sample_pdf, tmp_path_factory):
    destino = tmp_path_factory.mktemp("scan") / "escaneado.pdf"
    return _digitaliza(sample_pdf, str(destino))


def test_encontra_os_dados_de_idioma():
    pasta = tessdata_dir()
    assert pasta, "sem os .traineddata o OCR não roda em lugar nenhum"
    assert "por" in idiomas_disponiveis(pasta)


def test_pdf_digitalizado_nao_tem_texto(escaneado):
    assert extract(escaneado, ocr="off").text_chars < 100


@precisa_de_dados
def test_reconhece_o_texto_do_livro_digitalizado(escaneado):
    resultado = extract(escaneado, ocr="auto", ocr_lang="por")
    assert resultado.ocr_pages == 6
    texto = " ".join(l.text for b in resultado.blocks if b.kind == "text" for l in b.lines)
    assert "tipografia de um livro impresso" in texto


@precisa_de_dados
def test_ocr_reconstroi_a_estrutura_do_livro(escaneado, tmp_path):
    resultado = convert(escaneado, str(tmp_path / "escaneado.docx"), Options(ocr="auto", ocr_lang="por"))
    assert resultado.ocr_applied and resultado.ocr_pages == 6

    titulos = [el.text for el in resultado.document.elements if el.kind == "heading"]
    assert any("Capítulo 1" in t for t in titulos), titulos
    assert any("Capítulo 3" in t for t in titulos), titulos
    # a digitalização não vai junto: o texto já foi reconhecido
    assert not [el for el in resultado.document.elements if el.kind == "image"]


@precisa_de_dados
def test_ocr_le_as_colunas_na_ordem_certa(escaneado, tmp_path):
    """O OCR devolve as duas colunas em um bloco só; sem separá-las o texto
    sai intercalado, uma linha de cada coluna."""
    resultado = convert(escaneado, str(tmp_path / "colunas.docx"), Options(ocr="force", ocr_lang="por"))
    corpo = " ".join(el.text for el in resultado.document.elements if el.kind == "paragraph")
    assert "Segunda coluna" in corpo
    antes = corpo.index("porque o texto não pode mais")
    assert antes < corpo.index("Segunda coluna")


@precisa_de_dados
def test_auto_nao_reconhece_pdf_que_ja_tem_texto(sample_pdf, tmp_path):
    """Em PDF digital existem páginas quase sem texto (figuras, aberturas).
    Reconhecê-las só produziria ruído."""
    resultado = convert(sample_pdf, str(tmp_path / "digital.docx"), Options(ocr="auto"))
    assert not resultado.ocr_applied
    assert resultado.ocr_pages == 0


@precisa_de_dados
def test_progresso_e_anunciado_pagina_a_pagina(escaneado, tmp_path):
    vistos = []
    convert(
        escaneado,
        str(tmp_path / "progresso.docx"),
        Options(ocr="force", ocr_lang="por"),
        on_page=lambda pagina, total: vistos.append((pagina, total)),
    )
    assert vistos == [(i, 6) for i in range(1, 7)]


def test_idioma_ausente_nao_derruba_a_conversao(escaneado, tmp_path):
    """Pedir um idioma que não está instalado deve avisar e seguir."""
    resultado = convert(
        escaneado, str(tmp_path / "idioma.docx"), Options(ocr="force", ocr_lang="klingon+por")
    )
    assert any("klingon" in aviso for aviso in resultado.warnings)
    if ocr_disponivel():
        assert resultado.ocr_applied
