'use strict';

const express = require('express');
const { getDb } = require('../db/connection');
const { AppError, asyncHandler } = require('../utils/errors');

const router = express.Router();

// Lista categorias com contagem de produtos.
router.get('/', asyncHandler((req, res) => {
  const db = getDb();
  const linhas = db.prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM produtos p WHERE p.categoria_id = c.id AND p.ativo = 1) AS total_produtos
    FROM categorias c ORDER BY c.nome COLLATE NOCASE
  `).all();
  res.json(linhas);
}));

router.post('/', asyncHandler((req, res) => {
  const db = getDb();
  const nome = (req.body.nome || '').trim();
  if (!nome) throw new AppError('O nome da categoria e obrigatorio.');
  const markup = req.body.markup_padrao != null && req.body.markup_padrao !== ''
    ? Number(req.body.markup_padrao) : null;
  const info = db.prepare('INSERT INTO categorias (nome, markup_padrao) VALUES (?, ?)').run(nome, markup);
  res.status(201).json(db.prepare('SELECT * FROM categorias WHERE id = ?').get(info.lastInsertRowid));
}));

router.put('/:id', asyncHandler((req, res) => {
  const db = getDb();
  const cat = db.prepare('SELECT * FROM categorias WHERE id = ?').get(req.params.id);
  if (!cat) throw new AppError('Categoria nao encontrada.', 404);
  const nome = (req.body.nome != null ? req.body.nome : cat.nome).trim();
  if (!nome) throw new AppError('O nome da categoria e obrigatorio.');
  const markup = req.body.markup_padrao !== undefined
    ? (req.body.markup_padrao === '' || req.body.markup_padrao === null ? null : Number(req.body.markup_padrao))
    : cat.markup_padrao;
  db.prepare('UPDATE categorias SET nome = ?, markup_padrao = ? WHERE id = ?').run(nome, markup, req.params.id);
  res.json(db.prepare('SELECT * FROM categorias WHERE id = ?').get(req.params.id));
}));

router.delete('/:id', asyncHandler((req, res) => {
  const db = getDb();
  const emUso = db.prepare('SELECT COUNT(*) c FROM produtos WHERE categoria_id = ?').get(req.params.id).c;
  if (emUso > 0) {
    throw new AppError(`Nao e possivel excluir: ha ${emUso} produto(s) nesta categoria.`, 409);
  }
  db.prepare('DELETE FROM categorias WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
}));

module.exports = router;
