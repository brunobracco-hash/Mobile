"""pdf2kindle — converte PDF em Word diagramado para leitura no Kindle."""

from .converter import Options, Result, convert  # noqa: F401

__version__ = "1.0.0"
__all__ = ["convert", "Options", "Result", "__version__"]
