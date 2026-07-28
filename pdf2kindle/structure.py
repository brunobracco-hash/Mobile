"""Da geometria do PDF para a semântica do livro.

Aqui decidimos o que é título, parágrafo, item de lista, nota de rodapé e o que
é lixo (sumário do PDF original, marcas de página). O resultado é um Document
totalmente refluível — sem nenhuma coordenada — que o Kindle consegue paginar.
"""

from __future__ import annotations

import collections
import re
import statistics
import unicodedata
from typing import Dict, List, Optional, Sequence, Tuple

from .extract import ExtractionResult
from .model import Block, Document, Element, Line, Run, Span

LIGATURES = {
    "ﬀ": "ff", "ﬁ": "fi", "ﬂ": "fl", "ﬃ": "ffi",
    "ﬄ": "ffl", "ﬅ": "st", "ﬆ": "st",
}

BULLET_RE = re.compile(r"^\s*([•·▪◦‣∙*–—\-])\s+(?=\S)")
ENUM_RE = re.compile(r"^\s*(\(?\d{1,3}[.)]|\(?[a-z][.)]|\(?[ivxlcdm]{1,5}[.)])\s+(?=\S)", re.I)
CHAPTER_RE = re.compile(
    r"^\s*(cap[íi]tulo|chapter|parte|part|se[çc][ãa]o|section|livro|book|ato|apêndice|ap[êe]ndice|anexo|ep[íi]logo|pr[óo]logo|introdu[çc][ãa]o|conclus[ãa]o|pref[áa]cio)\b",
    re.I,
)
# "Capítulo 3 . . . . . . . 41" — os pontos podem vir espaçados e o número de
# página costuma vir em outro bloco, então não exigimos que ele esteja na linha.
TOC_LEADER_RE = re.compile(r"(?:[.·]\s?){4,}")
TOC_TAIL_RE = re.compile(r"\s{2,}\d{1,4}\s*$")
# O OCR destrói o pontilhado ("cio Seiwa 3"), mas o número de página no fim de
# uma linha curta sobrevive. Só conta como indício junto com algum pontilhado.
TOC_SHORT_TAIL_RE = re.compile(r"\s\d{1,3}\s*$")
NOTE_MARKER_RE = re.compile(r"^\s*(\[?\d{1,3}\]?[.)]?|\*{1,3})\s+\S")
# PDFs com fontes exóticas devolvem caracteres de controle e substitutos soltos.
_CONTROL_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\ud800-\udfff￾￿]")
SENTENCE_END_RE = re.compile(r"[.!?…:;»”\"')\]]$")
# Fim de parágrafo de verdade. Dois-pontos e ponto-e-vírgula não entram: eles
# terminam uma oração, não o parágrafo, e o OCR corta linhas justamente aí.
PARAGRAPH_END_RE = re.compile(r"[.!?…][\"'»”’)\]]?$")
_WS_RE = re.compile(r"[ \t ]+")


def sanitize(text: str) -> str:
    """Remove o que o XML do .docx recusa: controles e substitutos soltos.

    Sem isso, um único caractere estranho vindo de uma fonte mal embutida
    derruba a geração do arquivo inteiro.
    """
    return _CONTROL_RE.sub("", text or "")


def _fold(text: str) -> str:
    """Reduz o texto ao esqueleto comparável: sem acentos, pontuação nem caixa.

    O OCR erra acentos com frequência ("CAPITULO" por "CAPÍTULO"), então
    comparar título corrente com título do corpo exige ignorá-los.
    """
    decomposed = unicodedata.normalize("NFKD", text)
    without_marks = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\W+", "", without_marks).lower()


def _clean(text: str) -> str:
    text = sanitize(text)
    for lig, repl in LIGATURES.items():
        text = text.replace(lig, repl)
    text = text.replace("­", "")          # hífen opcional
    text = text.replace("’", "'").replace("﻿", "")
    text = unicodedata.normalize("NFC", text)
    return _WS_RE.sub(" ", text)


