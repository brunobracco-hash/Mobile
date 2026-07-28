"""O notebook do Colab é a porta de entrada de quem não tem computador —
se ele quebrar, quebra em silêncio, no celular de alguém."""

import json
import os

import pytest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOTEBOOK = os.path.join(RAIZ, "pdf2kindle_colab.ipynb")


@pytest.fixture(scope="module")
def notebook():
    with open(NOTEBOOK, encoding="utf-8") as handle:
        return json.load(handle)


def test_notebook_e_json_valido(notebook):
    assert notebook["nbformat"] == 4
    assert notebook["cells"]


def test_todas_as_celulas_de_codigo_compilam(notebook):
    for i, celula in enumerate(notebook["cells"]):
        if celula["cell_type"] != "code":
            continue
        codigo = "".join(celula["source"])
        # linhas de shell (!pip, %cd) não são Python
        python = "\n".join(l for l in codigo.splitlines() if not l.lstrip().startswith(("!", "%")))
        compile(python, f"celula-{i}", "exec")


def test_instala_do_repositorio_publico(notebook):
    codigo = "".join("".join(c["source"]) for c in notebook["cells"])
    assert "pip install" in codigo
    assert "github.com/brunobracco-hash/Mobile" in codigo


def test_usa_a_api_publica_do_pacote(notebook):
    """Se a assinatura de convert/Options mudar, o notebook precisa mudar junto."""
    import inspect

    from pdf2kindle import Options, convert

    codigo = "".join("".join(c["source"]) for c in notebook["cells"])
    assert "from pdf2kindle import Options, convert" in codigo

    campos = set(inspect.signature(Options).parameters)
    usados = {"title", "author", "footnotes", "ocr", "keep_images", "page_break_chapters", "justify"}
    assert usados <= campos, f"o notebook usa opções que não existem: {usados - campos}"
    assert "output_path" in inspect.signature(convert).parameters


def test_notebook_esta_sincronizado_com_o_gerador(tmp_path):
    """O .ipynb é gerado por script: os dois não podem divergir."""
    import sys

    sys.path.insert(0, os.path.join(RAIZ, "scripts"))
    from build_colab_notebook import build

    esperado = build(str(tmp_path / "gerado.ipynb"))
    with open(esperado, encoding="utf-8") as a, open(NOTEBOOK, encoding="utf-8") as b:
        assert a.read() == b.read(), "rode: python scripts/build_colab_notebook.py"
