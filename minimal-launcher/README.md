# Minimal — launcher de digitar

Tela inicial para Android no estilo "celular minimalista": fundo preto, só texto,
nenhum ícone. A tela mostra o relógio e os seus apps favoritos; qualquer outro app
só abre se você digitar o nome.

## Como usar

| Quero… | Faço… |
| --- | --- |
| Abrir um app | Toco em **buscar app**, digito parte do nome e toco no resultado (ou aperto *Enter* para abrir o primeiro) |
| Fixar um app na tela inicial | Busco o app, **toco e seguro** e escolho *Adicionar à tela inicial* |
| Tirar ou reordenar um favorito | Toco e seguro o favorito: *Tirar*, *Mover para cima/baixo* |
| Voltar ao launcher normal por um tempo | Digito **`pausa`** (30 min), **`pausa 10`** (10 min) ou **`pausa 2h`** |
| Encerrar a pausa antes da hora | Abro o app **Minimal** pela gaveta de apps do launcher normal |
| Desativar de vez | Digito **`desativar`** e escolho outro app de tela inicial |
| Ver os alarmes | Toco no relógio |

A busca ignora acentos e maiúsculas ("cal" acha "Calculadora" e "Calendário").

### Como a pausa funciona

O Minimal continua sendo a tela inicial do Android, mas durante a pausa repassa
cada toque no botão *início* para o launcher que veio com o celular. Quando o
prazo acaba, o próximo *início* já cai de novo no Minimal — não é preciso
lembrar de reativar.

## Instalar

1. Abra, no navegador do celular, a página **Releases** deste repositório no GitHub
   e baixe `minimal-launcher.apk` da versão *Minimal Launcher (última versão)*.
2. Abra o arquivo baixado e permita a instalação de "fontes desconhecidas" quando o
   Android pedir.
3. Abra o **Minimal**. Na primeira vez ele pede para virar a tela inicial do
   celular: escolha **Minimal** (e *Sempre*, se o Android perguntar).
   Enquanto ele não for a tela inicial, aparece um aviso em branco acima da busca;
   toque nele para tentar de novo. (Caminho manual: *Configurações → Apps →
   Apps padrão → App de tela inicial*.)

Isso é o que faz o Minimal "prender" o celular: o botão *início* e o gesto de
voltar para a tela inicial passam a abrir o Minimal, de dentro de qualquer app.

Requer Android 8 ou mais novo.

## Build

O APK é montado pelo GitHub Actions (`.github/workflows/minimal-launcher.yml`) a cada
push que mexe nesta pasta. Para montar localmente, com o SDK do Android instalado:

```
cd minimal-launcher
gradle assembleRelease
```

O APK é assinado com `minimal.keystore`, que fica no repositório de propósito: assim
toda versão nova instala por cima da anterior sem perder os favoritos. É uma chave
só deste app pessoal — não use para mais nada.
