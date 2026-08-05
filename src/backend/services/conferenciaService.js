'use strict';

/**
 * Conferência de mercadoria: quando o produto é cadastrado em lote (antes da
 * caixa física chegar), cada item entra numa fila de conferência — além de
 * ir pra Precificação — pra alguém bater, item a item, o que realmente
 * chegou contra o que foi cadastrado no sistema (nome, código, quantidade).
 *
 * Não mexe em estoque: o estoque já foi lançado no cadastro em lote. Isso
 * aqui é só o checklist de recebimento — se a quantidade que chegou for
 * diferente da esperada, quem conferiu anota e resolve o estoque à parte,
 * no cadastro do produto.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

/** Manda um grupo de itens (cadastro em lote ou NF-e) pra fila de conferência. */
function importarProdutos(itens, rotulo) {
  if (!Array.isArray(itens) || !itens.length) return { criados: 0, lote: rotulo };
  const db = getDb();
  const loteData = new Date().toISOString();
  const base = db.prepare('SELECT COALESCE(MAX(ordem),0) o FROM conferencia_mercadoria').get().o;
  const ins = db.prepare(`
    INSERT INTO conferencia_mercadoria
      (produto_id, referencia, descricao, quantidade_esperada, lote, lote_data, ordem)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    itens.forEach((it, i) => ins.run(
      it.produto_id || null,
      it.referencia || null,
      (it.descricao || 'Produto').toString(),
      Number(it.quantidade || 1),
      rotulo,
      loteData,
      base + i + 1
    ));
  });
  tx();
  return { criados: itens.length, lote: rotulo };
}

/** Lotes com pendência, mais recentes primeiro, com o progresso de cada um. */
function listarLotes() {
  const db = getDb();
  return db.prepare(`
    SELECT lote, MAX(lote_data) AS lote_data, COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN conferido = 1 THEN 1 ELSE 0 END),0) AS conferidos,
      COALESCE(SUM(CASE WHEN conferido = 1 AND quantidade_conferida <> quantidade_esperada THEN 1 ELSE 0 END),0) AS divergentes
    FROM conferencia_mercadoria
    WHERE lote IS NOT NULL
    GROUP BY lote
    ORDER BY MAX(lote_data) DESC
  `).all();
}

function listar({ lote } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (lote) { where.push('cm.lote = @lote'); params.lote = lote; }
  return db.prepare(`
    SELECT cm.*, p.codigo_barras AS produto_codigo_barras
    FROM conferencia_mercadoria cm
    LEFT JOIN produtos p ON p.id = cm.produto_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (cm.lote_data IS NULL), cm.lote_data DESC, cm.ordem, cm.id
  `).all(params);
}

/** Marca um item como conferido, com a quantidade que de fato chegou. */
function conferirItem(id, { quantidade_conferida, observacao } = {}) {
  const db = getDb();
  const item = db.prepare('SELECT * FROM conferencia_mercadoria WHERE id = ?').get(id);
  if (!item) throw new AppError('Item de conferência não encontrado.', 404);
  const qtd = quantidade_conferida != null && quantidade_conferida !== ''
    ? Number(quantidade_conferida)
    : Number(item.quantidade_esperada);
  if (Number.isNaN(qtd) || qtd < 0) throw new AppError('Informe uma quantidade conferida válida.');
  db.prepare(`
    UPDATE conferencia_mercadoria SET conferido = 1, quantidade_conferida = ?, observacao = ?
    WHERE id = ?
  `).run(qtd, (observacao || '').trim() || null, id);
  return db.prepare('SELECT * FROM conferencia_mercadoria WHERE id = ?').get(id);
}

/** Desfaz a conferência (item volta pra pendente), se marcou errado. */
function reabrirItem(id) {
  const db = getDb();
  const info = db.prepare('UPDATE conferencia_mercadoria SET conferido = 0 WHERE id = ?').run(id);
  if (!info.changes) throw new AppError('Item de conferência não encontrado.', 404);
  return db.prepare('SELECT * FROM conferencia_mercadoria WHERE id = ?').get(id);
}

/** Remove um lote inteiro da fila (a mercadoria já foi conferida por completo, por exemplo). */
function excluirLote(lote) {
  const info = getDb().prepare('DELETE FROM conferencia_mercadoria WHERE lote = ?').run(lote);
  return { excluidos: info.changes };
}

function excluirItem(id) {
  getDb().prepare('DELETE FROM conferencia_mercadoria WHERE id = ?').run(id);
}

module.exports = {
  importarProdutos, listarLotes, listar, conferirItem, reabrirItem, excluirLote, excluirItem,
};
