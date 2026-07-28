"""Extração do PDF preservando informação de layout.

Responsabilidades desta camada:
  * ler blocos de texto e imagens com PyMuPDF;
  * descobrir a ordem de leitura correta (inclusive em páginas de 2/3 colunas);
  * remover cabeçalhos, rodapés e números de página que se repetem;
  * detectar PDFs digitalizados (sem camada de texto).

Nada aqui decide o que é título ou parágrafo — isso é trabalho de structure.py.
"""

from __future__ import annotations

import collections
import glob
import hashlib
import os
import re
import sys
from typing import Callable, Dict, List, Optional, Tuple

import fitz  # PyMuPDF

from .model import Block, Line, Span

FLAG_ITALIC = 1 << 1
FLAG_BOLD = 1 << 4

# Zonas de margem onde moram cabeçalhos/rodapés (fração da altura da página).
HEADER_ZONE = 0.075
FOOTER_ZONE = 0.075

# Abaixo disso, a página não tem texto de verdade — é imagem de papel.
OCR_MIN_CHARS = 100

_DIGITS_RE = re.compile(r"\d+")
_ROMAN_RE = re.compile(r"^[ivxlcdm]+$", re.I)
_WS_RE = re.compile(r"\s+")


def _documento_tem_texto(doc, amostra: int = 10) -> bool:
    """Decide pelo documento inteiro, não por página.

    Em um PDF digital existem páginas quase sem texto — as de figura, as de
    abertura de parte. Reconhecê-las produz apenas ruído: o OCR não tem o que
    ler ali. Por isso 'auto' só liga o reconhecimento quando o documento como
    um todo não tem camada de texto.
    """
    total = doc.page_count
    if not total:
        return False
    indices = sorted({int(i * (total - 1) / max(1, min(amostra, total) - 1)) for i in range(min(amostra, total))})
    caracteres = sum(len(doc[i].get_text().strip()) for i in indices)
    return caracteres / len(indices) >= OCR_MIN_CHARS


def tessdata_dir() -> Optional[str]:
    """Onde estão os dados de idioma do OCR.

    O motor de reconhecimento vem dentro do PyMuPDF; o que precisa ser
    encontrado são os .traineddata. No executável eles viajam junto; fora dele,
    valem a variável de ambiente, a pasta do projeto e os locais do sistema.
    """
    candidatos = [os.environ.get("TESSDATA_PREFIX")]
    empacotado = getattr(sys, "_MEIPASS", None)
    if empacotado:
        candidatos.append(os.path.join(empacotado, "tessdata"))
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    candidatos.append(os.path.join(raiz, "assets", "tessdata"))
    candidatos += [
        "/usr/share/tesseract-ocr/5/tessdata",
        "/usr/share/tesseract-ocr/4.00/tessdata",
        "/usr/share/tessdata",
        "/usr/local/share/tessdata",
        r"C:\Program Files\Tesseract-OCR\tessdata",
    ]
    for candidato in candidatos:
        if candidato and glob.glob(os.path.join(candidato, "*.traineddata")):
            return candidato
    return None


def idiomas_disponiveis(pasta: str) -> List[str]:
    return sorted(
        os.path.splitext(os.path.basename(caminho))[0]
        for caminho in glob.glob(os.path.join(pasta, "*.traineddata"))
    )


def _resolve_idiomas(pedidos: str, pasta: str, avisos: List[str]) -> str:
    """Mantém só os idiomas que existem, para o OCR não falhar por um ausente."""
    disponiveis = set(idiomas_disponiveis(pasta))
    escolhidos = [i for i in pedidos.split("+") if i in disponiveis]
    if not escolhidos:
        alternativa = "por" if "por" in disponiveis else (sorted(disponiveis)[0] if disponiveis else "")
        if alternativa:
            avisos.append(f"Idioma(s) '{pedidos}' não encontrado(s) para o OCR; usando '{alternativa}'.")
            return alternativa
        return ""
    faltando = [i for i in pedidos.split("+") if i not in disponiveis]
    if faltando:
        avisos.append(f"Sem dados de OCR para: {', '.join(faltando)}. Seguindo com {'+'.join(escolhidos)}.")
    return "+".join(escolhidos)


class ExtractionResult:
    def __init__(self) -> None:
        self.blocks: List[Block] = []
        self.page_count: int = 0
        self.page_sizes: List[Tuple[float, float]] = []
        self.metadata: Dict[str, str] = {}
        self.warnings: List[str] = []
        self.text_chars: int = 0
        self.scanned: bool = False
        self.full_page_images_dropped: int = 0
        self.ocr_pages: int = 0


