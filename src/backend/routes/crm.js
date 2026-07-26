'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const crm = require('../services/crmService');

const router = express.Router();

router.get('/leads', asyncHandler((req, res) => res.json(crm.listarLeads(req.query))));
router.get('/leads/:id', asyncHandler((req, res) => res.json(crm.obterLead(req.params.id))));
router.post('/leads', asyncHandler((req, res) => res.status(201).json(crm.criarLead(req.body || {}))));
router.put('/leads/:id', asyncHandler((req, res) => res.json(crm.atualizarLead(req.params.id, req.body || {}))));
router.delete('/leads/:id', asyncHandler((req, res) => res.json(crm.excluirLead(req.params.id))));
router.post('/leads/:id/fechar-venda', asyncHandler((req, res) => res.status(201).json(crm.fecharVenda(req.params.id, req.body || {}))));

router.get('/viagens', asyncHandler((req, res) => res.json(crm.listarViagens(req.query))));

module.exports = router;
