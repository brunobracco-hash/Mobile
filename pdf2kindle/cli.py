"""Interface de linha de comando."""

from __future__ import annotations

import argparse
import glob
import os
import sys
from typing import List

from .converter import Options, convert


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="pdf2kindle",
        description="Converte PDF em .docx refluível e diagramado para ler no Kindle.",
    )
    parser.add_argument("inputs", nargs="+", help="arquivos PDF (aceita curingas: livros/*.pdf)")
    parser.add_argument("-o", "--output", help="arquivo .docx de saída (só com um PDF de entrada)")
    parser.add_argument("-d", "--outdir", help="pasta de saída (padrão: a mesma pasta do PDF)")
    parser.add_argument("--title", help="título do e-book (padrão: metadados do PDF)")
    parser.add_argument("--author", help="autor do e-book")
    parser.add_argument("--font", default="Georgia", help="fonte do corpo (padrão: Georgia)")
    parser.add_argument("--size", type=float, default=12.0, dest="body_pt", help="corpo em pt (padrão: 12)")
    parser.add_argument("--line-spacing", type=float, default=1.15, help="entrelinhas (padrão: 1.15)")
    parser.add_argument("--no-justify", action="store_true", help="alinhar à esquerda em vez de justificar")
    parser.add_argument("--no-toc", action="store_true", help="não gerar o sumário")
    parser.add_argument("--no-title-page", action="store_true", help="não gerar a página de rosto")
    parser.add_argument("--no-page-breaks", action="store_true", help="não começar cada capítulo em página nova")
    parser.add_argument("--no-images", action="store_true", help="descartar as imagens")
    parser.add_argument(
        "--footnotes",
        choices=["end", "inline", "drop"],
        default="end",
        help="notas de rodapé: reunir no fim (padrão), manter no meio do texto ou descartar",
    )
    parser.add_argument(
        "--ocr",
        choices=["auto", "force", "off"],
        default="auto",
        help="reconhecimento de texto: automático em PDF digitalizado, sempre, ou nunca",
    )
    parser.add_argument("--ocr-lang", default="por+eng", help="idiomas do OCR (padrão: por+eng)")
    parser.add_argument("--ocr-dpi", type=int, default=300, help="resolução do OCR (padrão: 300)")
    parser.add_argument("--lang", default="pt-BR", help="idioma do documento (padrão: pt-BR)")
    parser.add_argument("-q", "--quiet", action="store_true", help="não imprimir o relatório")
    return parser


def _prepare_console() -> None:
    """Impede que o relatório derrube a conversão no console do Windows.

    Lá a saída padrão é cp1252, que não tem '→' nem vários outros sinais: sem
    isto, o arquivo é convertido com sucesso e o programa morre na hora de
    contar o que fez.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")  # type: ignore[union-attr]
        except (AttributeError, ValueError, OSError):
            pass


def _expand(inputs: List[str]) -> List[str]:
    files: List[str] = []
    for item in inputs:
        matches = sorted(glob.glob(item)) if any(c in item for c in "*?[") else [item]
        files.extend(matches)
    return files


def main(argv: List[str] | None = None) -> int:
    _prepare_console()
    args = build_parser().parse_args(argv)
    files = _expand(args.inputs)
    if not files:
        print("Nenhum PDF encontrado.", file=sys.stderr)
        return 1
    if args.output and len(files) > 1:
        print("--output só vale para um único PDF; use --outdir.", file=sys.stderr)
        return 1

    options = Options(
        title=args.title,
        author=args.author,
        font=args.font,
        body_pt=args.body_pt,
        line_spacing=args.line_spacing,
        justify=not args.no_justify,
        toc=not args.no_toc,
        title_page=not args.no_title_page,
        page_break_chapters=not args.no_page_breaks,
        keep_images=not args.no_images,
        footnotes=args.footnotes,
        ocr=args.ocr,
        ocr_lang=args.ocr_lang,
        ocr_dpi=args.ocr_dpi,
        lang=args.lang,
    )

    failures = 0
    for path in files:
        if not os.path.isfile(path):
            print(f"não encontrei: {path}", file=sys.stderr)
            failures += 1
            continue
        if args.output:
            output = args.output
        else:
            base = os.path.splitext(os.path.basename(path))[0]
            # Sem --outdir o resultado fica ao lado do PDF: é onde quem converte
            # espera encontrá-lo, e o diretório atual de um .exe clicado no
            # Windows pode ser qualquer um.
            destino = args.outdir or os.path.dirname(os.path.abspath(path))
            os.makedirs(destino, exist_ok=True)
            output = os.path.join(destino, base + ".docx")
        # O OCR de um livro leva minutos: sem sinal de vida parece travado.
        def anuncia(pagina: int, total: int, _quieto=args.quiet) -> None:
            if not _quieto and total > 20 and pagina % 10 == 0:
                print(f"  lendo página {pagina}/{total}", flush=True)

        try:
            result = convert(path, output, options, on_page=anuncia)
        except Exception as exc:  # noqa: BLE001 - a CLI não deve explodir com stack trace
            print(f"falhou: {path}: {exc}", file=sys.stderr)
            failures += 1
            continue

        if not args.quiet:
            stats = result.document.stats
            print(f"{path} → {output}")
            print(
                "  {pages} páginas · {headings} títulos · {paragraphs} parágrafos · "
                "{images} imagens · {notes} notas".format(**stats)
            )
            if result.ocr_applied:
                print(f"  texto reconhecido por OCR em {result.ocr_pages} página(s)")
            for warning in result.warnings:
                print(f"  aviso: {warning}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
