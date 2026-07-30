'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const servico = require('../services/googleAgendaService');

const router = express.Router();

router.get('/status', asyncHandler(async (req, res) => {
  res.json(servico.status());
}));

router.post('/credenciais', asyncHandler(async (req, res) => {
  res.json(servico.salvarCredenciais(req.body || {}));
}));

router.post('/conectar', asyncHandler(async (req, res) => {
  res.json(await servico.conectar());
}));

router.post('/desconectar', asyncHandler(async (req, res) => {
  res.json(servico.desconectar());
}));

router.post('/ativo', asyncHandler(async (req, res) => {
  res.json(servico.definirAtivo(!!(req.body || {}).ativo));
}));

module.exports = router;
