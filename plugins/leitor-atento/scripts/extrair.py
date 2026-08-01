#!/usr/bin/env python3
"""Extrai o texto de um .docx preservando âncoras estáveis, notas e estatísticas.

Só usa a biblioteca padrão do Python — nada de instalar pacote, nada de pandoc.
Roda igual no Mac, no Linux e no Windows.

O arquivo de entrada é aberto somente para leitura. Nada é escrito nele.

Uso:
    python3 extrair.py livro.docx              # texto com âncoras [§N]
    python3 extrair.py livro.docx --stats      # só as estatísticas de ritmo
    python3 extrair.py livro.docx --json       # estrutura completa, para processar
    python3 extrair.py livro.docx --de 40 --ate 90   # recorte por parágrafo

Por que âncoras [§N] e não número de página: a paginação de um .docx depende da
fonte, da margem e da versão do Word que abre o arquivo — dois leitores veem
páginas diferentes. O índice do parágrafo é o mesmo para todo mundo, sempre.
"""

import argparse
import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# Estilos que o Word usa para título, em instalações PT e EN.
HEADING_RE = re.compile(r"^(?:heading|t[íi]?tulo)\s*(\d)$", re.I)

CITACAO_PAREN = re.compile(r"\([A-ZÁÂÃÀÉÊÍÓÔÕÚÇ][A-ZÁÂÃÀÉÊÍÓÔÕÚÇ\s.&-]{2,},\s*\d{4}")
ASPAS = re.compile(r"[\"“”«»]")

# Fim de frase candidato: pontuação final, aspas/parêntese de fecho, espaço ou fim.
FIM_DE_FRASE = re.compile(r"([.!?…]+)([\"'”’»)\]]*)(\s+|$)")

# Abreviações que terminam em ponto sem terminar a frase. Sem esta lista, um
# livro com aparato acadêmico é cortado a cada "p. 32" ou "cf. Deleuze", e a
# média de palavras por frase desaba — o texto pareceria ágil justamente onde
# está mais denso.
ABREVIACOES = {
    "p", "pp", "cf", "ed", "eds", "org", "orgs", "trad", "rev", "vol", "vols",
    "n", "nº", "no", "séc", "sec", "fl", "fls", "art", "arts", "inc", "cap",
    "caps", "fig", "figs", "tab", "ap", "apud", "ibid", "ibidem", "id", "idem",
    "op", "cit", "al", "etc", "ex", "obs", "i.e", "e.g", "a.C", "d.C",
    "sr", "sra", "srta", "dr", "dra", "prof", "profa", "exmo", "exma", "st",
    "jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out",
    "nov", "dez",
}


def texto_do_paragrafo(p, com_notas=True):
    """Concatena o texto de um w:p na ordem do documento.

    Percorre com iter() porque a ordem de iteração é a ordem do documento — é o
    que mantém a chamada de nota no lugar certo dentro da frase. Texto marcado
    como exclusão de controle de alterações vive em w:delText, não em w:t, então
    fica de fora naturalmente: lemos o texto como ele está, não como estava.
    """
    partes = []
    for el in p.iter():
        tag = el.tag
        if tag == W + "t":
            partes.append(el.text or "")
        elif tag == W + "tab":
            partes.append("\t")
        elif tag == W + "br":
            partes.append("\n")
        elif tag == W + "noBreakHyphen":
            partes.append("-")
        elif com_notas and tag in (W + "footnoteReference", W + "endnoteReference"):
            marca = "n" if tag.endswith("footnoteReference") else "f"
            partes.append("[^%s%s]" % (marca, el.get(W + "id")))
    return "".join(partes)


def estilo_do_paragrafo(p):
    ppr = p.find(W + "pPr")
    if ppr is None:
        return ""
    st = ppr.find(W + "pStyle")
    if st is None:
        return ""
    return st.get(W + "val") or ""


