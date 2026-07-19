'use strict';

const { AppError } = require('../utils/errors');

/**
 * Registra uma movimentacao de estoque e atualiza o saldo do produto de forma
 * atomica. DEVE ser chamada dentro de uma transacao (recebe o `db` ativo).
 *
 * @param {object} db  conexao better-sqlite3 (ou transacao ativa)
 * @param {object} mov { produto_id, tipo:'entrada'|'saida', quantidade,
 *                       custo_unitario?, origem, referencia_id?, observacao? }
 * @returns {number} saldo do produto apos a movimentacao
 */
function registrarMovimentacao(db, mov) {
  const {
    produto_id,
    tipo,
    quantidade,
    custo_unitario = null,
    origem,
    referencia_id = null,
    observacao = null,
  } = mov;

  if (tipo !== 'entrada' && tipo !== 'saida') {
    throw new AppError('Tipo de movimentacao invalido.');
  }
  const qtd = Number(quantidade);
  if (!(qtd > 0)) {
    throw new AppError('A quantidade da movimentacao deve ser maior que zero.');
  }

  const prod = db.prepare('SELECT estoque_atual FROM produtos WHERE id = ?').get(produto_id);
  if (!prod) throw new AppError('Produto nao encontrado.', 404);

  const delta = tipo === 'entrada' ? qtd : -qtd;
  const saldo = Number((Number(prod.estoque_atual) + delta).toFixed(3));

  db.prepare(
    "UPDATE produtos SET estoque_atual = ?, atualizado_em = datetime('now','localtime') WHERE id = ?"
  ).run(saldo, produto_id);

  db.prepare(
    `INSERT INTO movimentacoes_estoque
       (produto_id, tipo, quantidade, custo_unitario, estoque_apos, origem, referencia_id, observacao)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(produto_id, tipo, qtd, custo_unitario, saldo, origem, referencia_id, observacao);

  return saldo;
}

module.exports = { registrarMovimentacao };
