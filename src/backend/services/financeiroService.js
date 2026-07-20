'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');

const hoje = () => new Date().toISOString().slice(0, 10);

/** Soma N meses a uma data 'YYYY-MM-DD' preservando o dia quando possivel. */
function somarMeses(dataISO, meses) {
  const [a, m, d] = dataISO.split('-').map(Number);
  const base = new Date(a, m - 1 + meses, d);
  return base.toISOString().slice(0, 10);
}

// =========================== Contas a pagar ===========================

function listarPagar({ status, inicio, fim } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('cp.status = @status'); params.status = status; }
  if (inicio) { where.push('date(cp.vencimento) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(cp.vencimento) <= date(@fim)'); params.fim = fim; }
  return db.prepare(`
    SELECT cp.*, f.nome AS fornecedor_nome
    FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (cp.status='pago'), date(cp.vencimento)
  `).all(params);
}

function criarPagar(dados) {
  const db = getDb();
  const descricao = (dados.descricao || '').trim();
  if (!descricao) throw new AppError('Informe a descricao da conta.');
  if (!(Number(dados.valor) > 0)) throw new AppError('Informe um valor maior que zero.');
  const info = db.prepare(
    `INSERT INTO contas_pagar (fornecedor_id, descricao, valor, vencimento, status, forma_pagamento)
     VALUES (?, ?, ?, ?, 'pendente', ?)`
  ).run(dados.fornecedor_id || null, descricao, Number(dados.valor), dados.vencimento || null, dados.forma_pagamento || null);
  return db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(info.lastInsertRowid);
}

function baixarPagar(id, { data_pagamento, forma_pagamento } = {}) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
  if (!c) throw new AppError('Conta nao encontrada.', 404);
  if (c.status === 'pago') throw new AppError('Esta conta ja foi paga.');
  db.prepare("UPDATE contas_pagar SET status='pago', data_pagamento=?, forma_pagamento=COALESCE(?, forma_pagamento) WHERE id=?")
    .run(data_pagamento || hoje(), forma_pagamento || null, id);
  return db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
}

function reabrirPagar(id) {
  const db = getDb();
  db.prepare("UPDATE contas_pagar SET status='pendente', data_pagamento=NULL WHERE id=?").run(id);
  return db.prepare('SELECT * FROM contas_pagar WHERE id = ?').get(id);
}

function excluirPagar(id) {
  getDb().prepare('DELETE FROM contas_pagar WHERE id = ?').run(id);
  return { ok: true };
}

// ========================== Contas a receber ==========================

function listarReceber({ status, inicio, fim } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('cr.status = @status'); params.status = status; }
  if (inicio) { where.push('date(cr.vencimento) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(cr.vencimento) <= date(@fim)'); params.fim = fim; }
  return db.prepare(`
    SELECT cr.*, c.nome AS cliente_nome FROM contas_receber cr
    LEFT JOIN clientes c ON c.id = cr.cliente_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (cr.status!='pendente'), date(cr.vencimento)
  `).all(params);
}

/**
 * Cria conta a receber, com parcelamento opcional.
 * dados = { descricao, valor, parcelas?, primeiro_vencimento?, venda_id? }
 */
function criarReceber(dados) {
  const db = getDb();
  const descricao = (dados.descricao || '').trim();
  if (!descricao) throw new AppError('Informe a descricao.');
  const valor = Number(dados.valor);
  if (!(valor > 0)) throw new AppError('Informe um valor maior que zero.');
  const parcelas = Math.max(1, Number(dados.parcelas || 1));
  const primeiro = dados.primeiro_vencimento || hoje();

  const valorParcela = arred(valor / parcelas);
  const ins = db.prepare(
    `INSERT INTO contas_receber (venda_id, descricao, valor, parcela, total_parcelas, vencimento, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pendente')`
  );
  const tx = db.transaction(() => {
    let acumulado = 0;
    for (let i = 1; i <= parcelas; i++) {
      // Ultima parcela ajusta a diferenca de arredondamento.
      const v = i === parcelas ? arred(valor - acumulado) : valorParcela;
      acumulado = arred(acumulado + v);
      const venc = somarMeses(primeiro, i - 1);
      const desc = parcelas > 1 ? `${descricao} (${i}/${parcelas})` : descricao;
      ins.run(dados.venda_id || null, desc, v, i, parcelas, venc);
    }
  });
  tx();
  return { criadas: parcelas };
}

