# pdf2kindle

Converte um PDF qualquer em um **.docx refluível e diagramado para ler no Kindle** —
não um "PDF com extensão trocada". O texto é remontado em parágrafos de verdade,
com títulos hierárquicos, sumário navegável, imagens embutidas e as notas de
rodapé reunidas no fim.

O arquivo gerado é enviado direto para o Kindle (anexo em `seu-nome@kindle.com` ou
pelo site *Enviar para Kindle*): a Amazon aceita `.docx` e usa os estilos de título
para montar a navegação do e-book.

## Por que não basta "salvar como Word"

Um PDF guarda coordenadas, não texto corrido. Quem simplesmente extrai as palavras
entrega ao Kindle um arquivo com linhas quebradas no meio da frase, número de página
no meio do capítulo e colunas intercaladas. Este projeto desfaz a diagramação do
papel antes de escrever o Word:

| Problema do PDF | O que o pdf2kindle faz |
| --- | --- |
| Linhas soltas em vez de parágrafos | Reagrupa por entrelinhas, recuo e largura da linha |
| Palavra hifenizada no fim da linha | Remonta a palavra (`inva-` + `riavelmente`) |
| Parágrafo cortado pela quebra de página | Junta as duas metades |
| Cabeçalho e rodapé repetidos | Detecta a repetição nas margens e descarta |
| Número de página | Reconhece arábico, romano e "Página 3 de 200" |
| Título corrente de seção no alto da página | Descarta quando repete um título do corpo |
| Página de duas ou três colunas | Detecta as faixas vazias e lê coluna a coluna |
| Sumário do PDF (com pontilhado e números) | Descarta e gera um sumário navegável próprio |
| Nota de rodapé no pé da página | Tira do meio do texto e reúne no fim, com a página de origem |
| PDF digitalizado, sem camada de texto | Avisa e roda OCR (se o `ocrmypdf` estiver instalado) |
| Texto do OCR picado em fragmentos soltos | Remonta parágrafos e títulos partidos, na vertical e na horizontal |
| Imagem da página inteira sob o texto do OCR | Descarta (duplicaria o texto e multiplicaria o tamanho) |

O `.docx` é escrito seguindo o que o conversor da Amazon espera: estilos
`Título 1/2/3` nativos (é deles que sai o "Ir para"), recuo e espaçamento vindos do
estilo — nunca de espaços, tabs ou parágrafos vazios —, imagens inline limitadas à
largura do texto, e nada de tabelas, caixas de texto ou colunas.

## No celular, sem instalar nada

Abra o notebook no Google Colab e siga as células de cima para baixo — envio do
PDF, conversão e download acontecem no navegador:

