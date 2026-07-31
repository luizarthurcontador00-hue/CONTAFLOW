'use strict';

/**
 * Objetivos do instituto (ou de qualquer perfil) pra acompanhar — ex.: abrir
 * CNPJ, comprar instrumento, abrir turma nova. Valor e opcional: quem nao
 * tem custo (ex.: "abrir CNPJ") so entra como meta a cumprir; quem tem
 * entra na conta de quanto falta pra caber no saldo em caixa.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

const STATUS_VALIDOS = ['aberto', 'concluido', 'cancelado'];

function listar({ status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('status = @status'); params.status = status; }
  return db.prepare(`
    SELECT * FROM objetivos
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (status = 'aberto') DESC, (valor IS NULL), valor, criado_em
  `).all(params);
}

function criar(dados) {
  const db = getDb();
  const titulo = (dados.titulo || '').trim();
  if (!titulo) throw new AppError('Informe o titulo do objetivo.');
  const valor = dados.valor === '' || dados.valor === null || dados.valor === undefined ? null : Number(dados.valor);
  if (valor !== null && !(valor >= 0)) throw new AppError('O valor do objetivo nao pode ser negativo.');
  const info = db.prepare(
    'INSERT INTO objetivos (titulo, descricao, valor) VALUES (?, ?, ?)'
  ).run(titulo, dados.descricao || null, valor);
  return db.prepare('SELECT * FROM objetivos WHERE id = ?').get(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM objetivos WHERE id = ?').get(id);
  if (!atual) throw new AppError('Objetivo nao encontrado.', 404);

  const titulo = dados.titulo !== undefined ? (dados.titulo || '').trim() : atual.titulo;
  if (!titulo) throw new AppError('Informe o titulo do objetivo.');
  const status = dados.status !== undefined ? dados.status : atual.status;
  if (!STATUS_VALIDOS.includes(status)) throw new AppError('Status invalido.');
  let valor = atual.valor;
  if (dados.valor !== undefined) {
    valor = dados.valor === '' || dados.valor === null ? null : Number(dados.valor);
    if (valor !== null && !(valor >= 0)) throw new AppError('O valor do objetivo nao pode ser negativo.');
  }
  const concluidoEm = status === 'concluido'
    ? (atual.status === 'concluido' ? atual.concluido_em : new Date().toISOString().slice(0, 19).replace('T', ' '))
    : null;

  db.prepare('UPDATE objetivos SET titulo=?, descricao=?, valor=?, status=?, concluido_em=? WHERE id=?')
    .run(titulo, dados.descricao !== undefined ? dados.descricao : atual.descricao, valor, status, concluidoEm, id);
  return db.prepare('SELECT * FROM objetivos WHERE id = ?').get(id);
}

function excluir(id) {
  getDb().prepare('DELETE FROM objetivos WHERE id = ?').run(id);
  return { ok: true };
}

module.exports = { listar, criar, atualizar, excluir };
