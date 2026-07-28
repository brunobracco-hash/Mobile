"""Ponto de entrada do executável de linha de comando.

Serve para quem prefere terminal e, principalmente, para a verificação
automática: é com ele que o build no Windows converte um PDF de verdade e
prova que o empacotamento não quebrou o PyMuPDF nem o python-docx.
"""

from pdf2kindle.cli import main

raise SystemExit(main())
