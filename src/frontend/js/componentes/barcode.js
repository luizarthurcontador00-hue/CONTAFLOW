'use strict';

/**
 * Gerador de codigo de barras EAN-13 em SVG puro (sem dependencias externas,
 * funciona offline). Tabelas L/G/R e padrao de paridade sao os definidos pela
 * especificacao EAN-13/UPC (mesmas usadas nos codigos de barras de fabrica).
 */
window.Barcode = (function () {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const PARIDADE = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  function bitsEan13(codigo13) {
    const d = codigo13.split('').map(Number);
    const par = PARIDADE[d[0]];
    let bits = '101';
    for (let j = 0; j < 6; j++) bits += (par[j] === 'L' ? L[d[j + 1]] : G[d[j + 1]]);
    bits += '01010';
    for (let j = 0; j < 6; j++) bits += R[d[j + 7]];
    bits += '101';
    return bits; // 95 modulos
  }

  /**
   * Gera o SVG do codigo de barras. `codigo` deve ter 13 digitos (o backend
   * garante isso ao preparar as etiquetas). Retorna uma string SVG.
   */
  function ean13SVG(codigo, opts = {}) {
    const largura = opts.largura || 160;
    const altura = opts.altura || 50;
    const mostrarTexto = opts.mostrarTexto !== false;
    const digitos = String(codigo).replace(/\D/g, '').padStart(13, '0').slice(0, 13);
    const bits = bitsEan13(digitos);
    const moduleW = largura / bits.length;

    let barras = '';
    let x = 0;
    for (const bit of bits) {
      if (bit === '1') {
        barras += `<rect x="${x.toFixed(2)}" y="0" width="${moduleW.toFixed(3)}" height="${altura}" fill="#000"/>`;
      }
      x += moduleW;
    }

    const totalAltura = altura + (mostrarTexto ? 14 : 0);
    const texto = mostrarTexto
      ? `<text x="${largura / 2}" y="${altura + 11}" font-size="11" text-anchor="middle" font-family="monospace" fill="#000">${digitos}</text>`
      : '';
    return `<svg viewBox="0 0 ${largura} ${totalAltura}" width="${largura}" height="${totalAltura}" xmlns="http://www.w3.org/2000/svg">${barras}${texto}</svg>`;
  }

  return { ean13SVG };
})();
