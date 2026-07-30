'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const svc = require('../services/pedidosCompraService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(svc.listar(req.query))));
router.get('/sugerir', asyncHandler((req, res) => {
  if (!req.query.fornecedor_id) throw new AppError('Informe o fornecedor.');
  res.json(svc.sugerirItens(req.query.fornecedor_id));
}));
router.get('/:id', asyncHandler((req, res) => res.json(svc.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(svc.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(svc.atualizar(req.params.id, req.body || {}))));
router.post('/:id/status', asyncHandler((req, res) => res.json(svc.mudarStatus(req.params.id, (req.body || {}).status))));
router.delete('/:id', asyncHandler((req, res) => res.json(svc.excluir(req.params.id))));

module.exports = router;
