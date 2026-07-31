'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const { uploadFotoPessoa } = require('../middleware/upload');
const clientes = require('../services/clientesService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(clientes.listar(req.query))));
router.get('/:id', asyncHandler((req, res) => res.json(clientes.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(clientes.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(clientes.atualizar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(clientes.excluir(req.params.id))));

router.post('/:id/foto', uploadFotoPessoa.single('foto'), asyncHandler((req, res) => {
  if (!req.file) throw new AppError('Envie uma imagem.');
  res.json(clientes.atualizarFoto(req.params.id, req.file.filename));
}));

module.exports = router;
