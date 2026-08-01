# VozPDF

App de celular que lê PDFs em voz alta, com vozes de IA em **português do Brasil**,
**inglês dos EUA** e **espanhol**, tocando em segundo plano com a tela apagada e
retomando exatamente de onde a leitura parou.

## O que ele faz

- **Importa PDFs** e extrai o texto no próprio aparelho, sem enviar o arquivo para lugar nenhum.
- **Limpa o texto para narração**: remove cabeçalhos que se repetem a cada página, números de
  página soltos e remonta palavras quebradas por hifenização de fim de linha.
- **Detecta o idioma** entre os três suportados e escolhe a voz correspondente (dá para corrigir
  à mão pelo botão PT/EN/ES no topo da tela de leitura).
- **Narra com vozes de IA** — ElevenLabs, OpenAI ou Google Cloud — com instrução de estilo de
  audiolivro: ritmo calmo, pausas naturais na pontuação, entonação de leitura humana.
- **Toca em segundo plano**: serviço de mídia em primeiro plano no Android e modo de áudio de fundo
  no iOS, com play/pausa e avanço na notificação e na tela bloqueada.
- **Lembra onde parou**, em caracteres e não só em número de trecho: a posição sobrevive a
  reimportações e a mudanças no tamanho dos trechos.
- **Guarda o áudio já gerado**: reouvir um trecho não custa nada e funciona offline.
- **Temporizador de sono**, controle de velocidade de 0,5x a 2,5x e tema claro/escuro.

## Como a narração funciona

O texto é fatiado em trechos de ~320 caracteres, cortados em fim de frase (com tratamento de
abreviações em pt/en/es, decimais e iniciais). Cada trecho é sintetizado em um arquivo mp3 e tocado
pelo `expo-audio`; enquanto um trecho toca, os seguintes já vão sendo sintetizados e pré-carregados,
para a leitura não engasgar na virada.

A velocidade é aplicada no player, não na síntese — trocar de 1,0x para 1,5x é instantâneo e
reaproveita o áudio já gerado.

### Provedores de voz

| Provedor | Chave | Rede | Observação |
| --- | --- | --- | --- |
| ElevenLabs | sim | sim | Narração mais próxima de leitura humana; `eleven_multilingual_v2` cobre os três idiomas com o mesmo timbre |
| OpenAI | sim | sim | `gpt-4o-mini-tts`, aceita direção de estilo em texto |
| Google Cloud | sim | sim | Vozes Neural2 por idioma, menor custo por caractere |
| Voz do aparelho | não | não | Offline e grátis, porém menos natural; no iOS a fala para quando o app sai da tela |

As chaves ficam no armazenamento seguro do sistema (Keychain / EncryptedSharedPreferences), nunca
junto com os demais ajustes. O texto dos trechos é enviado ao provedor escolhido para virar áudio —
o PDF em si nunca sai do aparelho.

> **Sobre o modo offline:** só as vozes de IA geram arquivos de áudio, e é o arquivo que permite
> tocar em segundo plano com a tela apagada. A voz do aparelho existe como alternativa sem chave e
> sem internet, mas com essa limitação — a tela de leitura avisa quando ela está em uso.

## Rodando o projeto

O app usa módulos nativos (player de mídia e WebView), então **não roda no Expo Go**: é preciso um
_development build_.

```bash
npm install          # o postinstall prepara os bundles do pdf.js
npm run prebuild     # gera as pastas ios/ e android/
npm run android      # ou: npm run ios (precisa de macOS)
npm start            # servidor de desenvolvimento para o dev client já instalado
```

Para gerar builds distribuíveis, use o EAS (`npx eas build -p android`), que já lê as
configurações de `app.json`.

### Testes

```bash
npm test        # 81 testes: núcleo puro + extrator de PDF em Chromium
npm run typecheck
```

O teste do extrator sobe um Chromium e carrega exatamente o mesmo HTML que a WebView do app
carrega — é o que garante que o pdf.js funciona no ambiente restrito de uma WebView. Se o ambiente
já tiver um Chromium instalado, aponte com `CHROMIUM_PATH=/caminho/para/chromium npm test`.

## Estrutura

```
app/                      telas (expo-router): biblioteca, leitor, ajustes
src/core/                 lógica pura, sem React Native — é o que os testes cobrem
  text/                   normalização do texto do PDF, frases, trechos, idioma
  tts/                    catálogo de provedores e montagem das requisições
  reading/                memória de posição de leitura
  pdf/                    protocolo e página do extrator
src/services/             camada nativa
  pdf/                    WebView do pdf.js e pipeline de importação
  tts/                    síntese, cache de áudio em disco
  player/                 encadeamento dos trechos, tela bloqueada, controlador
  storage/                biblioteca, ajustes, chaves de API
scripts/prepare-pdfjs.mjs converte o pdf.js (ESM) em scripts carregáveis na WebView
```

### Por que uma WebView para ler o PDF

O `pdfjs-dist` só publica builds em ES module, e um `<script type="module" src="file://…">` é
bloqueado por CORS na WebView do Android. O script de preparo remove o `export{…}` final,
neutraliza `import.meta` e isola cada bundle em uma IIFE (sem isso, os dois bundles minificados
colidem no escopo global). Como o build `legacy` já publica `globalThis.pdfjsWorker`, o pdf.js usa
o handler na thread principal e nunca tenta criar um `Worker` — o que elimina qualquer problema de
origem. Tudo isso é verificado pelo teste em Chromium.

### Por que `expo-audio` e não um player de fila pronto

A escolha natural seria o `react-native-track-player`, que traz fila e controles de mídia prontos.
Ele não compila contra o React Native 0.86 (erro de nulidade em `MusicModule.kt`, na versão 4.1.2),
e a versão 5 ainda está em alfa. O `expo-audio` cobre o mesmo terreno com garantia de compatibilidade
com o SDK: no Android roda num `MediaSessionService` em primeiro plano e no iOS sob o modo de fundo
`audio`. O que ele não tem é fila nativa com controle de tela bloqueada — por isso o encadeamento
dos trechos é feito no `PlaybackController`, que troca a fonte do player ao fim de cada trecho.

## Limitações conhecidas

- **PDFs digitalizados** (só imagens) não têm texto para narrar. O app detecta e avisa na
  importação, em vez de abrir um documento mudo. Não há OCR embutido.
- **PDFs protegidos por senha** são reconhecidos, mas a tela ainda não pede a senha — o protocolo
  de extração já a aceita (`extract(id, senha)`).
- A **voz do aparelho** não tem controles na tela bloqueada, porque não existe arquivo de áudio
  para o player de mídia expor.
- Os controles da tela bloqueada trazem play/pausa e avanço dentro do trecho atual; pular trechos
  é feito na tela do app.
