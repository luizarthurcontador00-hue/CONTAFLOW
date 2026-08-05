'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const { uploadPlanilha } = require('../middleware/upload');
const svc = require('../services/pedidosCompraService');
const planilha = require('../services/planilhaService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(svc.listar(req.query))));
router.get('/sugerir', asyncHandler((req, res) => {
  if (!req.query.fornecedor_id) throw new AppError('Informe o fornecedor.');
  res.json(svc.sugerirItens(req.query.fornecedor_id));
}));

// Importacao de planilha de itens do pedido (precisa vir antes de /:id).
router.get('/planilha/modelo', asyncHandler((req, res) => {
  const buffer = planilha.gerarModeloPedido();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-pedido-compra.xlsx"');
  res.send(buffer);
}));
router.post('/planilha/importar', uploadPlanilha.single('planilha'), asyncHandler((req, res) => {
  if (!req.file) throw new AppError('Selecione um arquivo de planilha.');
  const fornecedorId = Number(req.body.fornecedor_id);
  if (!fornecedorId) throw new AppError('Selecione o fornecedor antes de importar a planilha.');
  const linhas = planilha.analisarPlanilhaPedido(req.file.buffer);
  res.json(svc.resolverItensDaPlanilha(fornecedorId, linhas));
}));

router.get('/:id', asyncHandler((req, res) => res.json(svc.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(svc.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(svc.atualizar(req.params.id, req.body || {}))));
router.post('/:id/status', asyncHandler((req, res) => res.json(svc.mudarStatus(req.params.id, (req.body || {}).status))));
router.delete('/:id', asyncHandler((req, res) => res.json(svc.excluir(req.params.id))));

module.exports = router;
