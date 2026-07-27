"""Interface web local: arrasta o PDF, baixa o .docx.

Roda em 127.0.0.1 por padrão — os arquivos ficam apenas na máquina de quem usa,
em uma pasta temporária que é limpa depois do download.
"""

from __future__ import annotations

import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from typing import Dict

from flask import Flask, abort, jsonify, render_template, request, send_file

from .converter import Options, convert

MAX_UPLOAD_MB = 200
JOB_TTL_SECONDS = 30 * 60

_jobs: Dict[str, dict] = {}
_lock = threading.Lock()
_workdir = os.path.join(tempfile.gettempdir(), "pdf2kindle-web")


def _safe_name(name: str) -> str:
    name = os.path.basename(name or "documento.pdf")
    name = re.sub(r"[^\w\s.\-()\[\]áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]", "_", name).strip()
    return name or "documento.pdf"


def _sweep() -> None:
    now = time.time()
    with _lock:
        expired = [job_id for job_id, job in _jobs.items() if now - job["created"] > JOB_TTL_SECONDS]
        for job_id in expired:
            job = _jobs.pop(job_id)
            shutil.rmtree(job["dir"], ignore_errors=True)


def create_app() -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024
    os.makedirs(_workdir, exist_ok=True)

    @app.get("/")
    def index():
        return render_template("index.html", max_mb=MAX_UPLOAD_MB)

    @app.post("/convert")
    def do_convert():
        _sweep()
        upload = request.files.get("file")
        if not upload or not upload.filename:
            return jsonify(error="Selecione um arquivo PDF."), 400
        filename = _safe_name(upload.filename)
        if not filename.lower().endswith(".pdf"):
            return jsonify(error="O arquivo precisa ser um PDF."), 400

        form = request.form
        options = Options(
            title=form.get("title") or None,
            author=form.get("author") or None,
            font=form.get("font") or "Georgia",
            body_pt=float(form.get("body_pt") or 12),
            line_spacing=float(form.get("line_spacing") or 1.15),
            justify=form.get("justify") == "on",
            toc=form.get("toc") == "on",
            title_page=form.get("title_page") == "on",
            page_break_chapters=form.get("page_breaks") == "on",
            keep_images=form.get("images") == "on",
            footnotes=form.get("footnotes") or "end",
            ocr=form.get("ocr") or "auto",
            lang=form.get("lang") or "pt-BR",
        )

        job_id = uuid.uuid4().hex
        job_dir = os.path.join(_workdir, job_id)
        os.makedirs(job_dir, exist_ok=True)
        pdf_path = os.path.join(job_dir, filename)
        upload.save(pdf_path)
        docx_name = os.path.splitext(filename)[0] + ".docx"
        docx_path = os.path.join(job_dir, docx_name)

        try:
            result = convert(pdf_path, docx_path, options)
        except Exception as exc:  # noqa: BLE001
            shutil.rmtree(job_dir, ignore_errors=True)
            return jsonify(error=f"Não consegui converter: {exc}"), 500

        with _lock:
            _jobs[job_id] = {"dir": job_dir, "path": docx_path, "name": docx_name, "created": time.time()}

        return jsonify(
            id=job_id,
            name=docx_name,
            stats=result.document.stats,
            warnings=result.warnings,
            ocr=result.ocr_applied,
            title=result.document.title,
        )

    @app.get("/download/<job_id>")
    def download(job_id: str):
        with _lock:
            job = _jobs.get(job_id)
        if not job or not os.path.exists(job["path"]):
            abort(404)
        return send_file(
            job["path"],
            as_attachment=True,
            download_name=job["name"],
            mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

    @app.errorhandler(413)
    def too_large(_err):
        return jsonify(error=f"Arquivo maior que {MAX_UPLOAD_MB} MB."), 413

    return app


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(prog="pdf2kindle-web", description="Interface web do pdf2kindle")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5000)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()
    app = create_app()
    print(f"pdf2kindle: http://{args.host}:{args.port}")
    app.run(host=args.host, port=args.port, debug=args.debug)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
