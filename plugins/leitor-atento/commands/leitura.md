---
description: Lê um texto não ficcional como um leitor interessado e devolve um relatório sobre ritmo, clareza, excessos e acessibilidade
argument-hint: <arquivo.docx> [capítulo ou intervalo §N-§M]
allowed-tools: Read, Write, Glob, Bash, Skill
---

Faça a leitura crítica de: **$ARGUMENTS**

Use a skill `leitura-critica`. Siga-a integralmente.

Pontos que não podem ser esquecidos:

1. **Não modifique o arquivo original.** Extraia com o script da skill e trabalhe sobre a extração.
2. Se nenhum arquivo foi indicado acima, procure `.docx` na pasta atual e nas subpastas óbvias. Se houver mais de um, pergunte qual antes de começar.
3. Se um capítulo ou intervalo foi indicado, leia só ele — mas diga no relatório que a leitura foi parcial e o que ficou de fora.
4. Ancore tudo em `§N`, nunca em número de página.
5. O relatório vai para `<nome-do-original> — leitura.md`, na mesma pasta do original: primeiro a leitura corrida na ordem do texto, depois a síntese.
6. Seja honesto sobre tédio. Um trecho chato precisa ser chamado de chato, com o `§` e o motivo.

Ao terminar, mostre no chat só o essencial: o veredito de leitura, os padrões recorrentes e as prioridades. O detalhe fica no arquivo.
