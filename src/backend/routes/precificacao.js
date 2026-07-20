'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const precificacao = require('../services/precificacaoService');

const router = express.Router();

// Simulador margem <-> preco <-> markup
router.post('/simular', asyncHandler((req, res) => {
  res.json(precificacao.simular(req.body || {}));
}));

// Preview do reajuste em lote (nao aplica)
router.post('/reajuste/preview', asyncHandler((req, res) => {
  res.json(precificacao.previewReajuste(req.body || {}));
}));

// Aplica o reajuste em lote
router.post('/reajuste/aplicar', asyncHandler((req, res) => {
  res.json(precificacao.aplicarReajuste(req.body || {}));
}));

module.exports = router;
