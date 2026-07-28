"""Aplicativo de janela — o mesmo conversor, sem linha de comando.

Feito com tkinter de propósito: faz parte da biblioteca padrão, então o
executável do Windows não depende de nada além do que já é preciso para
converter, e abre com duplo clique.

A conversão roda em uma thread separada e conversa com a janela apenas pela
fila de eventos do tkinter (`after`), porque widgets não podem ser tocados de
fora da thread principal.
"""

from __future__ import annotations

import os
import queue
import subprocess
import sys
import threading
import traceback
from typing import List, Optional

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from .converter import Options, convert, ocr_disponivel

TITULO = "PDF → Word para Kindle"
NOTAS = {"reunir no fim": "end", "manter onde estão": "inline", "descartar": "drop"}
OCR = {"detectar sozinho": "auto", "sempre reconhecer": "force", "nunca reconhecer": "off"}


def _melhora_nitidez_no_windows() -> None:
    """Sem isto o app fica borrado em tela de alta resolução."""
    if sys.platform != "win32":
        return
    try:
        import ctypes

        ctypes.windll.shcore.SetProcessDpiAwareness(1)  # type: ignore[attr-defined]
    except Exception:
        pass


def _caminho_do_icone() -> Optional[str]:
    """Dentro do executável os dados ficam na pasta temporária do PyInstaller."""
    base = getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    caminho = os.path.join(base, "assets", "pdf2kindle.ico")
    return caminho if os.path.exists(caminho) else None


def _usa_icone(raiz: tk.Tk) -> None:
    """Ícone da janela e da barra de tarefas. Só o Windows aceita .ico aqui,
    e o app não pode deixar de abrir por causa disso."""
    caminho = _caminho_do_icone()
    if not caminho:
        return
    try:
        raiz.iconbitmap(caminho)
    except tk.TclError:
        pass


def abrir_pasta(caminho: str) -> None:
    """Abre o explorador de arquivos na pasta do resultado."""
    pasta = os.path.dirname(os.path.abspath(caminho))
    try:
        if sys.platform == "win32":
            os.startfile(pasta)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", pasta])
        else:
            subprocess.Popen(["xdg-open", pasta])
    except Exception:
        messagebox.showinfo(TITULO, f"O arquivo está em:\n{pasta}")


