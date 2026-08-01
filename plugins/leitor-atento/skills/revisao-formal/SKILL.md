---
name: revisao-formal
description: Revisa textos não ficcionais em português apontando correções de vírgula, ortografia, acentuação, crase, regência, concordância, pontuação, notas de rodapé e citações — sem nunca alterar o arquivo original. Use quando o usuário pedir "revisão", "correção", "revisar o português", "conferir as vírgulas", "checar as notas de rodapé", ou apontar para um manuscrito pedindo correção formal. Não avalia ritmo nem clareza — para leitura crítica, use a skill leitura-critica.
---

# Revisão formal

Português brasileiro, Acordo Ortográfico de 1990.

## A regra que governa tudo

**Você aponta. Você nunca altera.**

O arquivo original não é tocado, nem para "só arrumar um typo". O produto é uma lista de correções propostas, cada uma com o trecho original, a proposta e o motivo — para o autor decidir uma a uma. Se ele quiser a versão aplicada, ele pede; e ainda assim o original permanece intacto e a versão nova vai para outro arquivo.

## A segunda regra: separe erro de preferência

O maior defeito das revisões automáticas é misturar, na mesma lista e com o mesmo peso, o que está errado e o que o revisor faria diferente. O autor perde a confiança na lista inteira e ignora tudo.

Classifique cada item em três níveis, e **nunca inflacione**:

| Nível | O que é | Exemplo |
|---|---|---|
| **ERRO** | Viola a norma. Não há discussão. | "Fazem dez anos"; "à partir de"; vírgula entre sujeito e verbo |
| **INCONSISTÊNCIA** | Não é erro isolado, mas o texto faz dos dois jeitos | "sec. XIX" no §12 e "século XIX" no §80; itálico em estrangeirismo às vezes sim, às vezes não |
| **PREFERÊNCIA** | Norma permite as duas; você sugere | trocar dois-pontos por travessão; desfazer uma voz passiva |

Regra prática: se você precisa escrever "soaria melhor", é PREFERÊNCIA. Se você consegue citar a regra, é ERRO. Na dúvida entre os dois, é PREFERÊNCIA.

Um texto que recebe 200 itens marcados ERRO não é revisado — é atropelado. Se sua lista está assim, você inflacionou.

## A terceira regra: consistência interna vem antes da norma

Quando o texto adota um padrão legítimo que não é o seu, **o padrão do texto ganha**. Aspas angulares em vez de curvas, citação recuada a partir de quatro linhas em vez de três, referência em nota em vez de autor-data: são escolhas editoriais válidas.

O seu trabalho é identificar o padrão vigente no texto e cobrar **consistência com ele**, não substituí-lo pelo da ABNT. Só invoque a norma externa quando o texto não tiver padrão nenhum, ou quando o autor pedir explicitamente uma norma.

Comece a revisão detectando os padrões em uso e registre-os no topo do relatório. Isso evita gerar cem itens que são só a norma da ABNT discordando de uma escolha deliberada do autor.

## Preparação

```bash
python3 "${CLAUDE_PLUGIN_ROOT}/scripts/extrair.py" "<arquivo>.docx" > /tmp/texto.md
```

O script não escreve no `.docx`. Cada parágrafo sai marcado com `[§N]`; as notas saem ao final, com a chamada `[^nN]` no ponto exato em que aparecem no corpo — é o que permite avaliar se a nota está ancorada no lugar certo.

**Use `§N` como âncora, nunca número de página.** Paginação de `.docx` muda com fonte e versão do Word; o índice de parágrafo é estável em qualquer máquina.

Em textos longos, revise por blocos, mas **mantenha registro dos padrões e das decisões** entre os blocos — metade do valor da revisão está em pegar a inconsistência entre o capítulo 2 e o capítulo 9.

## O que revisar

Consulte os arquivos de apoio conforme a categoria:

