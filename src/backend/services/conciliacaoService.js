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

function normalizarTexto(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// ------------------------- Regras de conciliação -------------------------

function listarRegras() {
  const db = getDb();
  return db.prepare(`
    SELECT r.*, cd.nome AS categoria_nome, f.nome AS fornecedor_nome, c.nome AS cliente_nome
    FROM regras_conciliacao r
    LEFT JOIN categorias_despesa cd ON cd.id = r.categoria_despesa_id
    LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
    LEFT JOIN clientes c ON c.id = r.cliente_id
    ORDER BY (r.ativa = 0), r.ordem, r.id
  `).all();
}

function validarRegra(dados) {
  const padrao = (dados.padrao || '').trim();
  if (!padrao) throw new AppError('Informe o termo que a regra deve procurar na descrição.');
  const tipo = dados.tipo === 'receber' ? 'receber' : 'pagar';
  return {
    padrao,
    tipo,
    categoria_despesa_id: tipo === 'pagar' && dados.categoria_despesa_id ? Number(dados.categoria_despesa_id) : null,
    fornecedor_id: tipo === 'pagar' && dados.fornecedor_id ? Number(dados.fornecedor_id) : null,
    cliente_id: tipo === 'receber' && dados.cliente_id ? Number(dados.cliente_id) : null,
    descricao_lancamento: (dados.descricao_lancamento || '').trim() || null,
  };
}

function criarRegra(dados) {
  const db = getDb();
  const d = validarRegra(dados);
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem),-1)+1 o FROM regras_conciliacao').get().o;
  const info = db.prepare(`
    INSERT INTO regras_conciliacao (padrao, tipo, categoria_despesa_id, fornecedor_id, cliente_id, descricao_lancamento, ordem)
    VALUES (@padrao, @tipo, @categoria_despesa_id, @fornecedor_id, @cliente_id, @descricao_lancamento, @ordem)
  `).run({ ...d, ordem });
  return db.prepare('SELECT * FROM regras_conciliacao WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarRegra(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM regras_conciliacao WHERE id = ?').get(id);
  if (!atual) throw new AppError('Regra não encontrada.', 404);
  const d = validarRegra({ ...atual, ...dados });
  const ativa = dados.ativa !== undefined ? (dados.ativa ? 1 : 0) : atual.ativa;
  db.prepare(`
    UPDATE regras_conciliacao SET padrao=@padrao, tipo=@tipo, categoria_despesa_id=@categoria_despesa_id,
      fornecedor_id=@fornecedor_id, cliente_id=@cliente_id, descricao_lancamento=@descricao_lancamento, ativa=@ativa
    WHERE id=@id
  `).run({ ...d, ativa, id });
  return db.prepare('SELECT * FROM regras_conciliacao WHERE id = ?').get(id);
}

function excluirRegra(id) {
  getDb().prepare('DELETE FROM regras_conciliacao WHERE id = ?').run(id);
  return { ok: true };
}

/** Acha a primeira regra ativa (na ordem) cujo termo aparece na descricao, para o tipo certo. */
function casarRegra(db, descricao, tipo) {
  if (!descricao) return null;
  const normalizada = normalizarTexto(descricao);
  const regras = db.prepare('SELECT * FROM regras_conciliacao WHERE ativa = 1 AND tipo = ? ORDER BY ordem, id').all(tipo);
  for (const r of regras) {
    const termos = r.padrao.split(',').map((t) => normalizarTexto(t)).filter(Boolean);
    if (termos.some((t) => normalizada.includes(t))) return r;
  }
  return null;
}

/**
 * Aplica as regras cadastradas às transações ainda pendentes de uma conta
 * financeira: para cada uma sem nenhuma conta a pagar/receber pendente
 * correspondente (sem "sugestão"), tenta casar com uma regra e, se achar,
 * já cria e baixa o lançamento automaticamente.
 */