def _weighted_mode_size(lines: Sequence[Line]) -> float:
    """Tamanho de fonte do corpo do texto: a moda ponderada por caracteres."""
    counter: Dict[float, int] = collections.Counter()
    for line in lines:
        for span in line.spans:
            n = len(span.text.strip())
            if n:
                counter[round(span.size * 2) / 2] += n
    if not counter:
        return 10.0
    return max(counter.items(), key=lambda kv: kv[1])[0]


def _is_all_caps(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if len(letters) < 3:
        return False
    return sum(1 for c in letters if c.isupper()) / len(letters) > 0.85


def _runs_from_lines(lines: Sequence[Line]) -> List[Run]:
    """Concatena linhas em runs, resolvendo hifenização de fim de linha."""
    runs: List[Run] = []
    for idx, line in enumerate(lines):
        for span in line.spans:
            text = _clean(span.text)
            if not text:
                continue
            if runs and runs[-1].bold == span.bold and runs[-1].italic == span.italic:
                runs[-1].text += text
            else:
                runs.append(Run(text=text, bold=span.bold, italic=span.italic))
        if idx < len(lines) - 1 and runs:
            tail = runs[-1].text.rstrip()
            next_text = lines[idx + 1].text.lstrip()
            if tail.endswith(("-", "‐")) and next_text[:1].islower():
                runs[-1].text = tail[:-1]      # palavra quebrada: junta sem o hífen
            else:
                runs[-1].text = tail + " "
    if runs:
        runs[-1].text = runs[-1].text.rstrip()
    return [r for r in runs if r.text]


def _split_block_into_paragraphs(block: Block, body_size: float) -> List[List[Line]]:
    """Quebra as linhas de um bloco nos limites reais de parágrafo."""
    lines = block.lines
    if len(lines) <= 1:
        return [lines] if lines else []

    gaps = [max(0.0, lines[i].top - lines[i - 1].bottom) for i in range(1, len(lines))]
    median_gap = statistics.median(gaps) if gaps else 0.0
    left_edge = min(l.x0 for l in lines)
    right_edge = max(l.x1 for l in lines)
    width = max(1.0, right_edge - left_edge)

    groups: List[List[Line]] = [[lines[0]]]
    for i in range(1, len(lines)):
        prev, cur = lines[i - 1], lines[i]
        gap = gaps[i - 1]
        size = max(cur.size, body_size)

        # 1) espaço vertical maior que o entrelinhas normal
        break_here = gap > max(median_gap * 1.6, median_gap + size * 0.45)
        # 2) linha anterior curta (fim de parágrafo) e a atual recomeça à esquerda
        if not break_here and prev.x1 < right_edge - width * 0.12 and cur.x0 <= left_edge + width * 0.06:
            break_here = True
        # 3) recuo de primeira linha
        if not break_here and cur.x0 > left_edge + width * 0.025 and prev.x1 > right_edge - width * 0.08:
            break_here = True
        # 4) mudança de estilo (título colado no corpo dentro do mesmo bloco)
        if not break_here and (abs(cur.size - prev.size) > 1.0 or cur.bold != prev.bold):
            break_here = True

        if break_here:
            groups.append([cur])
        else:
            groups[-1].append(cur)
    return groups


class _Para:
    """Candidato a elemento, ainda com as métricas geométricas."""

    def __init__(self, lines: List[Line], block: Block, page_width: float, page_height: float):
        self.lines = lines
        self.block = block
        self.page = block.page
        self.page_width = page_width
        self.page_height = page_height
        self.text = _clean(" ".join(l.text for l in lines)).strip()
        self.size = max((l.size for l in lines), default=0.0)
        self.bold = all(l.bold for l in lines) if lines else False
        self.x0 = min((l.x0 for l in lines), default=0.0)
        self.x1 = max((l.x1 for l in lines), default=0.0)
        self.top = min((l.top for l in lines), default=0.0)
        self.bottom = max((l.bottom for l in lines), default=0.0)

    @property
    def centered(self) -> bool:
        center = (self.x0 + self.x1) / 2
        page_center = self.page_width / 2
        return abs(center - page_center) < self.page_width * 0.06 and (self.x1 - self.x0) < self.page_width * 0.75


def _heading_level_map(paras: Sequence["_Para"]) -> Dict[float, int]:
    """Converte tamanhos de fonte de título em níveis 1..3.

    Quando existem capítulos explícitos ("Capítulo 4", "Parte II"), o corpo
    deles define o nível 1: tudo que for maior é rosto/abertura e também vira
    nível 1, e os tamanhos menores descem para 2 e 3. Sem essa âncora, basta
    ordenar os tamanhos do maior para o menor.
    """
    counts: Dict[float, int] = collections.Counter(round(p.size * 2) / 2 for p in paras)
    sizes = sorted(counts, reverse=True)
    if not sizes:
        return {}
    total = sum(counts.values())

    # Tamanhos que aparecem uma vez só (o título da capa, um selo de edição) não
    # devem consumir um nível da hierarquia: valem os que se repetem.
    significant = [s for s in sizes if counts[s] >= max(2, total * 0.02)] or sizes

    chapter_sizes = [round(p.size * 2) / 2 for p in paras if CHAPTER_RE.match(p.text)]
    if chapter_sizes:
        base = max(chapter_sizes)
        anchors = [base] + [s for s in significant if s < base][:2]
    else:
        anchors = significant[:3]

    return {size: min(3, 1 + sum(1 for a in anchors if a > size)) for size in sizes}


def _looks_like_heading(p: _Para, body_size: float) -> bool:
    text = p.text
    if not text or len(text) > 200 or len(p.lines) > 4:
        return False
    if text.endswith((",", ";")):
        return False
    ratio = p.size / body_size if body_size else 1.0
    big = ratio >= 1.12
    bold_short = p.bold and ratio >= 0.97 and len(text) <= 120
    caps_short = _is_all_caps(text) and len(text) <= 90 and len(p.lines) <= 2
    numbered = bool(CHAPTER_RE.match(text)) or bool(re.match(r"^\s*\d{1,2}(\.\d{1,2}){0,2}\s+\S", text))
    # Linha longa que ocupa a largura da mancha é corpo de texto, por maior que
    # o OCR tenha estimado a letra — ele erra o corpo linha a linha.
    if len(text) > 70 and (p.x1 - p.x0) > p.page_width * 0.62:
        return False
    if not (big or bold_short or caps_short or (numbered and (p.bold or ratio >= 1.05))):
        return False
    # Frase que só começa em negrito não é título.
    if SENTENCE_END_RE.search(text) and ratio < 1.2 and not numbered and len(text) > 60:
        return False
    return True


def _is_note(p: _Para, body_size: float) -> bool:
    """Nota de rodapé: fonte menor, no pé da página, começando por marcador."""
    if p.size >= body_size * 0.92:
        return False
    if p.top < p.page_height * 0.55:
        return False
    return bool(NOTE_MARKER_RE.match(p.text)) or p.size < body_size * 0.8


def _list_info(text: str) -> Optional[Tuple[str, str]]:
    m = BULLET_RE.match(text)
    if m:
        return m.group(1), text[m.end():]
    m = ENUM_RE.match(text)
    if m:
        return m.group(1), text[m.end():]
    return None


def _drop_source_toc(paras: List[_Para]) -> Tuple[List[_Para], int]:
    """Descarta as páginas de sumário/índice do PDF original.

    Elas só listam números de página, que não existem em um e-book — e o
    sumário navegável do arquivo final é gerado a partir dos títulos. Uma página
    é considerada sumário quando tem três ou mais linhas com pontilhado ou
    terminadas em número de página.
    """
    def _entry(text: str) -> bool:
        if TOC_LEADER_RE.search(text) or TOC_TAIL_RE.search(text):
            return True
        return len(text) < 70 and bool(TOC_SHORT_TAIL_RE.search(text))

    leaders: Dict[int, int] = collections.Counter()
    entries: Dict[int, int] = collections.Counter()
    for p in paras:
        if TOC_LEADER_RE.search(p.text):
            leaders[p.page] += 1
        if _entry(p.text):
            entries[p.page] += 1

    # Exigir pelo menos um pontilhado evita confundir prosa que por acaso
    # termine em número com uma página de sumário.
    toc_pages = {page for page, count in entries.items() if count >= 3 and leaders[page] >= 1}
    if not toc_pages:
        return paras, 0

    kept: List[_Para] = []
    for p in paras:
        if p.page in toc_pages:
            text = p.text.strip()
            is_entry = _entry(text)
            # Números de página soltos e fragmentos curtos são o resto do sumário.
            if is_entry or len(text) < 80:
                continue
        kept.append(p)
    return kept, len(toc_pages)


def _drop_running_titles(paras: List["_Para"]) -> Tuple[List["_Para"], int]:
    """Remove o título corrente que muda a cada seção.

    O filtro de extração só apanha cabeçalhos idênticos em todas as páginas.
    Livros técnicos repetem no alto de cada página o nome da seção atual, que
    muda ao longo do livro — mas sempre coincide com um título que existe no
    corpo. Repetição + posição na margem é o que identifica esses casos.
    """
    counts: Dict[str, int] = collections.Counter(_fold(p.text) for p in paras)
    kept: List["_Para"] = []
    dropped = 0
    for p in paras:
        in_margin = p.top < p.page_height * 0.09 or p.bottom > p.page_height * 0.93
        if in_margin and len(p.lines) <= 2 and counts[_fold(p.text)] > 1:
            dropped += 1
            continue
        kept.append(p)
    return kept, dropped


def _merge_split_headings(paras: List["_Para"], body_size: float) -> List["_Para"]:
    """Junta o título que o PDF quebrou em duas linhas independentes.

    "Capítulo 2 - As colunas" virar dois títulos rende duas entradas no sumário
    do Kindle para o mesmo capítulo. Só juntamos o que a geometria confirma:
    mesma página, mesmo corpo de letra, linhas coladas e sobrepostas na
    horizontal, com a primeira sem terminar frase.
    """
    merged: List["_Para"] = []
    for p in paras:
        if merged:
            prev = merged[-1]
            # Empilhados: título que ocupa duas linhas.
            gap = p.top - prev.bottom
            empilhados = 0 <= gap <= p.size * 1.2 and min(prev.x1, p.x1) > max(prev.x0, p.x0)
            # Lado a lado: o OCR partiu a mesma linha em dois pedaços.
            altura = min(prev.bottom - prev.top, p.bottom - p.top)
            mesma_linha = (min(prev.bottom, p.bottom) - max(prev.top, p.top)) > altura * 0.5
            ao_lado = mesma_linha and 0 <= (p.x0 - prev.x1) < p.size * 3
            if (
                prev.page == p.page
                and prev.block.column == p.block.column
                # Tolerância relativa: o OCR estima o corpo da letra a partir do
                # bitmap e varia de um pedaço para outro da mesma linha.
                and abs(prev.size - p.size) <= max(prev.size, p.size) * 0.15
                and (empilhados or ao_lado)
                and not PARAGRAPH_END_RE.search(prev.text)
                and _looks_like_heading(prev, body_size)
                and _looks_like_heading(p, body_size)
            ):
                merged[-1] = _Para(prev.lines + p.lines, prev.block, prev.page_width, prev.page_height)
                continue
        merged.append(p)
    return merged


def _merge_continuations(elements: List[Element]) -> List[Element]:
    """Recompõe parágrafos partidos por quebra de página, de coluna ou pelo OCR.

    Em PDF digitalizado o reconhecimento devolve cada linha — às vezes cada
    pedaço de linha — como um bloco solto. O critério é o mesmo que vale para a
    quebra de página: se o trecho anterior não terminou a frase e o seguinte
    começa em minúscula, é o mesmo parágrafo.
    """
    merged: List[Element] = []
    for el in elements:
        if (
            merged
            and el.kind == "paragraph"
            and merged[-1].kind == "paragraph"
            and merged[-1].runs
            and el.runs
        ):
            prev_text = merged[-1].text.rstrip()
            next_text = el.text.lstrip()
            continues = (
                prev_text
                and next_text
                and not PARAGRAPH_END_RE.search(prev_text)
                and not next_text[:1].isupper()
                and not next_text[:1].isdigit()
            )
            if prev_text.endswith("-") and next_text[:1].islower():
                continues = True
            if continues:
                if prev_text.endswith("-"):
                    merged[-1].runs[-1].text = merged[-1].runs[-1].text.rstrip()[:-1]
                else:
                    merged[-1].runs[-1].text = merged[-1].runs[-1].text.rstrip() + " "
                merged[-1].runs.extend(el.runs)
                continue
        merged.append(el)
    return merged


def _guess_title(doc: Document, meta: Dict[str, str], fallback: str) -> str:
    title = sanitize(meta.get("title") or "").strip()
    if title and len(title) > 3 and not title.lower().endswith(".pdf"):
        return title
    for el in doc.elements[:12]:
        if el.kind == "heading" and 3 < len(el.text) < 120:
            return el.text
    for el in doc.elements[:6]:
        if el.kind == "paragraph" and 3 < len(el.text) < 120:
            return el.text
    return fallback


def _guess_author(doc: Document, meta: Dict[str, str]) -> str:
    author = sanitize(meta.get("author") or "").strip()
    if author:
        return author
    # Em uma folha de rosto, a linha logo abaixo do título costuma ser o autor.
    front = [el for el in doc.elements[:6] if el.page == 0]
    if len(front) < 2 or len(front) > 4:
        return ""
    for el in front[1:]:
        text = el.text.strip()
        if 3 < len(text) <= 60 and not text.endswith((".", "!", "?")) and text != doc.title:
            return text
    return ""


def build_document(
    extraction: ExtractionResult,
    fallback_title: str = "Documento",
    footnotes: str = "end",
    keep_images: bool = True,
) -> Document:
    """Transforma os blocos extraídos em um documento semântico."""
    doc = Document()
    doc.warnings.extend(extraction.warnings)

    all_lines = [line for b in extraction.blocks if b.kind == "text" for line in b.lines]
    body_size = _weighted_mode_size(all_lines)

    paras: List[_Para] = []
    image_blocks: List[Tuple[int, Block]] = []
    for block in extraction.blocks:
        width, height = extraction.page_sizes[block.page] if block.page < len(extraction.page_sizes) else (595, 842)
        if block.kind == "image":
            image_blocks.append((len(paras), block))
            continue
        for group in _split_block_into_paragraphs(block, body_size):
            if not group:
                continue
            p = _Para(group, block, width, height)
            if p.text:
                paras.append(p)

    paras, toc_pages_dropped = _drop_source_toc(paras)
    # A remontagem vem antes da comparação: o OCR parte o título corrente em
    # pedaços ("CAPÍTULO 2" + "- AS COLUNAS") que só coincidem com o título do
    # corpo depois de reunidos.
    paras = _merge_split_headings(paras, body_size)
    paras, running_titles_dropped = _drop_running_titles(paras)

    heading_paras = [p for p in paras if _looks_like_heading(p, body_size)]
    heading_ids = {id(p) for p in heading_paras}
    level_map = _heading_level_map(heading_paras)

    elements: List[Element] = []
    notes: List[Element] = []
    image_by_index: Dict[int, List[Block]] = collections.defaultdict(list)
    for index, block in image_blocks:
        image_by_index[index].append(block)

    for i, p in enumerate(paras):
        for block in image_by_index.get(i, []):
            if keep_images and block.image:
                elements.append(
                    Element(
                        kind="image",
                        image=block.image,
                        image_ext=block.image_ext,
                        image_size=(block.bbox[2] - block.bbox[0], block.bbox[3] - block.bbox[1]),
                        page=block.page,
                    )
                )

        if _is_note(p, body_size):
            note = Element(kind="note", runs=_runs_from_lines(p.lines), page=p.page)
            if footnotes == "drop":
                continue
            if footnotes == "end":
                notes.append(note)
                continue
            elements.append(note)
            continue

        if id(p) in heading_ids:
            level = level_map.get(round(p.size * 2) / 2, 2)
            if CHAPTER_RE.match(p.text):
                level = 1
            elements.append(Element(kind="heading", runs=_runs_from_lines(p.lines), level=level, page=p.page))
            continue

        info = _list_info(p.text)
        if info and len(p.text) < 1200:
            marker, _rest = info
            runs = _runs_from_lines(p.lines)
            if runs:  # remove o marcador: o Word desenha o próprio
                stripped = runs[0].text
                m = BULLET_RE.match(stripped) or ENUM_RE.match(stripped)
                if m:
                    runs[0].text = stripped[m.end():]
            ordered = bool(ENUM_RE.match(p.text))
            elements.append(
                Element(kind="list_item", runs=runs, level=1 if ordered else 0, marker=marker, page=p.page)
            )
            continue

        elements.append(Element(kind="paragraph", runs=_runs_from_lines(p.lines), page=p.page))

    # Imagens que vieram depois do último parágrafo.
    for index, block in image_blocks:
        if index >= len(paras) and keep_images and block.image:
            elements.append(
                Element(
                    kind="image",
                    image=block.image,
                    image_ext=block.image_ext,
                    image_size=(block.bbox[2] - block.bbox[0], block.bbox[3] - block.bbox[1]),
                    page=block.page,
                )
            )

    elements = _merge_continuations(elements)
    # Restos de figura ("x", "y", rótulos de eixo) não são parágrafos.
    elements = [
        el
        for el in elements
        if el.kind == "image" or (len(el.text.strip()) > 2 and el.text.strip())
    ]

    # Uma "nota" de um caractere é ruído de OCR, não nota de rodapé.
    notes = [note for note in notes if len(note.text.strip()) > 2]

    doc.elements = elements
    doc.notes = notes
    doc.title = _guess_title(doc, extraction.metadata, fallback_title)
    doc.author = _guess_author(doc, extraction.metadata)
    doc.stats = {
        "pages": extraction.page_count,
        "elements": len(elements),
        "headings": sum(1 for e in elements if e.kind == "heading"),
        "paragraphs": sum(1 for e in elements if e.kind == "paragraph"),
        "images": sum(1 for e in elements if e.kind == "image"),
        "notes": len(notes) + sum(1 for e in elements if e.kind == "note"),
        "body_font_size": body_size,
    }
    if running_titles_dropped:
        doc.stats["running_titles_dropped"] = running_titles_dropped
    if toc_pages_dropped:
        doc.stats["toc_pages_dropped"] = toc_pages_dropped
        doc.warnings.append(
            f"{toc_pages_dropped} página(s) de sumário/índice do PDF foram descartadas — "
            "o sumário do e-book é gerado a partir dos títulos e fica navegável."
        )
    if doc.stats["headings"] == 0 and extraction.page_count > 5:
        doc.warnings.append(
            "Nenhum título foi detectado — o Kindle vai abrir o arquivo sem sumário navegável. "
            "Se o PDF usa uma fonte única para tudo, revise os títulos no Word antes de enviar."
        )
    return doc
