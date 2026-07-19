'use strict';

const { getDb } = require('../db/connection');

/**
 * Utilitarios de precificacao reutilizados por varios modulos.
 */

function arred(n) {
  return Number(Number(n || 0).toFixed(2));
}

/** Preco de venda a partir do custo e markup (%). */
function precoPorMarkup(custo, markupPercent) {
  return arred(Number(custo) * (1 + Number(markupPercent) / 100));
}

/** Margem (%) resultante de um custo e um preco de venda. */
function margemPorPreco(custo, preco) {
  const p = Number(preco);
  if (!(p > 0)) return 0;
  return arred(((p - Number(custo)) / p) * 100);
}

/** Markup (%) resultante de um custo e um preco de venda. */
function markupPorPreco(custo, preco) {
  const c = Number(custo);
  if (!(c > 0)) return 0;
  return arred(((Number(preco) - c) / c) * 100);
}

/**
 * Determina o markup efetivo para um produto: usa o markup do proprio produto,
 * senao o da categoria, senao o padrao global de config.
 */
function markupEfetivo({ markupProduto, categoriaId }) {
  if (markupProduto != null && markupProduto !== '') return Number(markupProduto);

  const db = getDb();
  if (categoriaId) {
    const cat = db.prepare('SELECT markup_padrao FROM categorias WHERE id = ?').get(categoriaId);
    if (cat && cat.markup_padrao != null) return Number(cat.markup_padrao);
  }
  const cfg = db.prepare("SELECT valor FROM config WHERE chave = 'markup_padrao'").get();
  return cfg ? Number(cfg.valor) : 100;
}

module.exports = {
  arred,
  precoPorMarkup,
  margemPorPreco,
  markupPorPreco,
  markupEfetivo,
};
