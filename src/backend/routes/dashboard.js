'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const dash = require('../services/dashboardService');

const router = express.Router();

router.get('/resumo', asyncHandler((req, res) => res.json(dash.resumoGeral())));
router.get('/central', asyncHandler((req, res) => res.json(dash.centralAtencao())));
router.get('/professor', asyncHandler((req, res) => res.json(dash.painelProfessor())));
router.get('/instituto', asyncHandler((req, res) => res.json(dash.painelInstituto())));
router.get('/vendas-periodo', asyncHandler((req, res) => res.json(dash.vendasPorPeriodo(req.query))));
router.get('/mais-vendidos', asyncHandler((req, res) => res.json(dash.maisVendidos(req.query))));
router.get('/margem-categoria', asyncHandler((req, res) => res.json(dash.margemPorCategoria(req.query))));
router.get('/margem-periodo', asyncHandler((req, res) => res.json(dash.margemPeriodo(req.query))));
router.get('/curva-abc', asyncHandler((req, res) => res.json(dash.curvaABC(req.query))));
router.get('/pagar-receber', asyncHandler((req, res) => res.json(dash.pagarVsReceber(req.query))));

module.exports = router;
