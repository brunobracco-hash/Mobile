import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests.make_sample import build  # noqa: E402


@pytest.fixture(scope="session")
def sample_pdf(tmp_path_factory):
    path = tmp_path_factory.mktemp("pdf") / "amostra.pdf"
    return build(str(path))


@pytest.fixture(scope="session")
def extraction(sample_pdf):
    from pdf2kindle.extract import extract

    return extract(sample_pdf)


@pytest.fixture(scope="session")
def document(extraction):
    from pdf2kindle.structure import build_document

    return build_document(extraction, fallback_title="amostra")


@pytest.fixture(scope="session")
def converted(sample_pdf, tmp_path_factory):
    from pdf2kindle.converter import convert

    out = tmp_path_factory.mktemp("docx") / "amostra.docx"
    return convert(sample_pdf, str(out))
