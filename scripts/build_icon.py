"""Gera o ícone do aplicativo (assets/pdf2kindle.ico).

Desenha uma página com linhas de texto sobre um fundo escuro e empacota os
tamanhos exigidos pelo Windows. O .ico é escrito à mão porque o formato é um
contêiner simples de PNGs — assim o projeto não ganha uma dependência de
imagem só para ter ícone.
"""

from __future__ import annotations

import os
import struct
from typing import List, Tuple

import fitz

TAMANHOS = (16, 24, 32, 48, 64, 128, 256)
LADO = 256.0

FUNDO = (0.13, 0.12, 0.15)
PAPEL = (0.98, 0.97, 0.94)
TINTA = (0.55, 0.36, 0.18)
LINHA = (0.62, 0.60, 0.56)


def _desenha() -> fitz.Document:
    doc = fitz.open()
    page = doc.new_page(width=LADO, height=LADO)
    forma = page.new_shape()

    # fundo arredondado
    forma.draw_rect(fitz.Rect(0, 0, LADO, LADO))
    forma.finish(fill=FUNDO, color=FUNDO)

    # página, com o canto superior direito dobrado
    margem, dobra = 56.0, 46.0
    corpo = [
        fitz.Point(margem, 34),
        fitz.Point(LADO - margem - dobra, 34),
        fitz.Point(LADO - margem, 34 + dobra),
        fitz.Point(LADO - margem, LADO - 34),
        fitz.Point(margem, LADO - 34),
    ]
    for i in range(len(corpo)):
        forma.draw_line(corpo[i], corpo[(i + 1) % len(corpo)])
    forma.finish(fill=PAPEL, color=PAPEL, closePath=True)

    forma.draw_line(fitz.Point(LADO - margem - dobra, 34), fitz.Point(LADO - margem - dobra, 34 + dobra))
    forma.draw_line(fitz.Point(LADO - margem - dobra, 34 + dobra), fitz.Point(LADO - margem, 34 + dobra))
    forma.finish(color=LINHA, width=4)

    # linhas de texto: as duas primeiras são o título, em destaque
    y = 108.0
    for i in range(6):
        largura = (LADO - 2 * margem) * (0.82 if i < 2 else 0.62 if i % 2 else 0.74)
        forma.draw_rect(fitz.Rect(margem + 22, y, margem + 22 + largura, y + (10 if i < 2 else 7)))
        forma.finish(fill=TINTA if i < 2 else LINHA, color=None)
        y += 24 if i < 2 else 20

    forma.commit()
    return doc


def _pngs() -> List[Tuple[int, bytes]]:
    doc = _desenha()
    try:
        page = doc[0]
        saida = []
        for tamanho in TAMANHOS:
            escala = tamanho / LADO
            pix = page.get_pixmap(matrix=fitz.Matrix(escala, escala), alpha=False)
            saida.append((tamanho, pix.tobytes("png")))
        return saida
    finally:
        doc.close()


def build(destino: str) -> str:
    imagens = _pngs()
    cabecalho = struct.pack("<HHH", 0, 1, len(imagens))  # reservado, tipo=ícone, quantidade
    entradas = b""
    dados = b""
    deslocamento = len(cabecalho) + 16 * len(imagens)
    for tamanho, png in imagens:
        entradas += struct.pack(
            "<BBBBHHII",
            0 if tamanho >= 256 else tamanho,  # 0 significa 256 no formato
            0 if tamanho >= 256 else tamanho,
            0,  # paleta
            0,  # reservado
            1,  # planos
            32,  # bits por pixel
            len(png),
            deslocamento,
        )
        dados += png
        deslocamento += len(png)

    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, "wb") as handle:
        handle.write(cabecalho + entradas + dados)
    return destino


if __name__ == "__main__":
    import sys

    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    padrao = os.path.join(raiz, "assets", "pdf2kindle.ico")
    print(build(sys.argv[1] if len(sys.argv) > 1 else padrao))