def _span_from_dict(raw: dict) -> Optional[Span]:
    text = raw.get("text", "")
    if not text:
        return None
    flags = raw.get("flags", 0)
    font = raw.get("font", "")
    bold = bool(flags & FLAG_BOLD) or "bold" in font.lower() or "black" in font.lower()
    italic = bool(flags & FLAG_ITALIC) or "italic" in font.lower() or "oblique" in font.lower()
    return Span(
        text=text,
        size=round(float(raw.get("size", 0.0)), 2),
        font=font,
        bold=bold,
        italic=italic,
        bbox=tuple(raw.get("bbox", (0, 0, 0, 0))),  # type: ignore[arg-type]
    )


def _normalize_running(text: str) -> str:
    """Normaliza uma linha para comparar cabeçalhos entre páginas.

    Números viram '#' porque a numeração muda de página para página, mas o resto
    do cabeçalho ('Capítulo 3 | O nome do livro') permanece igual.
    """
    text = _DIGITS_RE.sub("#", text.lower())
    return _WS_RE.sub(" ", text).strip()


def _is_page_number(text: str) -> bool:
    stripped = text.strip().strip(".-–—[]() ")
    if not stripped:
        return True
    if stripped.isdigit() and len(stripped) <= 4:
        return True
    if _ROMAN_RE.match(stripped) and len(stripped) <= 7:
        return True
    # Formatos como "- 12 -" ou "Página 12 de 300".
    if re.fullmatch(r"(p[áa]g(?:ina)?\.?\s*)?#?\s*\d+\s*(de|/)\s*\d+", stripped, re.I):
        return True
    return False


def _detect_column_splits(blocks: List[Block], width: float, height: float) -> List[float]:
    """Encontra faixas verticais vazias que separam colunas de texto.

    Devolve as coordenadas x dos cortes (vazio = página de coluna única).
    """
    text_blocks = [b for b in blocks if b.kind == "text"]
    if len(text_blocks) < 4:
        return []

    # Só consideramos blocos "de corpo": um bloco largo (título que atravessa a
    # página) não impede a existência de colunas abaixo dele.
    intervals = [(b.bbox[0], b.bbox[2]) for b in text_blocks if (b.bbox[2] - b.bbox[0]) < width * 0.7]
    if len(intervals) < 4:
        return []

    bins = 200
    occupied = [False] * bins
    for x0, x1 in intervals:
        start = max(0, int(x0 / width * bins))
        end = min(bins - 1, int(x1 / width * bins))
        for i in range(start, end + 1):
            occupied[i] = True

    gaps: List[Tuple[int, int]] = []
    run_start = None
    for i, filled in enumerate(occupied):
        if not filled and run_start is None:
            run_start = i
        elif filled and run_start is not None:
            gaps.append((run_start, i - 1))
            run_start = None
    if run_start is not None:
        gaps.append((run_start, bins - 1))

    splits: List[float] = []
    min_gap = max(2, int(bins * 0.035))
    for start, end in gaps:
        if start == 0 or end == bins - 1:  # margens laterais, não são separadores
            continue
        if (end - start + 1) < min_gap:
            continue
        center = (start + end + 1) / 2 / bins
        if 0.2 < center < 0.8:
            splits.append(center * width)

    if not splits:
        return []

    # Valida: cada coluna resultante precisa de conteúdo próprio.
    bounds = [0.0] + splits + [width]
    for i in range(len(bounds) - 1):
        lo, hi = bounds[i], bounds[i + 1]
        count = sum(1 for x0, x1 in intervals if lo <= (x0 + x1) / 2 <= hi)
        if count < 2:
            return []
    return splits


def _assign_columns(blocks: List[Block], splits: List[float]) -> None:
    for b in blocks:
        center = (b.bbox[0] + b.bbox[2]) / 2
        col = 0
        for s in splits:
            if center > s:
                col += 1
        # Um bloco que atravessa um separador (título que ocupa a largura toda)
        # pertence ao fluxo principal: vai para a primeira coluna.
        if any(b.bbox[0] < s < b.bbox[2] for s in splits):
            col = 0
        b.column = col


