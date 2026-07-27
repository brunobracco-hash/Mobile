"""Modelo intermediário: o que sai da extração e o que entra no escritor DOCX."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

BBox = Tuple[float, float, float, float]


@dataclass
class Span:
    """Trecho de texto com um único estilo tipográfico."""

    text: str
    size: float
    font: str
    bold: bool
    italic: bool
    bbox: BBox


@dataclass
class Line:
    spans: List[Span]
    bbox: BBox
    page: int

    @property
    def text(self) -> str:
        return "".join(s.text for s in self.spans).strip()

    @property
    def size(self) -> float:
        """Tamanho dominante da linha (ponderado por número de caracteres)."""
        if not self.spans:
            return 0.0
        total = sum(len(s.text) for s in self.spans) or 1
        return sum(s.size * len(s.text) for s in self.spans) / total

    @property
    def bold(self) -> bool:
        chars = sum(len(s.text.strip()) for s in self.spans)
        if not chars:
            return False
        bold_chars = sum(len(s.text.strip()) for s in self.spans if s.bold)
        return bold_chars / chars > 0.6

    @property
    def x0(self) -> float:
        return self.bbox[0]

    @property
    def x1(self) -> float:
        return self.bbox[2]

    @property
    def top(self) -> float:
        return self.bbox[1]

    @property
    def bottom(self) -> float:
        return self.bbox[3]


@dataclass
class Block:
    """Bloco de página vindo do PDF: texto ou imagem."""

    kind: str  # 'text' | 'image'
    bbox: BBox
    page: int
    lines: List[Line] = field(default_factory=list)
    image: Optional[bytes] = None
    image_ext: str = "png"
    column: int = 0


@dataclass
class Run:
    """Trecho estilizado dentro de um parágrafo do documento final."""

    text: str
    bold: bool = False
    italic: bool = False


@dataclass
class Element:
    """Unidade semântica do documento final."""

    kind: str  # heading | paragraph | list_item | image | note | pagebreak
    runs: List[Run] = field(default_factory=list)
    level: int = 0            # nível do título (1-3) ou da lista
    marker: str = ""          # marcador original do item de lista
    image: Optional[bytes] = None
    image_ext: str = "png"
    image_size: Tuple[float, float] = (0.0, 0.0)  # em pontos, como no PDF
    page: int = 0

    @property
    def text(self) -> str:
        return "".join(r.text for r in self.runs)


@dataclass
class Document:
    title: str = ""
    author: str = ""
    language: str = ""
    elements: List[Element] = field(default_factory=list)
    notes: List[Element] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)
