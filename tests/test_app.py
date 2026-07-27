"""CLI e interface web."""

import io
import os

import docx

from pdf2kindle.cli import main
from pdf2kindle.web import create_app


def test_cli_converte_e_relata(sample_pdf, tmp_path, capsys):
    saida = tmp_path / "cli.docx"
    assert main([sample_pdf, "-o", str(saida)]) == 0
    assert saida.exists()
    relatorio = capsys.readouterr().out
    assert "páginas" in relatorio and "títulos" in relatorio


def test_cli_em_lote(sample_pdf, tmp_path):
    destino = tmp_path / "saida"
    assert main([sample_pdf, sample_pdf, "-d", str(destino), "-q"]) == 0
    assert (destino / "amostra.docx").exists()


def test_cli_falha_com_arquivo_inexistente(tmp_path, capsys):
    assert main([str(tmp_path / "nao-existe.pdf"), "-q"]) == 1


def test_cli_recusa_output_com_varios_pdfs(sample_pdf, tmp_path):
    assert main([sample_pdf, sample_pdf, "-o", str(tmp_path / "x.docx")]) == 1


def test_web_converte_e_baixa(sample_pdf):
    cliente = create_app().test_client()
    assert cliente.get("/").status_code == 200

    with open(sample_pdf, "rb") as handle:
        dados = {
            "file": (io.BytesIO(handle.read()), "amostra.pdf"),
            "toc": "on",
            "title_page": "on",
            "images": "on",
            "justify": "on",
            "page_breaks": "on",
        }
        resposta = cliente.post("/convert", data=dados, content_type="multipart/form-data")
    assert resposta.status_code == 200
    payload = resposta.get_json()
    assert payload["stats"]["headings"] >= 4
    assert payload["name"] == "amostra.docx"

    download = cliente.get(f"/download/{payload['id']}")
    assert download.status_code == 200
    assert download.headers["Content-Type"].startswith("application/vnd.openxmlformats")
    doc = docx.Document(io.BytesIO(download.data))
    assert doc.core_properties.title == "A Página e a Tela"


def test_web_recusa_arquivo_que_nao_e_pdf():
    cliente = create_app().test_client()
    dados = {"file": (io.BytesIO(b"nao sou pdf"), "texto.txt")}
    resposta = cliente.post("/convert", data=dados, content_type="multipart/form-data")
    assert resposta.status_code == 400
    assert "PDF" in resposta.get_json()["error"]


def test_web_download_inexistente():
    assert create_app().test_client().get("/download/inexistente").status_code == 404
