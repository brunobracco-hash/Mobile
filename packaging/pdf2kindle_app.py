"""Ponto de entrada do executável de janela (o .exe do Windows).

O PyInstaller precisa de um script, não de um módulo: por isso este arquivo
existe em vez de apontar direto para pdf2kindle/gui.py, que usa importações
relativas e não roda como script solto.
"""

from pdf2kindle.gui import main

raise SystemExit(main())