function baixarReceber(id, { data_recebimento, forma_recebimento } = {}) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(id);
  if (!c) throw new AppError('Conta nao encontrada.', 404);
  if (c.status === 'recebido') throw new AppError('Esta conta ja foi recebida.');
  if (c.status === 'cancelada') throw new AppError('Esta conta esta cancelada.');
  db.prepare("UPDATE contas_receber SET status='recebido', data_recebimento=?, forma_recebimento=? WHERE id=?")
    .run(data_recebimento || hoje(), forma_recebimento || null, id);
  return db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(id);
}

function reabrirReceber(id) {
  const db = getDb();
  db.prepare("UPDATE contas_receber SET status='pendente', data_recebimento=NULL WHERE id=?").run(id);
  return db.prepare('SELECT * FROM contas_receber WHERE id = ?').get(id);
}

function excluirReceber(id) {
  getDb().prepare('DELETE FROM contas_receber WHERE id = ?').run(id);
  return { ok: true };
}

// ============================== Alertas ==============================

function alertas({ dias = 7 } = {}) {
  const db = getDb();
  const limite = somarDias(hoje(), Number(dias));
  const q = (tabela, dataCol) => ({
    vencidas: db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM ${tabela} WHERE status='pendente' AND date(${dataCol}) < date(?)`).get(hoje()),
    aVencer: db.prepare(`SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM ${tabela} WHERE status='pendente' AND date(${dataCol}) >= date(?) AND date(${dataCol}) <= date(?)`).get(hoje(), limite),
  });
  return { pagar: q('contas_pagar', 'vencimento'), receber: q('contas_receber', 'vencimento') };
}

function somarDias(dataISO, dias) {
  const d = new Date(dataISO + 'T00:00:00');
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

// =========================== Fluxo de caixa ===========================

/**
 * Fluxo de caixa realizado por periodo:
 *  - Entradas: pagamentos NAO a prazo de vendas concluidas (data da venda) +
 *              contas a receber recebidas (data de recebimento)
 *  - Saidas:   contas a pagar pagas (data de pagamento)
 */
function fluxoCaixa({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';

  const vendasVista = db.prepare(`
    SELECT COALESCE(SUM(vp.valor),0) AS total
    FROM vendas_pagamentos vp JOIN vendas v ON v.id = vp.venda_id
    WHERE v.status='concluida' AND vp.forma_pagamento <> 'prazo'
      AND date(v.data) BETWEEN date(?) AND date(?)
  `).get(ini, f).total;

  const recebimentos = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS total FROM contas_receber
    WHERE status='recebido' AND date(data_recebimento) BETWEEN date(?) AND date(?)
  `).get(ini, f).total;

  const pagamentos = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS total FROM contas_pagar
    WHERE status='pago' AND date(data_pagamento) BETWEEN date(?) AND date(?)
  `).get(ini, f).total;

  const entradas = arred(Number(vendasVista) + Number(recebimentos));
  const saidas = arred(Number(pagamentos));
  return {
    entradas,
    saidas,
    saldo: arred(entradas - saidas),
    detalhe: {
      vendas_a_vista: arred(vendasVista),
      recebimentos: arred(recebimentos),
      pagamentos: arred(pagamentos),
    },
  };
}

module.exports = {
  listarPagar, criarPagar, baixarPagar, reabrirPagar, excluirPagar,
  listarReceber, criarReceber, baixarReceber, reabrirReceber, excluirReceber,
  alertas, fluxoCaixa,
};