def _explode_ocr_blocks(page_dict: dict) -> dict:
    """Transforma cada linha reconhecida em um bloco próprio.

    O OCR agrupa em um mesmo bloco linhas de colunas diferentes: as linhas em si
    saem corretas, mas o bloco atravessa a página inteira e a detecção de
    colunas — que trabalha com blocos — não enxerga o vão. Separando linha a
    linha, cada uma volta a ter a largura da sua coluna, e a remontagem de
    parágrafos (que já lida com texto de OCR) refaz o resto.
    """
    novos = []
    for bloco in page_dict.get("blocks", []):
        if bloco.get("type") != 0:
            novos.append(bloco)
            continue
        for linha in bloco.get("lines", []):
            novos.append({"type": 0, "bbox": linha.get("bbox", bloco["bbox"]), "lines": [linha]})
    return {**page_dict, "blocks": novos}


def _dedupe_images(blocks: List[Block], page_count: int) -> List[Block]:
    """Remove logotipos e ornamentos que se repetem em muitas páginas."""
    if page_count < 4:
        return blocks
    counts: Dict[str, int] = collections.Counter()
    digests: Dict[int, str] = {}
    for idx, b in enumerate(blocks):
        if b.kind == "image" and b.image:
            digest = hashlib.sha1(b.image).hexdigest()
            digests[idx] = digest
            counts[digest] += 1
    threshold = max(3, int(page_count * 0.3))
    return [b for i, b in enumerate(blocks) if not (i in digests and counts[digests[i]] >= threshold)]


def _collect_running_text(pages_lines: List[List[Line]], page_heights: List[float]) -> set:
    """Descobre quais linhas de margem são cabeçalho/rodapé recorrente."""
    counter: Dict[str, set] = collections.defaultdict(set)
    for page_no, lines in enumerate(pages_lines):
        height = page_heights[page_no]
        for line in lines:
            in_header = line.top < height * HEADER_ZONE
            in_footer = line.bottom > height * (1 - FOOTER_ZONE)
            if not (in_header or in_footer):
                continue
            key = _normalize_running(line.text)
            if key:
                counter[key].add(page_no)
    n = len(pages_lines)
    threshold = max(3, int(n * 0.35))
    return {key for key, pages in counter.items() if len(pages) >= threshold}


