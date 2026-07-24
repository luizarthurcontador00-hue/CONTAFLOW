'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');

const STATUS = ['agendado', 'confirmado', 'atendido', 'cancelado', 'faltou'];

// ----------------------------- Profissionais -----------------------------

function listarProfissionais({ incluir_inativos } = {}) {
  return getDb().prepare(
    `SELECT * FROM profissionais ${incluir_inativos ? '' : 'WHERE ativo = 1'} ORDER BY (ativo=0), nome COLLATE NOCASE`
  ).all();
}

function criarProfissional(dados) {
  const db = getDb();
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome do profissional.');
  const info = db.prepare(
    'INSERT INTO profissionais (nome, telefone, cor, comissao_pct) VALUES (?, ?, ?, ?)'
  ).run(nome, dados.telefone || null, dados.cor || '#2563eb', Number(dados.comissao_pct || 0));
  return db.prepare('SELECT * FROM profissionais WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarProfissional(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM profissionais WHERE id = ?').get(id);
  if (!atual) throw new AppError('Profissional nao encontrado.', 404);
  const nome = dados.nome !== undefined ? (dados.nome || '').trim() : atual.nome;
  if (!nome) throw new AppError('Informe o nome do profissional.');
  db.prepare('UPDATE profissionais SET nome=?, telefone=?, cor=?, comissao_pct=?, ativo=? WHERE id=?').run(
    nome,
    dados.telefone !== undefined ? dados.telefone : atual.telefone,
    dados.cor !== undefined ? dados.cor : atual.cor,
    dados.comissao_pct !== undefined ? Number(dados.comissao_pct || 0) : atual.comissao_pct,
    dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo,
    id
  );
  return db.prepare('SELECT * FROM profissionais WHERE id = ?').get(id);
}

function excluirProfissional(id) {
  const db = getDb();
  const temAgenda = db.prepare('SELECT 1 FROM agendamentos WHERE profissional_id = ? LIMIT 1').get(id);
  if (temAgenda) {
    db.prepare('UPDATE profissionais SET ativo = 0 WHERE id = ?').run(id);
    return { inativado: true };
  }
  db.prepare('DELETE FROM profissionais WHERE id = ?').run(id);
  return { excluido: true };
}

// ------------------------------ Agendamentos ------------------------------

