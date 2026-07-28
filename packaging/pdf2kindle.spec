# -*- mode: python ; coding: utf-8 -*-
"""Receita do PyInstaller: gera pdf2kindle.exe (janela) e pdf2kindle-cli.exe."""

import os

from PyInstaller.utils.hooks import collect_data_files

RAIZ = os.path.abspath(os.path.join(SPECPATH, os.pardir))
ICONE = os.path.join(RAIZ, "assets", "pdf2kindle.ico")

# O python-docx abre um .docx de modelo em tempo de execução; sem estes dados
# o executável só falha na hora de salvar o arquivo, não ao iniciar.
DADOS = collect_data_files("docx")
# o mesmo ícone do executável serve à janela (canto superior e alt-tab)
DADOS += [(ICONE, "assets")]

# Dados de idioma do OCR. O motor de reconhecimento já vem dentro do PyMuPDF,
# então embutindo estes arquivos o executável reconhece livro escaneado sem
# depender de nada instalado na máquina. Rode antes: scripts/fetch_tessdata.py
TESSDATA = os.path.join(RAIZ, "assets", "tessdata")
if os.path.isdir(TESSDATA):
    DADOS += [(os.path.join(TESSDATA, nome), "tessdata")
              for nome in os.listdir(TESSDATA) if nome.endswith(".traineddata")]
else:
    print("AVISO: assets/tessdata não existe — o executável sairá sem OCR embutido")

# A interface web não entra no executável: quem usa a janela não precisa dela.
EXCLUIR = ["flask", "werkzeug", "jinja2", "click", "itsdangerous", "pytest",
           "numpy", "PIL", "matplotlib", "IPython", "pandas", "setuptools"]


def analisa(script):
    return Analysis(
        [os.path.join(RAIZ, "packaging", script)],
        pathex=[RAIZ],
        binaries=[],
        datas=DADOS,
        hiddenimports=[],
        hookspath=[],
        excludes=EXCLUIR,
        noarchive=False,
    )


janela = analisa("pdf2kindle_app.py")
exe_janela = EXE(
    PYZ(janela.pure),
    janela.scripts,
    janela.binaries,
    janela.datas,
    [],
    name="pdf2kindle",
    debug=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,          # sem janela preta de terminal atrás do app
    icon=ICONE,
)

terminal = analisa("pdf2kindle_cli.py")
exe_terminal = EXE(
    PYZ(terminal.pure),
    terminal.scripts,
    terminal.binaries,
    terminal.datas,
    [],
    name="pdf2kindle-cli",
    debug=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=True,
    icon=ICONE,
)
