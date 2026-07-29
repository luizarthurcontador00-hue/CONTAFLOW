'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const svc = require('../services/licencaService');

const router = express.Router();

router.get('/status', asyncHandler((req, res) => res.json(svc.status())));

router.post('/ativar', asyncHandler((req, res) => {
  const chave = (req.body && req.body.chave || '').trim();
  if (!chave) throw new AppError('Cole a chave de ativação.');
  res.json(svc.ativar(chave));
}));

module.exports = router;
