# leitor-atento

Um leitor interessado e um revisor, para livros e textos **não ficcionais**.

Não é o parecerista acadêmico e não é o coach entusiasmado. É o leitor culto que pegou o livro por interesse, não é obrigado a terminar, e diz honestamente onde a leitura dói.

O objetivo do plugin é um texto **profundo e acessível ao mesmo tempo** — sem confundir acessível com simplificado, e sem tratar citação acadêmica como problema. A pergunta nunca é "tem citação demais?", e sim "esta citação carrega o argumento ou pesa sobre ele?".

## Os dois comandos

### `/leitura <arquivo.docx>`

A leitura crítica, em quatro eixos: **ritmo** (onde arrasta, onde atropela), **clareza dos conceitos** (o que entrou na página sem ser apresentado), **excessos** (o que sai sem que nada se perca) e **acessibilidade** (o leitor não-acadêmico atravessa sem perder o argumento?).

Devolve a leitura corrida, na ordem do texto, como quem anota à margem — e depois a síntese: veredito, padrões recorrentes, trechos que mais custam leitor, o que está funcionando, e as prioridades em ordem de retorno.

### `/revisao <arquivo.docx>`

A correção formal: vírgula, ortografia, acentuação, crase, regência, concordância, pontuação, notas de rodapé e citações.

Cada item vem classificado como **ERRO**, **INCONSISTÊNCIA** ou **PREFERÊNCIA**, e o que é sistemático vem agrupado — quatorze ocorrências da mesma regra são um item com quatorze âncoras, não quatorze itens. As notas de rodapé têm seção própria, separando a mecânica (numeração, posição, latinismos) da decisão editorial (esta nota devia estar no corpo?).

Aceita um capítulo ou intervalo como segundo argumento, para trabalhar por partes:

```
/leitura livro.docx capítulo 3
/revisao livro.docx §120-§240
```

## Duas garantias

**O `.docx` original nunca é modificado.** Nenhum dos dois comandos escreve no arquivo de entrada — nem para corrigir um erro óbvio. Os relatórios saem em arquivos separados, na mesma pasta, como `<nome> — leitura.md` e `<nome> — revisão.md`.

**As correções são apontadas, não aplicadas.** Cada uma vem com o trecho original, a proposta e o motivo em uma linha, para você decidir uma a uma.

## Âncoras `§N` em vez de páginas

Os relatórios apontam trechos por `§N`, o índice do parágrafo. Paginação de `.docx` depende da fonte, da margem e da versão do Word que abre o arquivo — "página 47" aponta para lugares diferentes em máquinas diferentes. O índice do parágrafo é o mesmo em qualquer lugar.

## Instalação

```
/plugin marketplace add brunobracco-hash/Mobile
/plugin install leitor-atento@bruno-bracco
```

## Requisitos

Python 3 — só a biblioteca padrão. Sem `pip install`, sem pandoc. O extrator lê o `.docx` direto do XML, o que também é o que permite recuperar as notas de rodapé com a chamada no ponto exato em que aparecem no corpo.

Roda igual em Mac, Linux e Windows.

## Estrutura

```
leitor-atento/
├── commands/
│   ├── leitura.md
│   └── revisao.md
├── skills/
│   ├── leitura-critica/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── diagnostico-ritmo.md      # como ler as estatísticas sem se enganar
│   │       └── acessibilidade.md         # profundidade e alcance ao mesmo tempo
│   └── revisao-formal/
│       ├── SKILL.md
│       └── references/
│           ├── virgula.md                # ordenado por frequência do erro
│           ├── notas-e-citacoes.md       # mecânica e camada editorial
│           └── norma-e-estilo.md         # crase, regência, hífen, itálico
└── scripts/
    └── extrair.py                        # .docx → texto com âncoras e estatísticas
```

O script também funciona sozinho, fora do Claude:

```bash
python3 scripts/extrair.py livro.docx            # texto com âncoras [§N]
python3 scripts/extrair.py livro.docx --stats    # estatísticas de ritmo por seção
python3 scripts/extrair.py livro.docx --de 40 --ate 90
```
