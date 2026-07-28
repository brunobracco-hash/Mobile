"""Pipeline completo: PDF → (OCR opcional) → modelo → DOCX pronto para o Kindle."""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field
from typing import List, Optional

from .docx_writer import write_docx
from .extract import extract, has_text_layer
from .model import Document
from .structure import build_document, sanitize


@dataclass
class Options:
    title: Optional[str] = None
    author: Optional[str] = None
    font: str = "Georgia"
    body_pt: float = 12.0
    line_spacing: float = 1.15
    justify: bool = True
    toc: bool = True
    title_page: bool = True
    page_break_chapters: bool = True
    keep_images: bool = True
    footnotes: str = "end"          # end | inline | drop
    ocr: str = "auto"               # auto | force | off
    ocr_lang: str = "por+eng"
    lang: str = "pt-BR"


@dataclass
class Result:
    output_path: str
    document: Document
    warnings: List[str] = field(default_factory=list)
    ocr_applied: bool = False


def _run_ocr(path: str, lang: str, warnings: List[str]) -> str:
    """Adiciona camada de texto a um PDF digitalizado, se o ocrmypdf existir."""
    if not shutil.which("ocrmypdf"):
        warnings.append(
            "OCR solicitado, mas o 'ocrmypdf' não está instalado. Instale com: "
            "pip install ocrmypdf (e o motor de reconhecimento: "
            "sudo apt install tesseract-ocr tesseract-ocr-por ghostscript)"
        )
        return path
    out_fd, out_path = tempfile.mkstemp(suffix=".ocr.pdf")
    os.close(out_fd)
    cmd = ["ocrmypdf", "--skip-text", "--optimize", "1", "--language", lang, path, out_path]
    try:
        subprocess.run(cmd, check=True, capture_output=True, timeout=3600)
        return out_path
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or b"").decode("utf-8", "replace").strip().splitlines()[-1:] or [""]
        warnings.append(f"O OCR falhou ({detail[0]}); seguindo com o texto que o PDF já tinha.")
    except subprocess.TimeoutExpired:
        warnings.append("O OCR passou de 60 minutos e foi cancelado; seguindo sem ele.")
    if os.path.exists(out_path):
        os.unlink(out_path)
    return path


def convert(input_path: str, output_path: str, options: Optional[Options] = None) -> Result:
    options = options or Options()
    warnings: List[str] = []
    working_path = input_path
    ocr_applied = False

    if options.ocr == "force" or (options.ocr == "auto" and not has_text_layer(input_path)):
        if options.ocr != "off":
            new_path = _run_ocr(input_path, options.ocr_lang, warnings)
            ocr_applied = new_path != input_path
            working_path = new_path

    try:
        extraction = extract(working_path, keep_images=options.keep_images)
        fallback = os.path.splitext(os.path.basename(input_path))[0].replace("_", " ").strip()
        document = build_document(
            extraction,
            fallback_title=fallback or "Documento",
            footnotes=options.footnotes,
            keep_images=options.keep_images,
        )
        if options.title:
            document.title = sanitize(options.title)
        if options.author:
            document.author = sanitize(options.author)
        document.warnings = warnings + document.warnings

        write_docx(
            document,
            output_path,
            font=options.font,
            body_pt=options.body_pt,
            line_spacing=options.line_spacing,
            justify=options.justify,
            toc=options.toc,
            title_page=options.title_page,
            page_break_chapters=options.page_break_chapters,
            lang=options.lang,
        )
        return Result(
            output_path=output_path,
            document=document,
            warnings=document.warnings,
            ocr_applied=ocr_applied,
        )
    finally:
        if working_path != input_path and os.path.exists(working_path):
            os.unlink(working_path)
