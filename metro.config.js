const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// O pdf.js é embarcado como asset de texto (ver scripts/prepare-pdfjs.mjs) para
// ser injetado dentro da WebView que faz a extração de texto dos PDFs.
// A extensão `.pdfjsbundle` evita que o Metro tente tratar o arquivo como código
// fonte do app.
config.resolver.assetExts = [...config.resolver.assetExts, 'pdfjsbundle'];

module.exports = config;
