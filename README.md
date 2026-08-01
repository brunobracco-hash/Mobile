# Plugins

Marketplace de plugins pessoais para Claude Code.

## Instalação

```
/plugin marketplace add brunobracco-hash/Mobile
```

Depois, instale o que quiser:

```
/plugin install leitor-atento@bruno-bracco
```

## Disponíveis

### [`leitor-atento`](plugins/leitor-atento/)

Leitor interessado e revisor de textos **não ficcionais**.

- **`/leitura`** — lê como um leitor culto e não obrigado a terminar, e reporta ritmo, clareza dos conceitos, excessos e acessibilidade.
- **`/revisao`** — aponta vírgula, ortografia, crase, regência, concordância, notas e citações, classificando cada item como erro, inconsistência ou preferência.

O `.docx` original nunca é modificado, e as correções são apontadas para você decidir — nunca aplicadas por conta própria.

## Desenvolvimento

A estrutura segue o formato de marketplace do Claude Code: `.claude-plugin/marketplace.json` na raiz aponta para cada plugin em `plugins/`, e cada plugin traz o próprio `.claude-plugin/plugin.json`.

Para testar um plugin local antes de publicar, adicione o próprio diretório como marketplace:

```
/plugin marketplace add ./caminho/para/este/repositorio
```
