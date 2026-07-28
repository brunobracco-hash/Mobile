"""Gera o notebook do Colab (pdf2kindle_colab.ipynb).

O notebook é escrito por script para que o JSON saia sempre válido e para que
o código das células possa ser testado como código de verdade, e não como
texto solto dentro de um arquivo .ipynb.
"""

from __future__ import annotations

import json
import os

REPO = "https://github.com/brunobracco-hash/Mobile.git"

INTRO = """# PDF → Word para Kindle

Converte um PDF em um `.docx` **refluível e diagramado para ler no Kindle**:
parágrafos remontados, títulos, sumário navegável e notas reunidas no fim.

Funciona pelo navegador do celular — nada é instalado no aparelho, e o arquivo
não passa por nenhum servidor meu: tudo acontece na máquina temporária que o
Google empresta para este notebook.

**Toque no ▶ de cada célula, de cima para baixo.**
"""

INSTALL = f"""#@title Passo 1 — Instalar (demora ~1 minuto) {{ display-mode: "form" }}
!pip install -q "git+{REPO}"
print("Pronto. Pode ir para o passo 2.")
"""

OCR = '''#@title Passo 2 (opcional) — Só se o livro for escaneado { display-mode: "form" }
# Um PDF escaneado é a fotografia das páginas: não tem texto, só imagem.
# Se o seu PDF é um e-book comum, PULE esta célula e vá para o passo 3.
# Demora ~2 minutos. A saída fica à mostra de propósito: se a instalação falhar,
# o motivo precisa aparecer aqui, e não virar um "command not found" adiante.
!apt-get -qq update
!apt-get -qq install -y tesseract-ocr tesseract-ocr-por ghostscript
!pip install -q ocrmypdf

import shutil
import subprocess

if shutil.which("ocrmypdf") and shutil.which("tesseract"):
    # o ocrmypdf 17 imprime a versão em stderr, o 15 em stdout
    checagem = subprocess.run(["ocrmypdf", "--version"], capture_output=True, text=True)
    versao = (checagem.stdout + checagem.stderr).strip()
    idiomas = subprocess.run(["tesseract", "--list-langs"], capture_output=True, text=True).stdout
    print(f"OCR pronto (ocrmypdf {versao}).")
    print("português disponível:", "por" in idiomas)
else:
    faltando = [p for p in ("ocrmypdf", "tesseract") if not shutil.which(p)]
    print("Não consegui instalar:", ", ".join(faltando))
    print("Leia o erro acima e rode a célula de novo — costuma ser falha temporária.")
    print("Se insistir, dá para converter mesmo assim: no passo 4 escolha")
    print("'nunca reconhecer'. O texto não virá, mas as páginas em imagem sim.")
'''

UPLOAD = """#@title Passo 3 — Enviar o PDF { display-mode: "form" }
from google.colab import files

enviados = files.upload()
for nome in enviados:
    print("recebido:", nome)
"""

CONVERT = '''#@title Passo 4 — Converter e baixar { display-mode: "form" }
titulo = ""  #@param {type:"string"}
autor = ""  #@param {type:"string"}
notas_de_rodape = "reunir no fim"  #@param ["reunir no fim", "manter onde estão", "descartar"]
livro_escaneado = "detectar sozinho"  #@param ["detectar sozinho", "sempre reconhecer o texto", "nunca reconhecer"]
manter_imagens = True  #@param {type:"boolean"}
capitulo_em_pagina_nova = True  #@param {type:"boolean"}
texto_justificado = True  #@param {type:"boolean"}

import glob
import os

from pdf2kindle import Options, convert

NOTAS = {"reunir no fim": "end", "manter onde estão": "inline", "descartar": "drop"}
OCR = {"detectar sozinho": "auto", "sempre reconhecer o texto": "force", "nunca reconhecer": "off"}

opcoes = Options(
    title=titulo or None,
    author=autor or None,
    footnotes=NOTAS[notas_de_rodape],
    ocr=OCR[livro_escaneado],
    keep_images=manter_imagens,
    page_break_chapters=capitulo_em_pagina_nova,
    justify=texto_justificado,
)

pdfs = sorted(glob.glob("*.pdf"))
if not pdfs:
    print("Nenhum PDF por aqui. Volte ao passo 3 e envie o arquivo.")

for pdf in pdfs:
    saida = os.path.splitext(pdf)[0] + ".docx"
    resultado = convert(pdf, saida, opcoes)
    s = resultado.document.stats
    print(f"\\n{pdf} → {saida}")
    print(
        f"  {s['pages']} páginas · {s['headings']} títulos · {s['paragraphs']} parágrafos"
        f" · {s['images']} imagens · {s['notes']} notas"
    )
    if resultado.ocr_applied:
        print("  texto reconhecido por OCR")
    for aviso in resultado.warnings:
        print(f"  aviso: {aviso}")

    try:
        from google.colab import files

        files.download(saida)
    except Exception:
        print("  (se o download não começar, abra a pasta 📁 na lateral e baixe por lá)")
'''

FINAL = """## Como mandar para o Kindle

1. O `.docx` foi baixado para o seu celular (normalmente em *Downloads*).
2. Anexe em um e-mail para o **seu endereço `@kindle.com`** — ele aparece em
   *Amazon → Conta → Conteúdo e dispositivos → Preferências → Enviar para Kindle*.
   Mande do e-mail que estiver autorizado nessa mesma página.
3. Em poucos minutos o livro aparece no aplicativo Kindle, já com o sumário
   navegável montado a partir dos títulos.

Dá também para abrir o `.docx` no Word ou no Google Docs antes de enviar, se
quiser conferir ou corrigir algum título — eles usam os estilos `Título 1/2/3`.

**Livro escaneado:** as figuras se perdem, porque fazem parte da fotografia da
página. O texto vem completo.
"""


def build(path: str) -> str:
    def code(source: str) -> dict:
        return {
            "cell_type": "code",
            "execution_count": None,
            "metadata": {"cellView": "form"},
            "outputs": [],
            "source": source.splitlines(keepends=True),
        }

    def markdown(source: str) -> dict:
        return {"cell_type": "markdown", "metadata": {}, "source": source.splitlines(keepends=True)}

    notebook = {
        "nbformat": 4,
        "nbformat_minor": 0,
        "metadata": {
            "colab": {"provenance": [], "toc_visible": True, "name": "pdf2kindle"},
            "kernelspec": {"name": "python3", "display_name": "Python 3"},
            "language_info": {"name": "python"},
        },
        "cells": [
            markdown(INTRO),
            code(INSTALL),
            code(OCR),
            code(UPLOAD),
            code(CONVERT),
            markdown(FINAL),
        ],
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(notebook, handle, ensure_ascii=False, indent=1)
        handle.write("\n")
    return path


if __name__ == "__main__":
    import sys

    destino = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pdf2kindle_colab.ipynb"
    )
    print(build(destino))
