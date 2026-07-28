"""Transforma um PDF em 'livro escaneado': rasteriza as páginas com a
inclinação típica do scanner e descarta a camada de texto.

Usado pela verificação no Windows, onde o executável precisa provar que
reconhece o texto sem nada instalado na máquina.
"""

from __future__ import annotations

import sys

import fitz


def build(origem: str, destino: str, dpi: int = 200, inclinacao: float = 0.5) -> str:
    entrada = fitz.open(origem)
    saida = fitz.open()
    for pagina in entrada:
        matriz = fitz.Matrix(dpi / 72, dpi / 72).prerotate(inclinacao)
        pix = pagina.get_pixmap(matrix=matriz, colorspace=fitz.csGRAY, alpha=False)
        nova = saida.new_page(width=pagina.rect.width, height=pagina.rect.height)
        nova.insert_image(nova.rect, stream=pix.tobytes("jpeg", jpg_quality=60))
    entrada.close()
    saida.save(destino)
    saida.close()
    return destino


if __name__ == "__main__":
    print(build(sys.argv[1], sys.argv[2]))
