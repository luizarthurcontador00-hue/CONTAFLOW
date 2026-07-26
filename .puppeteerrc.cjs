const { join } = require('path');

// Faz o Puppeteer baixar/procurar o Chromium dentro da pasta do projeto
// (em vez do cache global do usuario), para que o electron-builder consiga
// empacotar o navegador junto com o instalador do Gestor de Vendas.
module.exports = {
  cacheDirectory: join(__dirname, 'puppeteer-cache'),
};