[**pdf2kindle_colab.ipynb**](https://colab.research.google.com/github/brunobracco-hash/Mobile/blob/claude/pdf-word-kindle-converter-2xnrir/pdf2kindle_colab.ipynb)

Se o link não abrir, vá em [colab.research.google.com](https://colab.research.google.com),
aba **GitHub**, cole `https://github.com/brunobracco-hash/Mobile` e escolha o
notebook da lista.

O notebook é gerado por `scripts/build_colab_notebook.py` (e um teste garante
que os dois não divirjam).

## Instalação

```bash
pip install -r requirements.txt      # ou: pip install -e .
```

Sem clonar o repositório (não precisa de Git):

```bash
pip install https://github.com/brunobracco-hash/Mobile/archive/refs/heads/claude/pdf-word-kindle-converter-2xnrir.zip
```

OCR é opcional e só é usado em PDFs digitalizados:

```bash
pip install ocrmypdf
sudo apt install tesseract-ocr tesseract-ocr-por ghostscript
```

### Windows: aplicativo com janela (.exe)

Não precisa de Python nem de terminal. O executável é montado a cada mudança
por uma máquina Windows do GitHub Actions, que antes roda a suíte de testes,
converte um PDF com o próprio executável e confere que a janela abre.

1. Abra a aba **Actions** do repositório → workflow **App do Windows** → a
   execução mais recente com ✅.
2. Baixe o artefato **pdf2kindle-windows** (é um .zip).
3. Descompacte e dê duplo clique em **pdf2kindle.exe**.

Dentro do .zip vêm dois programas: `pdf2kindle.exe` (a janela) e
`pdf2kindle-cli.exe` (linha de comando, para quem preferir). O `.docx` é salvo
na mesma pasta do PDF.

O Windows costuma mostrar um aviso do SmartScreen na primeira execução, porque
o arquivo não tem assinatura digital paga: **Mais informações → Executar assim
mesmo**.

Para compilar você mesmo, com Python instalado:

```powershell
py -m pip install . pyinstaller
pyinstaller --clean --noconfirm packaging/pdf2kindle.spec
```

### Windows: instalando com Python

Instale o Python de [python.org](https://www.python.org/downloads/windows/)
marcando **"Add python.exe to PATH"**. Depois, no PowerShell:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
py -m pip install https://github.com/brunobracco-hash/Mobile/archive/refs/heads/claude/pdf-word-kindle-converter-2xnrir.zip
pdf2kindle-web
```

Se o PowerShell recusar a ativação do ambiente, libere os scripts do usuário
com `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

Para OCR no Windows, além de `pip install ocrmypdf`, instale os dois programas
que ele chama: [Tesseract](https://github.com/UB-Mannheim/tesseract/wiki)
(marcando o idioma português) e [Ghostscript](https://ghostscript.com/releases/gsdnld.html).

## Uso — linha de comando

```bash
python -m pdf2kindle livro.pdf                    # gera livro.docx
python -m pdf2kindle livro.pdf -o meu-ebook.docx
python -m pdf2kindle *.pdf -d convertidos/        # lote
python -m pdf2kindle digitalizado.pdf --ocr force
```

Ao final imprime um relatório com páginas, títulos, parágrafos, imagens e notas —
e avisa quando algo merece revisão (por exemplo, nenhum título detectado).

### Opções

| Opção | Para quê |
| --- | --- |
| `--title` / `--author` | Sobrescreve os metadados (viram título e autor do e-book) |
| `--font`, `--size`, `--line-spacing` | Aparência no Word (o Kindle aplica a fonte do leitor) |
| `--no-justify` | Alinha à esquerda em vez de justificar |
| `--no-toc`, `--no-title-page` | Dispensa o sumário ou a folha de rosto |
| `--no-page-breaks` | Não começa cada capítulo em página nova |
| `--no-images` | Descarta as imagens (arquivo bem menor) |
| `--footnotes end\|inline\|drop` | Notas no fim (padrão), onde estão, ou fora |
| `--ocr auto\|force\|off`, `--ocr-lang` | Controle do OCR |
| `--lang` | Idioma do documento (padrão `pt-BR`) |

## Uso — interface web

```bash
python -m pdf2kindle.web            # http://127.0.0.1:5000
```

Arraste o PDF, ajuste as opções, baixe o `.docx`. Roda só na sua máquina: os
arquivos ficam em uma pasta temporária, apagada depois do download.

## Como está organizado

```
pdf2kindle/
  extract.py      PDF → blocos, na ordem de leitura, sem cabeçalho/rodapé
  structure.py    blocos → documento semântico (títulos, parágrafos, listas, notas)
  docx_writer.py  documento → .docx com as regras do Kindle
  converter.py    pipeline completo, incluindo OCR
  cli.py / web.py interfaces
```

A separação é proposital: `extract.py` só entende geometria, `structure.py` só
decide semântica e `docx_writer.py` só conhece as restrições do Kindle. Dá para
trocar o escritor por um de EPUB sem tocar no resto.

## Livro digitalizado

Um PDF que é só a fotografia das páginas exige dois cuidados a mais, e ambos
estão cobertos:

```bash
sudo apt install ocrmypdf tesseract-ocr-por
python -m pdf2kindle livro-escaneado.pdf --ocr auto --ocr-lang por
```

O reconhecimento devolve o texto quebrado de um jeito que PDF digital nunca
quebra — cada linha, e às vezes cada pedaço de linha, vira um bloco solto —, e
deixa a imagem da página inteira por baixo do texto. Sem tratamento, o resultado
é um `.docx` com uma linha por parágrafo, capítulos duplicados no sumário e
vinte vezes o tamanho necessário. O conversor remonta os fragmentos pelo mesmo
critério da quebra de página e descarta a digitalização quando há texto por cima.

Medido no PDF de amostra digitalizado a 200 dpi, com inclinação, ruído e
compressão JPEG: **6 títulos e 9 parágrafos, contra 6 títulos e 7 parágrafos do
mesmo livro em PDF digital** — a mesma estrutura, e 0,04 MB em vez de 0,83 MB.

Sem o `ocrmypdf` instalado, o aviso é explícito e as imagens das páginas são
preservadas: um livro em fac-símile ainda é melhor do que um arquivo vazio.

## Testes

```bash
pytest -q      # 61 testes
```

A suíte gera um PDF de teste com todos os defeitos típicos (cabeçalho repetido,
parágrafo partido entre páginas, hifenização, duas colunas, sumário com pontilhado,
título corrente, lista, nota de rodapé e imagem) e verifica tanto a extração quanto
as regras do arquivo final — inclusive as que o Kindle não perdoa: nada de
parágrafo vazio, tabulação, quebra manual de linha ou tabela.

## Limitações honestas

* **Tabelas** viram texto corrido. É proposital: tabela em Kindle sai ilegível.
  Se o seu PDF depende delas, mantenha o PDF.
* **Fórmulas** em PDF são desenho, não texto: saem como uma sequência de símbolos.
* A classificação de títulos é heurística (tamanho, negrito, caixa alta, numeração).
  Em livros que usam uma fonte só para tudo, alguns títulos escapam — o relatório
  avisa quando não encontra nenhum, e como o arquivo usa os estilos nativos do Word,
  corrigir um título é questão de selecionar e aplicar `Título 1`.
* Em livro digitalizado, **as figuras se perdem**: elas fazem parte do bitmap da
  página, e separar ilustração de papel exigiria análise de layout que este
  projeto não faz. O texto vem completo; as imagens, não.
* A qualidade do OCR é a do Tesseract: acentos e páginas de sumário saem
  embaralhados. O sumário do PDF é descartado de qualquer forma, mas vale
  revisar os títulos antes de enviar.