def nivel_de_titulo(estilo):
    """0 = corpo de texto; 1..9 = nível de título."""
    limpo = estilo.replace("-", " ").replace("_", " ").strip()
    m = HEADING_RE.match(limpo)
    if m:
        return int(m.group(1))
    if limpo.lower() in ("title", "titulo", "título"):
        return 1
    return 0


def _ler_notas(z, nome_arquivo, raiz, prefixo):
    notas = {}
    if nome_arquivo not in z.namelist():
        return notas
    xml = ET.fromstring(z.read(nome_arquivo))
    for nota in xml.findall(W + raiz):
        tipo = nota.get(W + "type")
        if tipo in ("separator", "continuationSeparator", "continuationNotice"):
            continue
        nid = nota.get(W + "id")
        corpo = " ".join(
            texto_do_paragrafo(p, com_notas=False) for p in nota.findall(W + "p")
        )
        corpo = " ".join(corpo.split())
        if corpo:
            notas[prefixo + nid] = corpo
    return notas


def extrair(caminho):
    with zipfile.ZipFile(caminho) as z:
        documento = ET.fromstring(z.read("word/document.xml"))
        notas = _ler_notas(z, "word/footnotes.xml", "footnote", "n")
        notas.update(_ler_notas(z, "word/endnotes.xml", "endnote", "f"))

    corpo = documento.find(W + "body")
    if corpo is None:
        raise SystemExit("Arquivo .docx sem corpo de texto legível.")

    paragrafos = []
    secao_atual = "(sem título)"
    indice = 0

    def registrar(p, dentro_de_tabela=False):
        nonlocal indice, secao_atual
        texto = texto_do_paragrafo(p).strip()
        estilo = estilo_do_paragrafo(p)
        nivel = nivel_de_titulo(estilo)
        if not texto:
            return
        indice += 1
        if nivel:
            secao_atual = texto
        paragrafos.append(
            {
                "n": indice,
                "texto": texto,
                "estilo": estilo,
                "nivel_titulo": nivel,
                "secao": secao_atual,
                "tabela": dentro_de_tabela,
            }
        )

    for filho in corpo:
        if filho.tag == W + "p":
            registrar(filho)
        elif filho.tag == W + "tbl":
            for p in filho.iter(W + "p"):
                registrar(p, dentro_de_tabela=True)

    return {"paragrafos": paragrafos, "notas": notas, "arquivo": os.path.basename(caminho)}


def frases(texto):
    """Divide em frases respeitando abreviações e iniciais de nome próprio."""
    saida = []
    inicio = 0
    for m in FIM_DE_FRASE.finditer(texto):
        anterior = texto[:m.start()]
        token = re.split(r"[\s(\[«\"“‘]", anterior)[-1].strip().lower()
        if token in ABREVIACOES:
            continue
        # "G. Deleuze", "J. S. Bach": inicial isolada nunca fecha frase.
        if len(token) == 1 and token.isalpha():
            continue
        fim = m.end()
        frase = texto[inicio:fim].strip()
        if frase:
            saida.append(frase)
        inicio = fim
    resto = texto[inicio:].strip()
    if resto:
        saida.append(resto)
    return saida


