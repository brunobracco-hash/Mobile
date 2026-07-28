"""Baixa os dados de idioma do Tesseract usados pelo OCR embutido.

O motor de reconhecimento já vem dentro do PyMuPDF; o que falta são os
arquivos .traineddata, que são dados (licença Apache 2.0) e não programas.
Ficam fora do controle de versão: o build local e o do Windows chamam este
script antes de empacotar.
"""

from __future__ import annotations

import os
import sys
import urllib.request

# tessdata_fast: mesma precisão prática com uma fração do tamanho dos dados
# completos, o que importa quando tudo vai dentro de um executável.
BASE = "https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main"
IDIOMAS = ("por", "eng")

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DESTINO = os.path.join(RAIZ, "assets", "tessdata")


def build(destino: str = DESTINO, idiomas=IDIOMAS) -> str:
    os.makedirs(destino, exist_ok=True)
    for idioma in idiomas:
        alvo = os.path.join(destino, f"{idioma}.traineddata")
        if os.path.exists(alvo) and os.path.getsize(alvo) > 100_000:
            print(f"{idioma}: já está aqui")
            continue
        url = f"{BASE}/{idioma}.traineddata"
        print(f"{idioma}: baixando {url}")
        with urllib.request.urlopen(url, timeout=180) as resposta:
            dados = resposta.read()
        if len(dados) < 100_000:
            raise RuntimeError(f"{idioma}: o download veio pequeno demais ({len(dados)} bytes)")
        with open(alvo, "wb") as handle:
            handle.write(dados)
        print(f"{idioma}: {len(dados) / 1e6:.1f} MB")
    return destino


if __name__ == "__main__":
    print(build(sys.argv[1] if len(sys.argv) > 1 else DESTINO))
