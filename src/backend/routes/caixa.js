'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const caixa = require('../services/caixaService');

const router = express.Router();

// Caixa aberto atual (ou null)
router.get('/atual', asyncHandler((req, res) => {
  const aberto = caixa.caixaAberto();
  res.json(aberto ? caixa.obter(aberto.id) : null);
}));

router.get('/historico', asyncHandler((req, res) => {
  res.json(caixa.historico());
}));

router.get('/:id', asyncHandler((req, res) => {
  res.json(caixa.obter(req.params.id));
}));

router.post('/abrir', asyncHandler((req, res) => {
  res.status(201).json(caixa.abrir(req.body || {}));
}));

router.post('/:id/movimento', asyncHandler((req, res) => {
  res.json(caixa.movimentar(req.params.id, req.body || {}));
}));

router.post('/:id/fechar', asyncHandler((req, res) => {
  res.json(caixa.fechar(req.params.id, req.body || {}));
}));

module.exports = router;