class Aplicativo(ttk.Frame):
    def __init__(self, master: tk.Tk, arquivos_iniciais: Optional[List[str]] = None) -> None:
        super().__init__(master, padding=12)
        self.master.title(TITULO)
        self.master.minsize(620, 640)
        self.grid(sticky="nsew")
        master.columnconfigure(0, weight=1)
        master.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)

        self.arquivos: List[str] = []
        self.eventos: "queue.Queue[tuple]" = queue.Queue()
        self.ultimo_resultado: Optional[str] = None
        self.convertendo = False
        self.concluidos = 0

        self._monta_arquivos()
        self._monta_ajustes()
        self._monta_acoes()
        self._monta_relatorio()

        if arquivos_iniciais:
            self._adiciona(arquivos_iniciais)
        self.after(100, self._processa_eventos)

    # ------------------------------------------------------------------ layout
    def _monta_arquivos(self) -> None:
        caixa = ttk.LabelFrame(self, text="Arquivos PDF", padding=10)
        caixa.grid(row=0, column=0, sticky="ew")
        caixa.columnconfigure(0, weight=1)

        self.lista = tk.Listbox(caixa, height=4, activestyle="none")
        self.lista.grid(row=0, column=0, sticky="ew", pady=(0, 8))
        barra = ttk.Scrollbar(caixa, orient="vertical", command=self.lista.yview)
        barra.grid(row=0, column=1, sticky="ns", pady=(0, 8))
        self.lista.configure(yscrollcommand=barra.set)

        botoes = ttk.Frame(caixa)
        botoes.grid(row=1, column=0, columnspan=2, sticky="w")
        ttk.Button(botoes, text="Escolher PDF...", command=self._escolher).grid(row=0, column=0)
        ttk.Button(botoes, text="Remover", command=self._remover).grid(row=0, column=1, padx=6)
        ttk.Button(botoes, text="Limpar", command=self._limpar).grid(row=0, column=2)

    def _monta_ajustes(self) -> None:
        caixa = ttk.LabelFrame(self, text="Ajustes", padding=10)
        caixa.grid(row=1, column=0, sticky="ew", pady=10)
        caixa.columnconfigure(1, weight=1)
        caixa.columnconfigure(3, weight=1)

        self.titulo = tk.StringVar()
        self.autor = tk.StringVar()
        self.notas = tk.StringVar(value="reunir no fim")
        self.ocr = tk.StringVar(value="detectar sozinho")
        self.imagens = tk.BooleanVar(value=True)
        self.sumario = tk.BooleanVar(value=True)
        self.rosto = tk.BooleanVar(value=True)
        self.quebra = tk.BooleanVar(value=True)
        self.justificado = tk.BooleanVar(value=True)

        ttk.Label(caixa, text="Título").grid(row=0, column=0, sticky="w", pady=3)
        ttk.Entry(caixa, textvariable=self.titulo).grid(row=0, column=1, columnspan=3, sticky="ew", padx=(6, 0))
        ttk.Label(caixa, text="Autor").grid(row=1, column=0, sticky="w", pady=3)
        ttk.Entry(caixa, textvariable=self.autor).grid(row=1, column=1, columnspan=3, sticky="ew", padx=(6, 0))
        ttk.Label(caixa, text="(em branco = usa os metadados do PDF)", foreground="#666").grid(
            row=2, column=1, columnspan=3, sticky="w", padx=(6, 0)
        )

        ttk.Label(caixa, text="Notas de rodapé").grid(row=3, column=0, sticky="w", pady=(10, 3))
        ttk.Combobox(caixa, textvariable=self.notas, values=list(NOTAS), state="readonly", width=18).grid(
            row=3, column=1, sticky="w", padx=(6, 0), pady=(10, 3)
        )
        ttk.Label(caixa, text="Livro escaneado").grid(row=3, column=2, sticky="e", pady=(10, 3))
        ttk.Combobox(caixa, textvariable=self.ocr, values=list(OCR), state="readonly", width=18).grid(
            row=3, column=3, sticky="w", padx=(6, 0), pady=(10, 3)
        )

        marcas = ttk.Frame(caixa)
        marcas.grid(row=4, column=0, columnspan=4, sticky="w", pady=(10, 0))
        for coluna, (texto, variavel) in enumerate(
            [
                ("Sumário navegável", self.sumario),
                ("Página de rosto", self.rosto),
                ("Capítulo em página nova", self.quebra),
            ]
        ):
            ttk.Checkbutton(marcas, text=texto, variable=variavel).grid(row=0, column=coluna, sticky="w", padx=(0, 12))
        for coluna, (texto, variavel) in enumerate(
            [("Manter imagens", self.imagens), ("Texto justificado", self.justificado)]
        ):
            ttk.Checkbutton(marcas, text=texto, variable=variavel).grid(row=1, column=coluna, sticky="w", padx=(0, 12))

    def _monta_acoes(self) -> None:
        linha = ttk.Frame(self)
        linha.grid(row=2, column=0, sticky="ew")
        linha.columnconfigure(1, weight=1)

        self.botao = ttk.Button(linha, text="Converter", command=self._converter)
        self.botao.grid(row=0, column=0)
        self.progresso = ttk.Progressbar(linha, mode="determinate")
        self.progresso.grid(row=0, column=1, sticky="ew", padx=10)
        self.botao_pasta = ttk.Button(linha, text="Abrir pasta", command=self._abrir_pasta, state="disabled")
        self.botao_pasta.grid(row=0, column=2)

        self.andamento = ttk.Label(self, text="", foreground="#666")
        self.andamento.grid(row=4, column=0, sticky="w", pady=(6, 0))

    def _monta_relatorio(self) -> None:
        caixa = ttk.LabelFrame(self, text="Relatório", padding=6)
        caixa.grid(row=3, column=0, sticky="nsew", pady=(10, 0))
        self.rowconfigure(3, weight=1)
        caixa.columnconfigure(0, weight=1)
        caixa.rowconfigure(0, weight=1)

        self.texto = tk.Text(caixa, height=9, wrap="word", state="disabled", relief="flat")
        self.texto.grid(row=0, column=0, sticky="nsew")
        barra = ttk.Scrollbar(caixa, orient="vertical", command=self.texto.yview)
        barra.grid(row=0, column=1, sticky="ns")
        self.texto.configure(yscrollcommand=barra.set)
        self._escreve(
            "Escolha um ou mais PDFs e clique em Converter.\n"
            "O .docx é salvo na mesma pasta do PDF, pronto para enviar ao Kindle.\n"
        )
        if not ocr_disponivel():
            self._escreve(
                "\nOs dados de idioma do OCR não foram encontrados: livro escaneado\n"
                "sairá sem texto. (No executável eles vêm embutidos.)\n"
            )

    # ----------------------------------------------------------------- ações
    def _escolher(self) -> None:
        escolhidos = filedialog.askopenfilenames(
            title="Escolha os PDFs", filetypes=[("Arquivos PDF", "*.pdf"), ("Todos os arquivos", "*.*")]
        )
        self._adiciona(list(escolhidos))

    def _adiciona(self, caminhos: List[str]) -> None:
        for caminho in caminhos:
            if caminho and caminho.lower().endswith(".pdf") and caminho not in self.arquivos:
                self.arquivos.append(caminho)
                self.lista.insert("end", os.path.basename(caminho))

    def _remover(self) -> None:
        for indice in reversed(self.lista.curselection()):
            self.lista.delete(indice)
            del self.arquivos[indice]

    def _limpar(self) -> None:
        self.lista.delete(0, "end")
        self.arquivos.clear()

    def _abrir_pasta(self) -> None:
        if self.ultimo_resultado:
            abrir_pasta(self.ultimo_resultado)

    def _escreve(self, texto: str) -> None:
        self.texto.configure(state="normal")
        self.texto.insert("end", texto)
        self.texto.see("end")
        self.texto.configure(state="disabled")

    def _opcoes(self) -> Options:
        um_arquivo = len(self.arquivos) == 1
        return Options(
            title=(self.titulo.get().strip() or None) if um_arquivo else None,
            author=self.autor.get().strip() or None,
            footnotes=NOTAS[self.notas.get()],
            ocr=OCR[self.ocr.get()],
            keep_images=self.imagens.get(),
            toc=self.sumario.get(),
            title_page=self.rosto.get(),
            page_break_chapters=self.quebra.get(),
            justify=self.justificado.get(),
        )

    def _converter(self) -> None:
        if self.convertendo:
            return
        if not self.arquivos:
            messagebox.showwarning(TITULO, "Escolha pelo menos um arquivo PDF.")
            return

        self.convertendo = True
        self.botao.configure(state="disabled", text="Convertendo...")
        self.botao_pasta.configure(state="disabled")
        self.concluidos = 0
        self.progresso.configure(maximum=len(self.arquivos), value=0)
        self._escreve("\n")

        threading.Thread(target=self._trabalha, args=(list(self.arquivos), self._opcoes()), daemon=True).start()

    def _trabalha(self, arquivos: List[str], opcoes: Options) -> None:
        """Roda fora da thread da interface: só publica eventos na fila."""
        for caminho in arquivos:
            saida = os.path.splitext(caminho)[0] + ".docx"
            nome = os.path.basename(caminho)

            def anuncia(pagina: int, total: int, _nome=nome) -> None:
                self.eventos.put(("pagina", _nome, pagina, total))

            try:
                resultado = convert(caminho, saida, opcoes, on_page=anuncia)
            except Exception as erro:  # noqa: BLE001 - a janela não pode morrer
                self.eventos.put(("erro", os.path.basename(caminho), f"{erro}", traceback.format_exc()))
                continue
            self.eventos.put(("ok", saida, resultado))
        self.eventos.put(("fim",))

    def _avanca(self) -> None:
        self.concluidos += 1
        self.progresso.configure(value=self.concluidos)

    def _processa_eventos(self) -> None:
        try:
            while True:
                evento = self.eventos.get_nowait()
                if evento[0] == "pagina":
                    _, nome, pagina, total = evento
                    self.andamento.configure(text=f"{nome}: lendo página {pagina} de {total}")
                elif evento[0] == "ok":
                    _, saida, resultado = evento
                    s = resultado.document.stats
                    self._escreve(f"{os.path.basename(saida)}\n")
                    self._escreve(
                        f"   {s['pages']} páginas · {s['headings']} títulos · "
                        f"{s['paragraphs']} parágrafos · {s['images']} imagens · {s['notes']} notas\n"
                    )
                    if resultado.ocr_applied:
                        self._escreve("   texto reconhecido por OCR\n")
                    for aviso in resultado.warnings:
                        self._escreve(f"   aviso: {aviso}\n")
                    self.ultimo_resultado = saida
                    self._avanca()
                elif evento[0] == "erro":
                    _, nome, mensagem, _detalhe = evento
                    self._escreve(f"{nome}: não consegui converter — {mensagem}\n")
                    self._avanca()
                elif evento[0] == "fim":
                    self.andamento.configure(text="")
                    self.convertendo = False
                    self.botao.configure(state="normal", text="Converter")
                    if self.ultimo_resultado:
                        self.botao_pasta.configure(state="normal")
                        self._escreve("Pronto — o .docx está na mesma pasta do PDF.\n")
        except queue.Empty:
            pass
        self.after(100, self._processa_eventos)


def main(argv: Optional[List[str]] = None) -> int:
    """Abre a janela. Arquivos passados na linha de comando (ou arrastados
    sobre o executável) já entram na lista."""
    argumentos = list(sys.argv[1:] if argv is None else argv)
    _melhora_nitidez_no_windows()

    raiz = tk.Tk()
    try:
        raiz.call("ttk::style", "theme", "use", "vista")  # aparência nativa do Windows
    except tk.TclError:
        pass
    _usa_icone(raiz)
    Aplicativo(raiz, [a for a in argumentos if a.lower().endswith(".pdf")])
    raiz.mainloop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
