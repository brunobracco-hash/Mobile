"""Estrutura semântica: títulos, parágrafos, listas, notas e hifenização."""

from pdf2kindle.model import Line, Span
from pdf2kindle.structure import (
    _clean,
    _is_all_caps,
    _list_info,
    _runs_from_lines,
    build_document,
)


def _line(text, size=10.0, y=0.0, bold=False):
    span = Span(text=text, size=size, font="Times", bold=bold, italic=False, bbox=(0, y, 100, y + size))
    return Line(spans=[span], bbox=(0, y, 100, y + size), page=0)


def _kinds(document):
    return [(el.kind, el.level, el.text) for el in document.elements]


def test_titulos_de_capitulo_no_nivel_1(document):
    niveis = {el.text: el.level for el in document.elements if el.kind == "heading"}
    assert niveis["Capítulo 1 - A mancha gráfica"] == 1
    assert niveis["Capítulo 2 - As colunas"] == 1
    assert niveis["Capítulo 3 - Listas e notas"] == 1


def test_subtitulo_fica_abaixo_do_capitulo(document):
    niveis = {el.text: el.level for el in document.elements if el.kind == "heading"}
    assert niveis["1.1 Uma seção menor"] == 2


def test_paragrafo_partido_entre_paginas_e_remontado(document):
    textos = [el.text for el in document.elements if el.kind == "paragraph"]
    inteiro = [t for t in textos if "o que produz um resultado" in t]
    assert inteiro, "o parágrafo cortado pela quebra de página não foi remontado"
    assert "invariavelmente pior do que o do papel" in inteiro[0]


def test_itens_de_lista_sem_o_marcador(document):
    itens = [el for el in document.elements if el.kind == "list_item"]
    assert len(itens) == 3
    assert itens[0].text.startswith("Cabeçalhos")


def test_nota_de_rodape_vai_para_o_fim(document):
    assert len(document.notes) == 1
    assert "Nota de rodapé em corpo menor" in document.notes[0].text
    assert not [el for el in document.elements if el.kind == "note"]


def test_notas_inline_ficam_no_fluxo(extraction):
    doc = build_document(extraction, footnotes="inline")
    assert not doc.notes
    assert [el for el in doc.elements if el.kind == "note"]


def test_notas_descartadas(extraction):
    doc = build_document(extraction, footnotes="drop")
    assert not doc.notes
    assert not [el for el in doc.elements if el.kind == "note"]


def test_titulo_e_autor_vem_da_folha_de_rosto(document):
    assert document.title == "A Página e a Tela"
    assert document.author == "Maria Andrade"


def test_imagem_entra_no_fluxo(document):
    assert [el for el in document.elements if el.kind == "image"]


def test_nenhum_elemento_vazio(document):
    for el in document.elements:
        assert el.kind == "image" or el.text.strip()


def test_hifenizacao_remontada():
    linhas = [_line("um resultado inva-", y=0), _line("riavelmente pior", y=12)]
    assert "".join(r.text for r in _runs_from_lines(linhas)) == "um resultado invariavelmente pior"


def test_linhas_normais_ganham_espaco():
    linhas = [_line("primeira linha", y=0), _line("segunda linha", y=12)]
    assert "".join(r.text for r in _runs_from_lines(linhas)) == "primeira linha segunda linha"


def test_runs_preservam_negrito_e_italico():
    span_normal = Span("texto ", 10, "Times", False, False, (0, 0, 30, 10))
    span_bold = Span("forte", 10, "Times-Bold", True, False, (30, 0, 60, 10))
    linha = Line(spans=[span_normal, span_bold], bbox=(0, 0, 60, 10), page=0)
    runs = _runs_from_lines([linha])
    assert [(r.text, r.bold) for r in runs] == [("texto ", False), ("forte", True)]


def test_ligaduras_e_hifen_opcional():
    assert _clean("eﬁcaz") == "eficaz"
    assert _clean("con­texto") == "contexto"


def test_deteccao_de_lista():
    assert _list_info("• um item")[0] == "•"
    assert _list_info("1. primeiro")[0] == "1."
    assert _list_info("a) alínea")[0] == "a)"
    assert _list_info("texto comum") is None


def test_caixa_alta():
    assert _is_all_caps("PRIMEIRA PARTE")
    assert not _is_all_caps("Primeira Parte")


def test_estatisticas(document):
    stats = document.stats
    assert stats["pages"] == 6
    assert stats["headings"] >= 4
    assert stats["paragraphs"] >= 5


def test_sumario_do_pdf_original_e_descartado(document):
    textos = " ".join(el.text for el in document.elements)
    assert ". . . ." not in textos
    assert "Capítulo 1 - A mancha gráfica . . ." not in textos
    assert document.stats["toc_pages_dropped"] == 1
    # o título do capítulo continua existindo — o que sai é só a linha do sumário
    assert [el for el in document.elements if el.text == "Capítulo 1 - A mancha gráfica"]


def test_titulo_corrente_de_secao_e_descartado(document):
    textos = [el.text for el in document.elements]
    assert "1.1 UMA SEÇÃO MENOR" not in textos
    assert "CAPÍTULO 2 - AS COLUNAS" not in textos
    assert document.stats["running_titles_dropped"] == 2


def test_niveis_de_titulo_nao_pulam_degraus(document):
    niveis = [el.level for el in document.elements if el.kind == "heading"]
    assert set(niveis) <= {1, 2, 3}
    assert min(niveis) == 1
    for anterior, atual in zip(niveis, niveis[1:]):
        assert atual <= anterior + 1, "o sumário do Kindle fica torto se um nível é pulado"