def extract(
    path: str,
    keep_images: bool = True,
    ocr: str = "off",
    ocr_lang: str = "por+eng",
    ocr_dpi: int = 300,
    on_page: Optional[Callable[[int, int], None]] = None,
) -> ExtractionResult:
    """Lê o PDF e devolve blocos já na ordem de leitura, sem cabeçalho/rodapé.

    Com `ocr='auto'`, as páginas sem texto passam pelo reconhecimento embutido
    no PyMuPDF; com `'force'`, todas passam. `on_page` recebe (página, total) e
    serve para dar sinal de vida — reconhecer um livro inteiro leva minutos.
    """
    result = ExtractionResult()
    idioma = ""
    pasta_ocr = tessdata_dir() if ocr in ("auto", "force") else None
    if ocr in ("auto", "force"):
        if pasta_ocr:
            os.environ["TESSDATA_PREFIX"] = pasta_ocr
            idioma = _resolve_idiomas(ocr_lang, pasta_ocr, result.warnings)
        else:
            result.warnings.append(
                "OCR pedido, mas os dados de idioma não foram encontrados. "
                "Rode: python scripts/fetch_tessdata.py"
            )

    doc = fitz.open(path)
    try:
        if idioma and ocr == "auto" and _documento_tem_texto(doc):
            idioma = ""  # o PDF já tem texto: reconhecer só acrescentaria ruído
        result.page_count = doc.page_count
        meta = doc.metadata or {}
        result.metadata = {k: (v or "").strip() for k, v in meta.items() if isinstance(v, str)}

        raw_pages: List[List[Block]] = []
        page_lines: List[List[Line]] = []
        page_heights: List[float] = []

        for page_no, page in enumerate(doc):
            rect = page.rect
            width, height = rect.width, rect.height
            result.page_sizes.append((width, height))
            page_heights.append(height)

            if on_page:
                on_page(page_no + 1, doc.page_count)

            page_dict = None
            if idioma and (ocr == "force" or len(page.get_text().strip()) < OCR_MIN_CHARS):
                try:
                    textpage = page.get_textpage_ocr(language=idioma, dpi=ocr_dpi, full=True)
                    page_dict = _explode_ocr_blocks(page.get_text("dict", textpage=textpage))
                    result.ocr_pages += 1
                except Exception as erro:  # noqa: BLE001 - uma página ruim não perde o livro
                    result.warnings.append(f"OCR falhou na página {page_no + 1}: {erro}")
            if page_dict is None:
                page_dict = page.get_text("dict")

            blocks: List[Block] = []
            lines_here: List[Line] = []

            for raw_block in page_dict.get("blocks", []):
                bbox = tuple(raw_block.get("bbox", (0, 0, 0, 0)))
                if raw_block.get("type") == 1:  # imagem
                    if not keep_images:
                        continue
                    data = raw_block.get("image")
                    if not data:
                        continue
                    w = bbox[2] - bbox[0]
                    h = bbox[3] - bbox[1]
                    # Descarta fios, marcas d'água e ícones minúsculos.
                    if w < 40 or h < 40 or (w * h) < (width * height * 0.01):
                        continue
                    block = Block(
                        kind="image",
                        bbox=bbox,  # type: ignore[arg-type]
                        page=page_no,
                        image=data,
                        image_ext=raw_block.get("ext", "png"),
                    )
                    # Imagem que cobre a página inteira é a digitalização do
                    # papel. Se o documento tiver camada de texto, ela apenas
                    # duplica o conteúdo e multiplica o tamanho do arquivo — mas
                    # isso só se sabe depois de ler o documento todo.
                    block.full_page = (w * h) > (width * height * 0.8)
                    blocks.append(block)
                    continue

                block_lines: List[Line] = []
                for raw_line in raw_block.get("lines", []):
                    spans = [s for s in (_span_from_dict(rs) for rs in raw_line.get("spans", [])) if s]
                    if not spans:
                        continue
                    text = "".join(s.text for s in spans)
                    if not text.strip():
                        continue
                    # Texto vertical (marcas de margem) atrapalha a ordem de leitura.
                    direction = raw_line.get("dir", (1, 0))
                    if abs(direction[0]) < 0.7:
                        continue
                    line = Line(spans=spans, bbox=tuple(raw_line.get("bbox", bbox)), page=page_no)  # type: ignore[arg-type]
                    block_lines.append(line)
                    lines_here.append(line)
                    result.text_chars += len(text.strip())
                if block_lines:
                    blocks.append(Block(kind="text", bbox=bbox, page=page_no, lines=block_lines))  # type: ignore[arg-type]


            splits = _detect_column_splits(blocks, width, height)
            _assign_columns(blocks, splits)
            blocks.sort(key=lambda b: (b.column, round(b.bbox[1], 1), b.bbox[0]))
            raw_pages.append(blocks)
            page_lines.append(lines_here)

        running = _collect_running_text(page_lines, page_heights)

        flat: List[Block] = []
        for page_no, blocks in enumerate(raw_pages):
            height = page_heights[page_no]
            for block in blocks:
                if block.kind == "image":
                    flat.append(block)
                    continue
                kept: List[Line] = []
                for line in block.lines:
                    in_margin = line.top < height * HEADER_ZONE or line.bottom > height * (1 - FOOTER_ZONE)
                    if in_margin:
                        if _is_page_number(line.text):
                            continue
                        if _normalize_running(line.text) in running:
                            continue
                    kept.append(line)
                if kept:
                    block.lines = kept
                    block.bbox = (
                        min(l.bbox[0] for l in kept),
                        min(l.bbox[1] for l in kept),
                        max(l.bbox[2] for l in kept),
                        max(l.bbox[3] for l in kept),
                    )
                    flat.append(block)

        # Documento com camada de texto: a digitalização da página só duplicaria
        # o que já está escrito. Sem texto (PDF digitalizado que não passou por
        # OCR), ela é o único conteúdo que existe e precisa ser preservada.
        if result.text_chars / max(1, result.page_count) >= 200:
            before = len(flat)
            flat = [b for b in flat if not (b.kind == "image" and b.full_page)]
            result.full_page_images_dropped = before - len(flat)

        flat = _dedupe_images(flat, result.page_count)
        result.blocks = flat

        avg_chars = result.text_chars / max(1, result.page_count)
        if avg_chars < 80:
            result.scanned = True
            result.warnings.append(
                "O PDF praticamente não tem camada de texto (%.0f caracteres por página): "
                "provavelmente é digitalizado. Rode com --ocr para reconhecer o texto." % avg_chars
            )
        return result
    finally:
        doc.close()


def has_text_layer(path: str, sample_pages: int = 5) -> bool:
    """Checagem rápida usada antes de decidir por OCR."""
    doc = fitz.open(path)
    try:
        pages = min(sample_pages, doc.page_count)
        chars = sum(len(doc[i].get_text().strip()) for i in range(pages))
        return chars / max(1, pages) >= 80
    finally:
        doc.close()
