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

/**
 * Simula precificacao. Recebe { custo, markup?, margem?, preco? } e devolve
 * todos os indicadores coerentes. Prioridade: preco > margem > markup.
 */
function simular({ custo, markup, margem, preco }) {
  const c = Number(custo || 0);
  let p;
  if (preco != null && preco !== '') {
    p = Number(preco);
  } else if (margem != null && margem !== '') {
    const m = Number(margem);
    // preco tal que margem = (preco-custo)/preco  ->  preco = custo / (1 - m/100)
    p = m >= 100 ? 0 : arred(c / (1 - m / 100));
  } else {
    const mk = Number(markup || 0);
    p = precoPorMarkup(c, mk);
  }
  return {
    custo: arred(c),
    preco: arred(p),
    markup: markupPorPreco(c, p),
    margem: margemPorPreco(c, p),
    lucro: arred(p - c),
  };
}

/**
 * Monta a lista de produtos afetados por um reajuste em lote, com preco atual
 * e preco novo (nao aplica). filtro = { categoria_id?, fornecedor_id?,
 * percentual, base:'preco_venda'|'custo' }.
 */
function previewReajuste(filtro) {
  const { getDb } = require('../db/connection');
  const db = getDb();
  const perc = Number(filtro.percentual);
  if (Number.isNaN(perc)) throw new (require('../utils/errors').AppError)('Informe o percentual de reajuste.');
  const base = filtro.base === 'custo' ? 'custo' : 'preco_venda';

  const where = ['ativo = 1'];
  const params = {};
  if (filtro.categoria_id) { where.push('categoria_id = @categoria_id'); params.categoria_id = Number(filtro.categoria_id); }
  if (filtro.fornecedor_id) { where.push('fornecedor_id = @fornecedor_id'); params.fornecedor_id = Number(filtro.fornecedor_id); }

  const produtos = db.prepare(
    `SELECT id, nome, custo, preco_venda FROM produtos WHERE ${where.join(' AND ')} ORDER BY nome COLLATE NOCASE`
  ).all(params);

  return produtos.map((p) => {
    const valorBase = base === 'custo' ? Number(p.custo) : Number(p.preco_venda);
    const novo = arred(valorBase * (1 + perc / 100));
    return {
      id: p.id, nome: p.nome, custo: p.custo,
      preco_atual: p.preco_venda, preco_novo: novo,
      margem_nova: margemPorPreco(p.custo, novo),
    };
  });
}

/** Aplica o reajuste em lote (transacao). Retorna a quantidade atualizada. */
function aplicarReajuste(filtro) {
  const { getDb } = require('../db/connection');
  const db = getDb();
  const itens = previewReajuste(filtro);
  const upd = db.prepare("UPDATE produtos SET preco_venda = ?, atualizado_em = datetime('now','localtime') WHERE id = ?");
  const tx = db.transaction(() => { itens.forEach((i) => upd.run(i.preco_novo, i.id)); });
  tx();
  return { atualizados: itens.length };
}

module.exports = {
  arred,
  precoPorMarkup,
  margemPorPreco,
  markupPorPreco,
  markupEfetivo,
  simular,
  previewReajuste,
  aplicarReajuste,
};
