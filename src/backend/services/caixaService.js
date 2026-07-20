'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');

function caixaAberto() {
  const db = getDb();
  return db.prepare("SELECT * FROM caixa WHERE status = 'aberto' ORDER BY id DESC LIMIT 1").get() || null;
}

function abrir({ valor_abertura = 0, observacao } = {}) {
  const db = getDb();
  if (caixaAberto()) throw new AppError('Ja existe um caixa aberto. Feche-o antes de abrir outro.');
  const info = db.prepare(
    'INSERT INTO caixa (valor_abertura, observacao, status) VALUES (?, ?, \'aberto\')'
  ).run(Number(valor_abertura || 0), observacao || null);
  return obter(info.lastInsertRowid);
}

function movimentar(caixa_id, { tipo, valor, motivo }) {
  const db = getDb();
  const caixa = db.prepare('SELECT * FROM caixa WHERE id = ?').get(caixa_id);
  if (!caixa) throw new AppError('Caixa nao encontrado.', 404);
  if (caixa.status !== 'aberto') throw new AppError('O caixa esta fechado.');
  if (tipo !== 'sangria' && tipo !== 'suprimento') throw new AppError('Tipo de movimento invalido.');
  if (!(Number(valor) > 0)) throw new AppError('O valor deve ser maior que zero.');
  db.prepare('INSERT INTO caixa_movimentos (caixa_id, tipo, valor, motivo) VALUES (?, ?, ?, ?)')
    .run(caixa_id, tipo, Number(valor), motivo || null);
  return obter(caixa_id);
}

/** Calcula o valor esperado em dinheiro no caixa. */
function calcularEsperado(caixa_id) {
  const db = getDb();
  const caixa = db.prepare('SELECT * FROM caixa WHERE id = ?').get(caixa_id);
  if (!caixa) throw new AppError('Caixa nao encontrado.', 404);

  const vendasDinheiro = db.prepare(`
    SELECT COALESCE(SUM(vp.valor),0) AS total
    FROM vendas_pagamentos vp
    JOIN vendas v ON v.id = vp.venda_id
    WHERE v.caixa_id = ? AND v.status = 'concluida' AND vp.forma_pagamento = 'dinheiro'
  `).get(caixa_id).total;

  const sup = db.prepare("SELECT COALESCE(SUM(valor),0) s FROM caixa_movimentos WHERE caixa_id = ? AND tipo = 'suprimento'").get(caixa_id).s;
  const san = db.prepare("SELECT COALESCE(SUM(valor),0) s FROM caixa_movimentos WHERE caixa_id = ? AND tipo = 'sangria'").get(caixa_id).s;

  return arred(Number(caixa.valor_abertura) + Number(vendasDinheiro) + Number(sup) - Number(san));
}

function fechar(caixa_id, { valor_fechamento = 0, observacao } = {}) {
  const db = getDb();
  const caixa = db.prepare('SELECT * FROM caixa WHERE id = ?').get(caixa_id);
  if (!caixa) throw new AppError('Caixa nao encontrado.', 404);
  if (caixa.status !== 'aberto') throw new AppError('O caixa ja esta fechado.');

  const esperado = calcularEsperado(caixa_id);
  const contado = Number(valor_fechamento || 0);
  const diferenca = arred(contado - esperado);

  db.prepare(
    `UPDATE caixa SET status='fechado', data_fechamento=datetime('now','localtime'),
      valor_fechamento=?, valor_esperado=?, diferenca=?,
      observacao = COALESCE(observacao,'') || ?
     WHERE id = ?`
  ).run(contado, esperado, diferenca, observacao ? ' | ' + observacao : '', caixa_id);

  return obter(caixa_id);
}

function obter(caixa_id) {
  const db = getDb();
  const caixa = db.prepare('SELECT * FROM caixa WHERE id = ?').get(caixa_id);
  if (!caixa) throw new AppError('Caixa nao encontrado.', 404);
  caixa.movimentos = db.prepare('SELECT * FROM caixa_movimentos WHERE caixa_id = ? ORDER BY id').all(caixa_id);
  caixa.resumo = resumo(caixa_id);
  return caixa;
}

function resumo(caixa_id) {
  const db = getDb();
  const porForma = db.prepare(`
    SELECT vp.forma_pagamento AS forma, COALESCE(SUM(vp.valor),0) AS total
    FROM vendas_pagamentos vp JOIN vendas v ON v.id = vp.venda_id
    WHERE v.caixa_id = ? AND v.status = 'concluida'
    GROUP BY vp.forma_pagamento
  `).all(caixa_id);
  const qtdVendas = db.prepare("SELECT COUNT(*) c FROM vendas WHERE caixa_id = ? AND status='concluida'").get(caixa_id).c;
  const sup = db.prepare("SELECT COALESCE(SUM(valor),0) s FROM caixa_movimentos WHERE caixa_id = ? AND tipo='suprimento'").get(caixa_id).s;
  const san = db.prepare("SELECT COALESCE(SUM(valor),0) s FROM caixa_movimentos WHERE caixa_id = ? AND tipo='sangria'").get(caixa_id).s;
  const totalVendas = porForma.reduce((s, f) => s + Number(f.total), 0);
  return {
    qtd_vendas: qtdVendas,
    total_vendas: arred(totalVendas),
    por_forma: porForma,
    suprimentos: arred(sup),
    sangrias: arred(san),
    esperado_dinheiro: calcularEsperado(caixa_id),
  };
}

function historico() {
  const db = getDb();
  return db.prepare('SELECT * FROM caixa ORDER BY id DESC LIMIT 100').all();
}

module.exports = {
  caixaAberto,
  abrir,
  movimentar,
  fechar,
  obter,
  resumo,
  historico,
};
