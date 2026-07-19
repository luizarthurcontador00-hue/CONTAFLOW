'use strict';

const express = require('express');
const { getDb } = require('../db/connection');
const { AppError, asyncHandler } = require('../utils/errors');

const router = express.Router();

router.get('/', asyncHandler((req, res) => {
  const db = getDb();
  const busca = req.query.busca ? `%${req.query.busca}%` : null;
  const sql = busca
    ? 'SELECT * FROM fornecedores WHERE nome LIKE ? OR cnpj LIKE ? ORDER BY nome COLLATE NOCASE'
    : 'SELECT * FROM fornecedores ORDER BY nome COLLATE NOCASE';
  res.json(busca ? db.prepare(sql).all(busca, busca) : db.prepare(sql).all());
}));

router.get('/:id', asyncHandler((req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(req.params.id);
  if (!f) throw new AppError('Fornecedor nao encontrado.', 404);
  res.json(f);
}));

function dadosFornecedor(body) {
  const nome = (body.nome || '').trim();
  if (!nome) throw new AppError('O nome/razao social do fornecedor e obrigatorio.');
  return {
    nome,
    cnpj: body.cnpj ? String(body.cnpj).replace(/\D/g, '') || null : null,
    contato: body.contato || null,
    telefone: body.telefone || null,
    email: body.email || null,
  };
}

router.post('/', asyncHandler((req, res) => {
  const db = getDb();
  const d = dadosFornecedor(req.body);
  const info = db.prepare(
    'INSERT INTO fornecedores (nome, cnpj, contato, telefone, email) VALUES (@nome, @cnpj, @contato, @telefone, @email)'
  ).run(d);
  res.status(201).json(db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/:id', asyncHandler((req, res) => {
  const db = getDb();
  const f = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(req.params.id);
  if (!f) throw new AppError('Fornecedor nao encontrado.', 404);
  const d = dadosFornecedor({ ...f, ...req.body });
  db.prepare(
    'UPDATE fornecedores SET nome=@nome, cnpj=@cnpj, contato=@contato, telefone=@telefone, email=@email WHERE id=@id'
  ).run({ ...d, id: req.params.id });
  res.json(db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(req.params.id));
}));

router.delete('/:id', asyncHandler((req, res) => {
  const db = getDb();
  const emUso = db.prepare('SELECT COUNT(*) c FROM produtos WHERE fornecedor_id = ?').get(req.params.id).c;
  if (emUso > 0) {
    throw new AppError(`Nao e possivel excluir: ha ${emUso} produto(s) vinculado(s) a este fornecedor.`, 409);
  }
  db.prepare('DELETE FROM fornecedores WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
