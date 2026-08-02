# PDF para Word (Android)

App Android que converte PDF em documento do Word (`.docx`) **com OCR embutido e offline**,
gerando um arquivo **somente texto** — nenhuma imagem é copiada — e **sem limite de tamanho
do PDF de entrada**.

## Como funciona

Para cada página, o app decide sozinho o melhor caminho:

1. **PDF digital** (já tem camada de texto): o texto é lido diretamente do PDF — rápido e sem erros de leitura.
2. **PDF escaneado / foto** (sem texto útil): a página é rasterizada e passa por **OCR offline**
   (ML Kit, modelo embarcado no APK — não precisa de internet nem envia nada para servidor).
3. O texto vira parágrafos e é gravado direto no arquivo de saída.

### Por que não há limite de tamanho

O PDF nunca é carregado inteiro na memória:

- o arquivo é copiado em blocos de 64 KB;
- a leitura da camada de texto usa arquivo temporário em disco (não RAM);
- só **uma** página é rasterizada por vez, e o bitmap é liberado logo depois
  (com redução automática de resolução se a memória apertar);
- os parágrafos são gravados em streaming; o `.docx` só é fechado no fim.

O consumo de memória é praticamente o mesmo para um PDF de 5 páginas ou de 5.000.

### Por que o `.docx` fica pequeno

O documento gerado contém apenas texto e um estilo simples. Não há imagens, fontes embutidas
nem camada de imagem por trás do texto. Um PDF escaneado de centenas de MB costuma virar um
`.docx` de poucas centenas de KB.

A conversão roda em um **serviço em primeiro plano** com notificação de progresso, então
documentos longos continuam sendo processados com o app em segundo plano ou a tela desligada.
Dá para cancelar a qualquer momento, pelo app ou pela notificação.

## Instalação no celular

1. Abra a página de **Releases** deste repositório no navegador do celular.
2. Baixe o arquivo `PDF-para-Word.apk` da release `apk`.
3. Toque no arquivo baixado e autorize "instalar apps de fontes desconhecidas" quando o Android pedir.

O APK é gerado automaticamente pelo GitHub Actions a cada push (`.github/workflows/android.yml`)
e sempre assinado com a mesma chave, então atualizações instalam por cima da versão anterior.

> A chave em `keystore/release.jks` não é secreta: serve só para manter a assinatura estável
> entre versões, já que o app não vai para a Play Store.

## Opções na tela inicial

| Opção | O que faz |
| --- | --- |
| Juntar linhas em parágrafos | Reagrupa linhas quebradas pela largura da página e junta palavras hifenizadas no fim da linha |
| Quebra de página a cada página do PDF | Mantém a divisão de páginas no Word |
| Marcar o número da página no texto | Insere um marcador discreto "página N" |
| Forçar OCR em todas as páginas | Ignora a camada de texto do PDF (útil quando o PDF tem texto ruim de OCR anterior) |
| Qualidade do OCR | Rápida (150 dpi), Equilibrada (200 dpi) ou Alta (300 dpi) |

O app também aparece no menu "Abrir com" / "Compartilhar" de qualquer PDF.

## Requisitos

- Android 8.0 (API 26) ou superior.
- Nenhuma permissão de internet: o app não tem `INTERNET` no manifesto, tudo roda no aparelho.

## Compilando localmente

```bash
./gradlew assembleRelease
# APK em app/build/outputs/apk/release/app-release.apk
```

## Estrutura

| Arquivo | Responsabilidade |
| --- | --- |
| `MainActivity.kt` | Tela: seleção do PDF, opções, progresso, salvar/compartilhar |
| `ConversionService.kt` | Serviço em primeiro plano, notificação, cópia do arquivo, cancelamento |
| `PdfToDocxConverter.kt` | Decide texto x OCR por página, rasteriza e controla memória |
| `TextLayout.kt` | Reconstrói parágrafos a partir das linhas soltas |
| `DocxWriter.kt` | Gera o pacote OOXML (`.docx`) em streaming |
