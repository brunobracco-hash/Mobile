"""Pipeline completo: PDF → (OCR quando preciso) → modelo → DOCX para o Kindle."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Callable, List, Optional

from .docx_writer import write_docx
from .extract import extract, tessdata_dir
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
    ocr_dpi: int = 300
    lang: str = "pt-BR"


@dataclass
class Result:
    output_path: str
    document: Document
    warnings: List[str] = field(default_factory=list)
    ocr_applied: bool = False
    ocr_pages: int = 0


def ocr_disponivel() -> bool:
    """O reconhecimento vem embutido; só os dados de idioma podem faltar."""
    return tessdata_dir() is not None


def convert(
    input_path: str,
    output_path: str,
    options: Optional[Options] = None,
    on_page: Optional[Callable[[int, int], None]] = None,
) -> Result:
    options = options or Options()

    extraction = extract(
        input_path,
        keep_images=options.keep_images,
        ocr=options.ocr,
        ocr_lang=options.ocr_lang,
        ocr_dpi=options.ocr_dpi,
        on_page=on_page,
    )
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
        ocr_applied=extraction.ocr_pages > 0,
        ocr_pages=extraction.ocr_pages,
    )
