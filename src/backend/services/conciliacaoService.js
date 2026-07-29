'use strict';

/**
 * Conciliacao bancaria: importa um extrato OFX para dentro de uma conta
 * financeira do sistema e ajuda a bater cada transacao do banco com uma
 * conta a pagar/receber (dando baixa nela) ou criando um lancamento novo —
 * o extrato bancario vira a fonte de verdade para baixar pagamentos e
 * recebimentos, em vez de fazer isso manualmente um por um.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { parseOFX } = require('./ofxParser');
const { arred } = require('./precificacaoService');

/** Importa um extrato OFX para dentro de uma conta financeira (ignora transacoes ja importadas, pelo FITID). */
function importarExtrato(contaFinanceiraId, buffer) {
  const db = getDb();
  const conta = db.prepare('SELECT * FROM contas_financeiras WHERE id = ?').get(contaFinanceiraId);
  if (!conta) throw new AppError('Conta financeira não encontrada.', 404);

  const transacoes = parseOFX(buffer);

  const jaTem = db.prepare('SELECT 1 FROM extrato_ofx_transacoes WHERE conta_financeira_id = ? AND fitid = ?');
  const inserir = db.prepare(`
    INSERT INTO extrato_ofx_transacoes (conta_financeira_id, fitid, data, valor, tipo, descricao)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let importadas = 0;
  let duplicadas = 0;
  const tx = db.transaction(() => {
    for (const t of transacoes) {
      if (jaTem.get(contaFinanceiraId, t.fitid)) { duplicadas++; continue; }
      inserir.run(contaFinanceiraId, t.fitid, t.data, arred(t.valor), t.tipo, t.descricao);
      importadas++;
    }
  });
  tx();

  return { total: transacoes.length, importadas, duplicadas };
}

function listarTransacoes({ conta_financeira_id, status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (conta_financeira_id) { where.push('t.conta_financeira_id = @conta_financeira_id'); params.conta_financeira_id = Number(conta_financeira_id); }
  if (status) { where.push('t.status = @status'); params.status = status; }
  return db.prepare(`
    SELECT t.*,
      cp.descricao AS pagar_descricao, cr.descricao AS receber_descricao
    FROM extrato_ofx_transacoes t
    LEFT JOIN contas_pagar cp ON cp.id = t.contas_pagar_id
    LEFT JOIN contas_receber cr ON cr.id = t.contas_receber_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (t.status = 'pendente') DESC, t.data DESC
  `).all(params);
}

function obterTransacao(id) {
  const db = getDb();
  const t = db.prepare('SELECT * FROM extrato_ofx_transacoes WHERE id = ?').get(id);
  if (!t) throw new AppError('Transação do extrato não encontrada.', 404);
  return t;
}

/** Sugestoes de conta a pagar/receber pendente com valor igual, ordenadas pela data mais proxima. */
function sugestoes(id) {
  const db = getDb();
  const t = obterTransacao(id);
  const tabela = t.tipo === 'debito' ? 'contas_pagar' : 'contas_receber';
  return db.prepare(`
    SELECT * FROM ${tabela}
    WHERE status = 'pendente' AND ABS(valor - @valor) < 0.01
    ORDER BY ABS(julianday(COALESCE(vencimento, date('now'))) - julianday(@data)) ASC
    LIMIT 5
  `).all({ valor: t.valor, data: t.data });
}

/**
 * Concilia a transacao com uma conta a pagar/receber ja existente. Se ela
 * ainda estiver pendente, da a baixa de verdade (usando a data do extrato e
 * a propria conta financeira de onde ele veio). Se ja estiver paga/recebida
 * (baixada manualmente antes), so vincula — nao baixa de novo.
 */
function conciliarComExistente(id, { tipo, conta_id, forma }) {
  const db = getDb();
  const t = obterTransacao(id);
  if (t.status !== 'pendente') throw new AppError('Esta transação já foi conciliada.');
  if (tipo !== 'pagar' && tipo !== 'receber') throw new AppError('Tipo inválido.');

  // eslint-disable-next-line global-require
  const fin = require('./financeiroService');
  const tx = db.transaction(() => {
    if (tipo === 'pagar') {
      const cp = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(conta_id);
      if (!cp) throw new AppError('Conta a pagar não encontrada.', 404);
      if (Math.abs(Number(cp.valor) - t.valor) > 0.01) throw new AppError('O valor da conta não bate com o da transação.');
      if (cp.status === 'pendente') {
        fin.baixarPagar(conta_id, { data_pagamento: t.data, forma_pagamento: forma || 'transferencia', conta_financeira_id: t.conta_financeira_id });
      }
      db.prepare("UPDATE extrato_ofx_transacoes SET status='conciliada', contas_pagar_id=? WHERE id=?").run(conta_id, id);
    } else {
      const cr = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(conta_id);
      if (!cr) throw new AppError('Conta a receber não encontrada.', 404);
      if (Math.abs(Number(cr.valor) - t.valor) > 0.01) throw new AppError('O valor da conta não bate com o da transação.');
      if (cr.status === 'pendente') {
        fin.baixarReceber(conta_id, { data_recebimento: t.data, forma_recebimento: forma || 'transferencia', conta_financeira_id: t.conta_financeira_id });
      }
      db.prepare("UPDATE extrato_ofx_transacoes SET status='conciliada', contas_receber_id=? WHERE id=?").run(conta_id, id);
    }
  });
  tx();
  return obterTransacao(id);
}

/** Cria um lancamento novo (despesa/receita) ja conciliado com a transacao — para o que nao tinha conta cadastrada antes. */
function conciliarComNovo(id, { tipo, descricao, categoria_despesa_id, fornecedor_id, cliente_id }) {
  const db = getDb();
  const t = obterTransacao(id);
  if (t.status !== 'pendente') throw new AppError('Esta transação já foi conciliada.');
  if (tipo !== 'pagar' && tipo !== 'receber') throw new AppError('Tipo inválido.');
  const desc = (descricao || '').trim() || t.descricao;

  // eslint-disable-next-line global-require
  const fin = require('./financeiroService');
  const tx = db.transaction(() => {
    if (tipo === 'pagar') {
      const cp = fin.criarPagar({ descricao: desc, valor: t.valor, primeiro_vencimento: t.data, fornecedor_id, categoria_despesa_id });
      fin.baixarPagar(cp.id, { data_pagamento: t.data, conta_financeira_id: t.conta_financeira_id });
      db.prepare("UPDATE extrato_ofx_transacoes SET status='conciliada', contas_pagar_id=? WHERE id=?").run(cp.id, id);
    } else {
      const cr = fin.criarReceber({ descricao: desc, valor: t.valor, primeiro_vencimento: t.data, cliente_id });
      fin.baixarReceber(cr.id, { data_recebimento: t.data, conta_financeira_id: t.conta_financeira_id });
      db.prepare("UPDATE extrato_ofx_transacoes SET status='conciliada', contas_receber_id=? WHERE id=?").run(cr.id, id);
    }
  });
  tx();
  return obterTransacao(id);
}

/** Marca a transacao como ignorada (ex.: transferencia entre contas proprias, ja tratada de outra forma). */
function ignorar(id) {
  const db = getDb();
  const t = obterTransacao(id);
  if (t.status !== 'pendente') throw new AppError('Esta transação já foi conciliada.');
  db.prepare("UPDATE extrato_ofx_transacoes SET status='ignorada' WHERE id=?").run(id);
  return obterTransacao(id);
}

/** Desfaz a conciliacao/ignorar (volta para pendente). Nao reverte a baixa feita na conta a pagar/receber. */
function reabrir(id) {
  const db = getDb();
  obterTransacao(id);
  db.prepare("UPDATE extrato_ofx_transacoes SET status='pendente', contas_pagar_id=NULL, contas_receber_id=NULL WHERE id=?").run(id);
  return obterTransacao(id);
}

module.exports = {
  importarExtrato, listarTransacoes, obterTransacao, sugestoes,
  conciliarComExistente, conciliarComNovo, ignorar, reabrir,
};
