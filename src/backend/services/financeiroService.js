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

// ========================= Contas fixas (recorrentes) =========================

function listarContasFixas() {
  const db = getDb();
  return db.prepare(`
    SELECT cf.*, f.nome AS fornecedor_nome
    FROM contas_fixas cf LEFT JOIN fornecedores f ON f.id = cf.fornecedor_id
    ORDER BY (cf.ativa = 0), cf.dia_vencimento
  `).all();
}

function validarContaFixa(dados) {
  const descricao = (dados.descricao || '').trim();
  if (!descricao) throw new AppError('Informe a descricao da conta fixa.');
  if (!(Number(dados.valor) > 0)) throw new AppError('Informe um valor maior que zero.');
  const dia = Number(dados.dia_vencimento);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new AppError('Informe um dia de vencimento entre 1 e 31.');
  }
  return { descricao, valor: Number(dados.valor), dia_vencimento: dia, fornecedor_id: dados.fornecedor_id || null };
}

function criarContaFixa(dados) {
  const db = getDb();
  const d = validarContaFixa(dados);
  const info = db.prepare(
    'INSERT INTO contas_fixas (descricao, fornecedor_id, valor, dia_vencimento) VALUES (?, ?, ?, ?)'
  ).run(d.descricao, d.fornecedor_id, d.valor, d.dia_vencimento);
  return db.prepare('SELECT * FROM contas_fixas WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarContaFixa(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM contas_fixas WHERE id = ?').get(id);
  if (!atual) throw new AppError('Conta fixa nao encontrada.', 404);
  const d = validarContaFixa({ ...atual, ...dados });
  const ativa = dados.ativa !== undefined ? (dados.ativa ? 1 : 0) : atual.ativa;
  db.prepare('UPDATE contas_fixas SET descricao=?, fornecedor_id=?, valor=?, dia_vencimento=?, ativa=? WHERE id=?')
    .run(d.descricao, d.fornecedor_id, d.valor, d.dia_vencimento, ativa, id);
  return db.prepare('SELECT * FROM contas_fixas WHERE id = ?').get(id);
}

function excluirContaFixa(id) {
  // Nao apaga as contas a pagar ja geradas (historico), so o modelo.
  getDb().prepare('DELETE FROM contas_fixas WHERE id = ?').run(id);
  return { ok: true };
}

function ultimoDiaDoMes(ano, mes) {
  return new Date(ano, mes, 0).getDate(); // mes: 1-12
}

/**
 * Gera as contas a pagar do mes corrente para cada conta fixa ativa que
 * ainda nao tenha uma gerada neste mes. Idempotente: pode ser chamada varias
 * vezes (na inicializacao do app e ao abrir a tela) sem duplicar.
 */
function gerarContasFixasPendentes() {
  const db = getDb();
  const fixas = db.prepare('SELECT * FROM contas_fixas WHERE ativa = 1').all();
  if (!fixas.length) return { geradas: 0 };

  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;
  const aaMm = `${ano}-${String(mes).padStart(2, '0')}`;
  const ultimoDia = ultimoDiaDoMes(ano, mes);

  let geradas = 0;
  const tx = db.transaction(() => {
    const jaTem = db.prepare(
      "SELECT 1 FROM contas_pagar WHERE conta_fixa_id = ? AND strftime('%Y-%m', vencimento) = ?"
    );
    const inserir = db.prepare(
      `INSERT INTO contas_pagar (fornecedor_id, conta_fixa_id, descricao, valor, vencimento, status)
       VALUES (?, ?, ?, ?, ?, 'pendente')`
    );
    for (const f of fixas) {
      if (jaTem.get(f.id, aaMm)) continue;
      const dia = Math.min(Number(f.dia_vencimento), ultimoDia);
      const vencimento = `${aaMm}-${String(dia).padStart(2, '0')}`;
      inserir.run(f.fornecedor_id, f.id, f.descricao, f.valor, vencimento);
      geradas++;
    }
  });
  tx();
  return { geradas };
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
  listarContasFixas, criarContaFixa, atualizarContaFixa, excluirContaFixa, gerarContasFixasPendentes,
};
