'use strict';

/**
 * Tarefas com acompanhamento de execucao: quadro pendente -> em andamento ->
 * concluida, com responsavel opcional (reaproveita o cadastro de
 * profissionais) e prazo.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

const STATUS_VALIDOS = ['pendente', 'andamento', 'concluida'];

function listar({ status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('t.status = @status'); params.status = status; }
  return db.prepare(`
    SELECT t.*, p.nome AS responsavel_nome, p.cor AS responsavel_cor
    FROM tarefas t LEFT JOIN profissionais p ON p.id = t.responsavel_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (t.status = 'concluida'), (t.prazo IS NULL), date(t.prazo), t.criado_em DESC
  `).all(params);
}

function criar(dados) {
  const db = getDb();
  const titulo = (dados.titulo || '').trim();
  if (!titulo) throw new AppError('Informe o titulo da tarefa.');
  const info = db.prepare(
    'INSERT INTO tarefas (titulo, descricao, responsavel_id, prazo, conversa_whatsapp_id) VALUES (?, ?, ?, ?, ?)'
  ).run(
    titulo, dados.descricao || null, dados.responsavel_id ? Number(dados.responsavel_id) : null, dados.prazo || null,
    dados.conversa_whatsapp_id ? Number(dados.conversa_whatsapp_id) : null
  );
  return db.prepare('SELECT * FROM tarefas WHERE id = ?').get(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(id);
  if (!atual) throw new AppError('Tarefa nao encontrada.', 404);

  const titulo = dados.titulo !== undefined ? (dados.titulo || '').trim() : atual.titulo;
  if (!titulo) throw new AppError('Informe o titulo da tarefa.');
  const status = dados.status !== undefined ? dados.status : atual.status;
  if (!STATUS_VALIDOS.includes(status)) throw new AppError('Status invalido.');

  const concluidoEm = status === 'concluida'
    ? (atual.status === 'concluida' ? atual.concluido_em : new Date().toISOString().slice(0, 19).replace('T', ' '))
    : null;

  db.prepare(
    `UPDATE tarefas SET titulo=?, descricao=?, responsavel_id=?, status=?, prazo=?, concluido_em=? WHERE id=?`
  ).run(
    titulo,
    dados.descricao !== undefined ? dados.descricao : atual.descricao,
    dados.responsavel_id !== undefined ? (dados.responsavel_id ? Number(dados.responsavel_id) : null) : atual.responsavel_id,
    status,
    dados.prazo !== undefined ? dados.prazo : atual.prazo,
    concluidoEm,
    id
  );
  return db.prepare('SELECT * FROM tarefas WHERE id = ?').get(id);
}

function excluir(id) {
  getDb().prepare('DELETE FROM tarefas WHERE id = ?').run(id);
  return { ok: true };
}

module.exports = { listar, criar, atualizar, excluir };