- **`references/virgula.md`** — o núcleo. A vírgula responde pela maioria dos erros reais em texto de autor culto, e a distinção entre oração adjetiva restritiva e explicativa é a única que **muda o sentido da frase**, não só a forma.
- **`references/notas-e-citacoes.md`** — chamada de nota em relação à pontuação, nota que devia estar no corpo (e vice-versa), *idem*/*ibidem*/*op. cit.*, citação curta e longa, consistência de referências.
- **`references/norma-e-estilo.md`** — crase, regência, concordância, acentuação pós-Acordo, hífen, maiúsculas, itálico e aspas, repetição, cacófato e eco.

Além dessas, sempre verifique:

- **Numeração das notas** — sequência sem salto e sem repetição, reinício por capítulo consistente.
- **Referências cruzadas internas** — "como vimos no capítulo 3" aponta mesmo para o capítulo 3?
- **Nomes próprios e estrangeiros** — grafados igual em todas as ocorrências, com os diacríticos certos. Um nome escrito de dois jeitos ao longo do livro é dos erros mais constrangedores na versão impressa, e dos mais fáceis de deixar passar.
- **Datas, números e séculos** — formato uniforme ao longo do texto.

## Agrupe o que é sistemático

Este é o ponto que mais melhora a utilidade do relatório.

Se o autor põe vírgula antes de "e" aditivo com o mesmo sujeito quatorze vezes, **isso não são quatorze itens**. É um item: a regra, por que ele erra, e a lista completa das quatorze ocorrências. Ele aprende a regra uma vez e resolve as quatorze de uma vez.

Um relatório com 12 padrões agrupados e 30 itens isolados é infinitamente mais aproveitável que um com 300 itens soltos — mesmo cobrindo exatamente as mesmas correções.

## O relatório

Salve em arquivo separado, na mesma pasta do original, com o nome `<nome-do-original> — revisão.md`. **O `.docx` de entrada nunca é modificado.**

### 1. Padrões detectados no texto

O que o texto faz por convenção própria e que você respeitou. Uma linha cada.

> Citação longa: recuo a partir de 4 linhas (não 3). Mantido.
> Referências: autor-data no corpo, notas só para comentário. Mantido.
> Aspas: curvas duplas para citação, simples para sentido deslocado. Mantido.

### 2. Padrões de erro

Agrupados, cada um com regra, explicação curta e todas as ocorrências.

> **Vírgula separando sujeito e predicado** — 9 ocorrências — ERRO
> Não se separa o sujeito do seu verbo por vírgula, por mais longo que o sujeito seja. Acontece porque, ao ler em voz alta, faz-se uma pausa ali — mas pausa de respiração não é vírgula.
> §14, §29, §44, §61, §77, §98, §103, §129, §140
> Exemplo (§29): "Tudo o que a geração seguinte havia aprendido nas universidades alemãs, ~~,~~ desapareceu em uma década."

### 3. Itens isolados

Em ordem de `§`. Cada um: âncora, trecho, proposta, nível, motivo em uma linha.

> **§52** — ERRO — crase
> "Devido à interpretações posteriores…" → "Devido a interpretações posteriores…"
> Não há crase diante de palavra no plural sem artigo definido plural.

### 4. Notas e citações

Seção própria, porque tem lógica distinta. Numeração, ancoragem, notas que pediam corpo, notas que só repetem referência, uso de *ibidem*, consistência do padrão de citação.

### 5. Resumo

Contagem por nível e por categoria, e as três coisas que, corrigidas, resolvem o maior número de ocorrências.

## Regras firmes

- **Nunca altere o original.** Vale inclusive para erro óbvio.
- **Cite sempre o trecho literal.** Uma correção sem o texto original ao lado é impossível de conferir.
- **Uma linha de motivo, não uma aula.** O autor é culto; ele precisa da regra, não do capítulo de gramática.
- **Não invente ocorrência.** Se você afirma 9 ocorrências, os 9 `§` têm que existir e conter o erro. Confira antes de escrever o número.
- **Não corrija estilo achando que é norma.** Voz passiva, frase longa, começar com "E" ou "Mas": tudo permitido. Se quiser sugerir, marque PREFERÊNCIA.
- **Na dúvida real sobre um caso, diga que é dúvida.** Português tem zonas cinzentas legítimas — regência de "implicar", colocação pronominal, crase antes de nome de lugar. Apresente as duas leituras em vez de fingir certeza.
