'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const svc = require('../services/precAvancadaService');

const router = express.Router();

// Estado completo, ja com todos os calculos derivados.
router.get('/', asyncHandler((req, res) => res.json(svc.calcularTudo())));

// Modulo 2 - faturamento/impostos/atividade
router.put('/config', asyncHandler((req, res) => res.json(svc.salvarConfig(req.body || {}))));

// Modulo 3 - despesas
router.post('/despesa', asyncHandler((req, res) => res.status(201).json(svc.criarDespesa(req.body || {}))));
router.put('/despesa/:id', asyncHandler((req, res) => res.json(svc.atualizarDespesa(req.params.id, req.body || {}))));
router.delete('/despesa/:id', asyncHandler((req, res) => res.json(svc.excluirDespesa(req.params.id))));

// Modulo 5 - produtos de precificacao
router.post('/produto', asyncHandler((req, res) => res.status(201).json(svc.criarProduto(req.body || {}))));
router.put('/produto/:id', asyncHandler((req, res) => res.json(svc.atualizarProduto(req.params.id, req.body || {}))));
router.delete('/produto/:id', asyncHandler((req, res) => res.json(svc.excluirProduto(req.params.id))));

module.exports = router;
