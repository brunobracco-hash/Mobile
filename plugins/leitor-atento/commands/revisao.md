---
description: Revisa vírgula, ortografia, crase, regência, concordância, notas e citações — apontando as correções sem alterar o original
argument-hint: <arquivo.docx> [capítulo ou intervalo §N-§M]
allowed-tools: Read, Write, Glob, Bash, Skill
---

Faça a revisão formal de: **$ARGUMENTS**

Use a skill `revisao-formal`. Siga-a integralmente.

Pontos que não podem ser esquecidos:

1. **Aponte, nunca altere.** O `.docx` original não é tocado — nem para corrigir um erro óbvio. O produto é a lista de correções propostas.
2. Se nenhum arquivo foi indicado acima, procure `.docx` na pasta atual e nas subpastas óbvias. Se houver mais de um, pergunte qual antes de começar.
3. Detecte primeiro os padrões editoriais do próprio texto e respeite-os. Consistência interna vem antes da norma externa.
4. Classifique cada item como ERRO, INCONSISTÊNCIA ou PREFERÊNCIA, e não inflacione — na dúvida entre erro e preferência, é preferência.
5. **Agrupe o que é sistemático.** Quatorze ocorrências da mesma regra são um item com quatorze âncoras, não quatorze itens.
6. Confira as ocorrências que você contar. Se disser "9 ocorrências", os 9 `§` precisam existir e conter o erro.
7. O relatório vai para `<nome-do-original> — revisão.md`, na mesma pasta do original, com seção própria para notas e citações.

Ao terminar, mostre no chat só o resumo: contagem por nível e as três correções de maior alcance. O detalhe fica no arquivo.