function listar({ data, inicio, fim, profissional_id, status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (data) { where.push('a.data = @data'); params.data = data; }
  if (inicio) { where.push('date(a.data) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(a.data) <= date(@fim)'); params.fim = fim; }
  if (profissional_id) { where.push('a.profissional_id = @prof'); params.prof = Number(profissional_id); }
  if (status) { where.push('a.status = @status'); params.status = status; }
  return db.prepare(`
    SELECT a.*, c.nome AS cliente_cadastro, c.telefone AS cliente_telefone,
           p.nome AS profissional_nome, p.cor AS profissional_cor
    FROM agendamentos a
    LEFT JOIN clientes c ON c.id = a.cliente_id
    LEFT JOIN profissionais p ON p.id = a.profissional_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.data, a.hora_inicio
  `).all(params);
}

function obter(id) {
  const db = getDb();
  const a = db.prepare(`
    SELECT a.*, c.nome AS cliente_cadastro, c.telefone AS cliente_telefone,
           p.nome AS profissional_nome, p.cor AS profissional_cor
    FROM agendamentos a
    LEFT JOIN clientes c ON c.id = a.cliente_id
    LEFT JOIN profissionais p ON p.id = a.profissional_id
    WHERE a.id = ?
  `).get(id);
  if (!a) throw new AppError('Agendamento nao encontrado.', 404);
  return a;
}

/** Soma minutos a um horario 'HH:MM'. */
function somarMinutos(hora, minutos) {
  const [h, m] = String(hora).split(':').map(Number);
  const total = h * 60 + m + Number(minutos || 0);
  const hh = Math.floor((total % 1440) / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function normalizar(db, dados, atual = {}) {
  const data = dados.data || atual.data;
  const hora_inicio = dados.hora_inicio || atual.hora_inicio;
  if (!data) throw new AppError('Informe a data do agendamento.');
  if (!hora_inicio) throw new AppError('Informe o horario do agendamento.');

  const produto_id = dados.produto_id !== undefined
    ? (dados.produto_id ? Number(dados.produto_id) : null)
    : (atual.produto_id || null);

  let servico_nome = dados.servico_nome !== undefined ? dados.servico_nome : atual.servico_nome;
  let valor = dados.valor !== undefined && dados.valor !== '' ? Number(dados.valor) : Number(atual.valor || 0);
  let hora_fim = dados.hora_fim !== undefined ? dados.hora_fim : atual.hora_fim;

  // Puxa nome/preco/duracao do servico do cadastro quando vinculado.
  if (produto_id) {
    const serv = db.prepare('SELECT nome, preco_venda, duracao_min FROM produtos WHERE id = ?').get(produto_id);
    if (serv) {
      if (!servico_nome) servico_nome = serv.nome;
      if (!valor) valor = Number(serv.preco_venda || 0);
      if (!hora_fim && serv.duracao_min) hora_fim = somarMinutos(hora_inicio, serv.duracao_min);
    }
  }

  return {
    data,
    hora_inicio,
    hora_fim: hora_fim || null,
    cliente_id: dados.cliente_id !== undefined ? (dados.cliente_id ? Number(dados.cliente_id) : null) : (atual.cliente_id || null),
    cliente_nome: dados.cliente_nome !== undefined ? (dados.cliente_nome || null) : (atual.cliente_nome || null),
    telefone: dados.telefone !== undefined ? (dados.telefone || null) : (atual.telefone || null),
    profissional_id: dados.profissional_id !== undefined ? (dados.profissional_id ? Number(dados.profissional_id) : null) : (atual.profissional_id || null),
    produto_id,
    servico_nome: servico_nome || null,
    valor: arred(valor),
    observacao: dados.observacao !== undefined ? (dados.observacao || null) : (atual.observacao || null),
  };
}

function criar(dados) {
  const db = getDb();
  const d = normalizar(db, dados);
  const info = db.prepare(`
    INSERT INTO agendamentos
      (data, hora_inicio, hora_fim, cliente_id, cliente_nome, telefone, profissional_id,
       produto_id, servico_nome, valor, status, observacao)
    VALUES (@data, @hora_inicio, @hora_fim, @cliente_id, @cliente_nome, @telefone, @profissional_id,
       @produto_id, @servico_nome, @valor, 'agendado', @observacao)
  `).run(d);
  return obter(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = obter(id);
  if (atual.venda_id) throw new AppError('Este agendamento ja foi faturado.');
  const d = normalizar(db, dados, atual);
  db.prepare(`
    UPDATE agendamentos SET data=@data, hora_inicio=@hora_inicio, hora_fim=@hora_fim,
      cliente_id=@cliente_id, cliente_nome=@cliente_nome, telefone=@telefone,
      profissional_id=@profissional_id, produto_id=@produto_id, servico_nome=@servico_nome,
      valor=@valor, observacao=@observacao
    WHERE id=@id
  `).run({ ...d, id });
  return obter(id);
}

function mudarStatus(id, status) {
  const db = getDb();
  obter(id);
  if (!STATUS.includes(status)) throw new AppError('Status invalido.');
  db.prepare('UPDATE agendamentos SET status=? WHERE id=?').run(status, id);
  return obter(id);
}

function excluir(id) {
  const db = getDb();
  const a = obter(id);
  if (a.venda_id) throw new AppError('Este agendamento ja foi faturado; cancele a venda no modulo de Vendas.');
  db.prepare('DELETE FROM agendamentos WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Fatura o agendamento: gera a venda do servico (sem estoque) e marca como
 * atendido. Exige que o agendamento esteja vinculado a um servico do cadastro.
 */
function faturar(id, { forma_pagamento = 'dinheiro', vencimento_prazo } = {}) {
  const db = getDb();
  const a = obter(id);
  if (a.venda_id) throw new AppError('Este agendamento ja foi faturado.');
  if (a.status === 'cancelado') throw new AppError('Agendamento cancelado nao pode ser faturado.');
  if (!a.produto_id) throw new AppError('Vincule um servico do cadastro para faturar este agendamento.');
  if (!(Number(a.valor) > 0)) throw new AppError('Informe o valor do atendimento antes de faturar.');

  // eslint-disable-next-line global-require
  const vendasService = require('./vendasService');
  const venda = vendasService.criarVenda({
    itens: [{ produto_id: a.produto_id, quantidade: 1, preco_unitario: Number(a.valor) }],
    cliente_id: a.cliente_id || null,
    pagamentos: [{ forma_pagamento, valor: Number(a.valor) }],
    vencimento_prazo: vencimento_prazo || null,
    observacao: `Agendamento #${a.id}`,
  });

  db.prepare("UPDATE agendamentos SET venda_id=?, status='atendido' WHERE id=?").run(venda.id, id);
  return { agendamento: obter(id), venda };
}

/** Resumo do dia (para o cabecalho da agenda). */
function resumoDia(data) {
  const db = getDb();
  const r = db.prepare(`
    SELECT COUNT(*) total,
      COALESCE(SUM(CASE WHEN status='atendido' THEN 1 ELSE 0 END),0) atendidos,
      COALESCE(SUM(CASE WHEN status IN ('agendado','confirmado') THEN 1 ELSE 0 END),0) pendentes,
      COALESCE(SUM(CASE WHEN status IN ('agendado','confirmado','atendido') THEN valor ELSE 0 END),0) previsto
    FROM agendamentos WHERE data = ?
  `).get(data);
  return { ...r, previsto: arred(r.previsto) };
}

module.exports = {
  STATUS,
  listarProfissionais, criarProfissional, atualizarProfissional, excluirProfissional,
  listar, obter, criar, atualizar, mudarStatus, excluir, faturar, resumoDia,
};