def estatisticas(dados):
    """Números objetivos para ancorar impressões de ritmo.

    Não substituem a leitura — um parágrafo longo pode ser ótimo. Servem para
    localizar candidatos e para não confundir 'me cansei' com 'o texto cansa'.
    """
    secoes = {}
    ordem = []
    for p in dados["paragrafos"]:
        # Títulos e células de tabela não são prosa: entram na contagem de ritmo
        # como frases curtíssimas e fazem a média mentir.
        if p["nivel_titulo"] or p["tabela"]:
            continue
        sec = p["secao"]
        if sec not in secoes:
            secoes[sec] = {
                "secao": sec,
                "paragrafos": 0,
                "palavras": 0,
                "frases": [],
                "primeiro_paragrafo": p["n"],
                "citacoes_parenteticas": 0,
                "trechos_entre_aspas": 0,
                "chamadas_de_nota": 0,
                "paragrafos_longos": [],
                "frases_longas": [],
            }
            ordem.append(sec)
        s = secoes[sec]
        palavras = len(p["texto"].split())
        s["paragrafos"] += 1
        s["palavras"] += palavras
        s["citacoes_parenteticas"] += len(CITACAO_PAREN.findall(p["texto"]))
        s["trechos_entre_aspas"] += len(ASPAS.findall(p["texto"])) // 2
        s["chamadas_de_nota"] += p["texto"].count("[^")
        if palavras > 180:
            s["paragrafos_longos"].append({"n": p["n"], "palavras": palavras})
        for f in frases(p["texto"]):
            nf = len(f.split())
            s["frases"].append(nf)
            if nf > 45:
                s["frases_longas"].append({"n": p["n"], "palavras": nf})

    resumo = []
    for sec in ordem:
        s = secoes[sec]
        fr = s.pop("frases")
        n = len(fr) or 1
        media = sum(fr) / n
        # Desvio padrão do comprimento das frases: quando é baixo, todas as frases
        # têm o mesmo tamanho, e prosa sem variação de fôlego soa monótona em voz
        # alta mesmo quando cada frase, isolada, está correta.
        variancia = sum((x - media) ** 2 for x in fr) / n
        s["frases_total"] = len(fr)
        s["media_palavras_por_frase"] = round(media, 1)
        s["variacao_do_comprimento"] = round(variancia**0.5, 1)
        s["media_palavras_por_paragrafo"] = round(s["palavras"] / (s["paragrafos"] or 1), 1)
        if s["palavras"]:
            s["citacoes_por_mil_palavras"] = round(
                1000.0 * (s["citacoes_parenteticas"] + s["chamadas_de_nota"]) / s["palavras"], 1
            )
        else:
            s["citacoes_por_mil_palavras"] = 0.0
        resumo.append(s)

    total_palavras = sum(s["palavras"] for s in resumo)
    return {
        "arquivo": dados["arquivo"],
        "total_paragrafos": len(dados["paragrafos"]),
        "total_palavras": total_palavras,
        "total_notas": len(dados["notas"]),
        "secoes": resumo,
    }


def como_markdown(dados, de=None, ate=None):
    linhas = []
    for p in dados["paragrafos"]:
        if de and p["n"] < de:
            continue
        if ate and p["n"] > ate:
            continue
        prefixo = "#" * p["nivel_titulo"] + " " if p["nivel_titulo"] else ""
        marca_tabela = " _(tabela)_" if p["tabela"] else ""
        linhas.append("[§%d] %s%s%s" % (p["n"], prefixo, p["texto"], marca_tabela))
    if dados["notas"]:
        linhas.append("")
        linhas.append("## Notas")
        for nid, corpo in sorted(dados["notas"].items(), key=lambda kv: (kv[0][0], int(kv[0][1:]))):
            linhas.append("[^%s]: %s" % (nid, corpo))
    return "\n\n".join(linhas)


def main():
    ap = argparse.ArgumentParser(description="Extrai texto de .docx sem modificar o original.")
    ap.add_argument("arquivo")
    ap.add_argument("--stats", action="store_true", help="só as estatísticas de ritmo, em JSON")
    ap.add_argument("--json", action="store_true", help="estrutura completa em JSON")
    ap.add_argument("--de", type=int, help="primeiro parágrafo do recorte")
    ap.add_argument("--ate", type=int, help="último parágrafo do recorte")
    args = ap.parse_args()

    if not os.path.exists(args.arquivo):
        raise SystemExit("Arquivo não encontrado: %s" % args.arquivo)
    if not zipfile.is_zipfile(args.arquivo):
        raise SystemExit(
            "Isto não é um .docx válido. Se for .doc antigo ou .pdf, converta antes."
        )

    dados = extrair(args.arquivo)

    if args.stats:
        print(json.dumps(estatisticas(dados), ensure_ascii=False, indent=2))
    elif args.json:
        print(json.dumps(dados, ensure_ascii=False, indent=2))
    else:
        print(como_markdown(dados, args.de, args.ate))


if __name__ == "__main__":
    main()
