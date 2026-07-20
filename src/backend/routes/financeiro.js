'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const fin = require('../services/financeiroService');

const router = express.Router();

// -------------------------- Contas a pagar --------------------------
router.get('/contas-pagar', asyncHandler((req, res) => res.json(fin.listarPagar(req.query))));
router.post('/contas-pagar', asyncHandler((req, res) => res.status(201).json(fin.criarPagar(req.body || {}))));
router.post('/contas-pagar/:id/baixar', asyncHandler((req, res) => res.json(fin.baixarPagar(req.params.id, req.body || {}))));
router.post('/contas-pagar/:id/reabrir', asyncHandler((req, res) => res.json(fin.reabrirPagar(req.params.id))));
router.delete('/contas-pagar/:id', asyncHandler((req, res) => res.json(fin.excluirPagar(req.params.id))));

// ------------------------- Contas a receber -------------------------
router.get('/contas-receber', asyncHandler((req, res) => res.json(fin.listarReceber(req.query))));
router.post('/contas-receber', asyncHandler((req, res) => res.status(201).json(fin.criarReceber(req.body || {}))));
router.post('/contas-receber/:id/baixar', asyncHandler((req, res) => res.json(fin.baixarReceber(req.params.id, req.body || {}))));
router.post('/contas-receber/:id/reabrir', asyncHandler((req, res) => res.json(fin.reabrirReceber(req.params.id))));
router.delete('/contas-receber/:id', asyncHandler((req, res) => res.json(fin.excluirReceber(req.params.id))));

// ----------------------- Alertas / fluxo de caixa -------------------
router.get('/alertas', asyncHandler((req, res) => res.json(fin.alertas(req.query))));
router.get('/fluxo-caixa', asyncHandler((req, res) => res.json(fin.fluxoCaixa(req.query))));

module.exports = router;