function aplicarRegrasPendentes(contaFinanceiraId) {
  const db = getDb();
  const pendentes = db.prepare("SELECT * FROM extrato_ofx_transacoes WHERE conta_financeira_id = ? AND status = 'pendente'").all(contaFinanceiraId);
  let aplicadas = 0;
  for (const t of pendentes) {
    const tipo = t.tipo === 'debito' ? 'pagar' : 'receber';
    if (sugestoes(t.id).length > 0) continue; // ja tem conta pendente que bate melhor — deixa para conciliacao manual
    const regra = casarRegra(db, t.descricao, tipo);
    if (!regra) continue;
    conciliarComNovo(t.id, {
      tipo,
      descricao: regra.descricao_lancamento || t.descricao,
      categoria_despesa_id: regra.categoria_despesa_id,
      fornecedor_id: regra.fornecedor_id,
      cliente_id: regra.cliente_id,
      regraId: regra.id,
    });
    aplicadas++;
  }
  return { aplicadas };
}

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

  const { aplicadas: autoConciliadas } = aplicarRegrasPendentes(contaFinanceiraId);

  return { total: transacoes.length, importadas, duplicadas, autoConciliadas };
}

function listarTransacoes({ conta_financeira_id, status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (conta_financeira_id) { where.push('t.conta_financeira_id = @conta_financeira_id'); params.conta_financeira_id = Number(conta_financeira_id); }
  if (status) { where.push('t.status = @status'); params.status = status; }
  return db.prepare(`
    SELECT t.*,
      cp.descricao AS pagar_descricao, cr.descricao AS receber_descricao, r.padrao AS regra_padrao
    FROM extrato_ofx_transacoes t
    LEFT JOIN contas_pagar cp ON cp.id = t.contas_pagar_id
    LEFT JOIN contas_receber cr ON cr.id = t.contas_receber_id
    LEFT JOIN regras_conciliacao r ON r.id = t.regra_id
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
 * Busca manual de contas a pagar/receber para conciliar (quando a sugestao
 * automatica por valor nao acha, ou o usuario quer escolher outra). Traz
 * tanto pendentes (pra dar baixa junto) quanto ja pagas/recebidas (pra so
 * amarrar com o extrato, sem lancar de novo).
 */
function buscarContas(id, { termo, status } = {}) {
  const db = getDb();
  const t = obterTransacao(id);
  const tabela = t.tipo === 'debito' ? 'contas_pagar' : 'contas_receber';
  const dataCol = t.tipo === 'debito' ? 'data_pagamento' : 'data_recebimento';
  const nomeJoin = t.tipo === 'debito'
    ? 'LEFT JOIN fornecedores j ON j.id = x.fornecedor_id'
    : 'LEFT JOIN clientes j ON j.id = x.cliente_id';

  const where = ["x.status != 'cancelada'"];
  const params = {};
  if (status === 'pendente' || status === 'pago') {
    where.push('x.status = @status');
    params.status = status === 'pago' ? (t.tipo === 'debito' ? 'pago' : 'recebido') : 'pendente';
  }
  if (termo) { where.push('x.descricao LIKE @termo'); params.termo = `%${termo}%`; }

  return db.prepare(`
    SELECT x.*, j.nome AS contraparte_nome
    FROM ${tabela} x
    ${nomeJoin}
    WHERE ${where.join(' AND ')}
    ORDER BY (x.status = 'pendente') DESC, date(COALESCE(x.vencimento, x.${dataCol})) DESC
    LIMIT 30
  `).all(params);
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
function conciliarComNovo(id, { tipo, descricao, categoria_despesa_id, fornecedor_id, cliente_id, regraId }) {
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
      db.prepare("UPDATE extrato_ofx_transacoes SET status='conciliada', contas_pagar_id=?, regra_id=? WHERE id=?").run(cp.id, regraId || null, id);
    } else {
      const cr = fin.criarReceber({ descricao: desc, valor: t.valor, primeiro_vencimento: t.data, cliente_id });
      fin.baixarReceber(cr.id, { data_recebimento: t.data, conta_financeira_id: t.conta_financeira_id });
      db.prepare("UPDATE extrato_ofx_transacoes SET status='conciliada', contas_receber_id=?, regra_id=? WHERE id=?").run(cr.id, regraId || null, id);
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
  db.prepare("UPDATE extrato_ofx_transacoes SET status='pendente', contas_pagar_id=NULL, contas_receber_id=NULL, regra_id=NULL WHERE id=?").run(id);
  return obterTransacao(id);
}

module.exports = {
  importarExtrato, listarTransacoes, obterTransacao, sugestoes, buscarContas,
  conciliarComExistente, conciliarComNovo, ignorar, reabrir,
  listarRegras, criarRegra, atualizarRegra, excluirRegra, aplicarRegrasPendentes,
};
