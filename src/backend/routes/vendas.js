'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const vendas = require('../services/vendasService');

const router = express.Router();

// Busca de produto para venda/PDV
router.get('/buscar-produto', asyncHandler((req, res) => {
  res.json(vendas.buscarProduto(req.query.termo));
}));

router.get('/', asyncHandler((req, res) => {
  res.json(vendas.listarVendas({
    inicio: req.query.inicio,
    fim: req.query.fim,
    forma_pagamento: req.query.forma_pagamento,
    produto_id: req.query.produto_id,
    status: req.query.status,
  }));
}));

router.get('/:id', asyncHandler((req, res) => {
  res.json(vendas.obterVenda(req.params.id));
}));

router.post('/', asyncHandler((req, res) => {
  res.status(201).json(vendas.criarVenda(req.body));
}));

router.post('/:id/cancelar', asyncHandler((req, res) => {
  res.json(vendas.cancelarVenda(req.params.id, req.body && req.body.motivo));
}));

module.exports = router;
