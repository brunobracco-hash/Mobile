"""Gera um PDF de teste com os problemas típicos de um livro digitalizado em PDF:
cabeçalho/rodapé repetidos, números de página, parágrafo partido entre páginas,
palavra hifenizada no fim da linha, página de duas colunas, lista e nota de rodapé.
"""

from __future__ import annotations

import fitz

W, H = 420, 595  # A5 em pontos
BODY = 10
HEADER = "Manual de Testes | pdf2kindle"

LOREM = (
    "A tipografia de um livro impresso nasce de uma restrição física que o leitor "
    "eletrônico não tem: a página é fixa, o corpo do texto é fixo e a mancha "
    "gráfica precisa caber onde o papel permite. Quando esse mesmo arquivo chega "
    "a uma tela de seis polegadas, cada uma dessas decisões vira um estorvo, "
    "porque o texto não pode mais se acomodar ao tamanho que o leitor escolheu. "
)


def _header_footer(page: fitz.Page, number: int) -> None:
    page.insert_text((40, 28), HEADER, fontsize=7, fontname="helv", color=(0.4, 0.4, 0.4))
    page.insert_text((W / 2 - 6, H - 24), str(number), fontsize=8, fontname="helv")


def _running(page: fitz.Page, texto: str) -> None:
    """Título corrente: repete no alto de várias páginas o nome da seção atual."""
    page.insert_text((40, 44), texto, fontsize=7, fontname="times-roman", color=(0.3, 0.3, 0.3))


def _body(page: fitz.Page, rect: fitz.Rect, text: str, size: float = BODY, font: str = "times-roman") -> None:
    page.insert_textbox(rect, text, fontsize=size, fontname=font, align=fitz.TEXT_ALIGN_JUSTIFY, lineheight=1.35)


def build(path: str) -> str:
    doc = fitz.open()

    # --- rosto ---------------------------------------------------------------
    page = doc.new_page(width=W, height=H)
    page.insert_textbox(fitz.Rect(40, 180, W - 40, 260), "A Página e a Tela",
                        fontsize=24, fontname="times-bold", align=fitz.TEXT_ALIGN_CENTER)
    page.insert_textbox(fitz.Rect(40, 270, W - 40, 300), "Maria Andrade",
                        fontsize=12, fontname="times-italic", align=fitz.TEXT_ALIGN_CENTER)

    # --- sumário do próprio PDF (deve ser descartado) ------------------------
    page = doc.new_page(width=W, height=H)
    _header_footer(page, 2)
    page.insert_textbox(fitz.Rect(40, 70, W - 40, 100), "Sumário", fontsize=16, fontname="times-bold")
    entradas = [
        "Capítulo 1 - A mancha gráfica . . . . . . . . . . . . . . . 3",
        "1.1 Uma seção menor . . . . . . . . . . . . . . . . . . . . 3",
        "Capítulo 2 - As colunas . . . . . . . . . . . . . . . . . . 4",
        "Capítulo 3 - Listas e notas . . . . . . . . . . . . . . . . 6",
        "Notas . . . . . . . . . . . . . . . . . . . . . . . . . . . 7",
    ]
    y = 120
    for entrada in entradas:
        page.insert_textbox(fitz.Rect(40, y, W - 40, y + 20), entrada, fontsize=BODY, fontname="times-roman")
        y += 22

    # --- capítulo 1 ----------------------------------------------------------
    page = doc.new_page(width=W, height=H)
    _header_footer(page, 3)
    page.insert_textbox(fitz.Rect(40, 66, W - 40, 104), "Capítulo 1 - A mancha gráfica",
                        fontsize=16, fontname="times-bold")
    _body(page, fitz.Rect(40, 110, W - 40, 300), LOREM * 2)
    page.insert_textbox(fitz.Rect(40, 318, W - 40, 348), "1.1 Uma seção menor",
                        fontsize=12, fontname="times-bold")
    # termina sem pontuação final: continua na página seguinte
    _body(page, fitz.Rect(40, 355, W - 40, H - 45),
          "O leitor de tinta eletrônica refaz a quebra de linha a cada mudança de corpo, "
          "e por isso qualquer coordenada gravada no arquivo original passa a competir com a "
          "decisão de quem está lendo naquele momento, o que produz um resultado")

    # --- continuação em minúscula + hifenização ------------------------------
    page = doc.new_page(width=W, height=H)
    _header_footer(page, 4)
    _running(page, "1.1 UMA SEÇÃO MENOR")
    _body(page, fitz.Rect(40, 70, W - 40, 200),
          "invariavelmente pior do que o do papel. Converter bem é, antes de tudo, jogar "
          "fora informação de diagramação que deixou de fazer sentido.")
    _body(page, fitz.Rect(40, 210, W - 40, 320),
          "A hifenização automática também atrapalha: uma palavra quebrada no fim da "
          "linha precisa ser remontada antes de virar texto corrido novamente.")
    page.insert_textbox(fitz.Rect(40, 335, W - 40, 370), "Capítulo 2 - As colunas",
                        fontsize=16, fontname="times-bold")
    _body(page, fitz.Rect(40, 375, W - 40, H - 45), LOREM)

    # --- página de duas colunas ---------------------------------------------
    page = doc.new_page(width=W, height=H)
    _header_footer(page, 5)
    _running(page, "CAPÍTULO 2 - AS COLUNAS")
    _body(page, fitz.Rect(40, 70, 195, H - 60), LOREM * 2, size=9)
    _body(page, fitz.Rect(225, 70, W - 40, H - 60),
          "Segunda coluna: o texto desta metade só faz sentido depois de terminada a "
          "coluna da esquerda, e um extrator ingênuo intercala as duas linha a linha. " + LOREM,
          size=9)

    # --- lista, nota de rodapé e sumário falso ------------------------------
    page = doc.new_page(width=W, height=H)
    _header_footer(page, 6)
    page.insert_textbox(fitz.Rect(40, 66, W - 40, 100), "Capítulo 3 - Listas e notas",
                        fontsize=16, fontname="times-bold")
    items = [
        "- Cabeçalhos e rodapés repetidos precisam sair do fluxo do texto.",
        "- Números de página não significam nada em um e-book.",
        "- Notas de rodapé podem ir para o fim do documento.",
    ]
    y = 110
    for item in items:
        page.insert_textbox(fitz.Rect(50, y, W - 40, y + 30), item, fontsize=BODY, fontname="times-roman")
        y += 26
    _body(page, fitz.Rect(40, y + 10, W - 40, H - 190), LOREM)
    # uma figura de verdade, para testar a extração de imagens
    pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 240, 120))
    pix.set_rect(pix.irect, (210, 190, 160))
    pix.set_rect(fitz.IRect(20, 20, 220, 100), (90, 60, 40))
    page.insert_image(fitz.Rect(90, H - 180, 330, H - 90), pixmap=pix)
    page.draw_line(fitz.Point(40, H - 80), fitz.Point(160, H - 80), width=0.5)
    page.insert_textbox(fitz.Rect(40, H - 74, W - 40, H - 40),
                        "1 Nota de rodapé em corpo menor, no pé da página, com marcador numérico.",
                        fontsize=7, fontname="times-roman")

    doc.save(path)
    doc.close()
    return path


if __name__ == "__main__":
    import sys

    print(build(sys.argv[1] if len(sys.argv) > 1 else "sample.pdf"))
