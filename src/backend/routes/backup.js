'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const backup = require('../services/backupService');

const router = express.Router();

router.get('/config', asyncHandler((req, res) => res.json(backup.getConfig())));

router.get('/lista', asyncHandler((req, res) => res.json(backup.listarBackups())));

router.post('/gerar', asyncHandler(async (req, res) => {
  const r = await backup.fazerBackup(req.body && req.body.destino);
  backup.registrarUltimo();
  res.json(r);
}));

router.post('/automatico', asyncHandler((req, res) => {
  res.json(backup.setAutomatico(!!(req.body && req.body.ligado)));
}));

router.post('/restaurar', asyncHandler(async (req, res) => {
  const r = await backup.restaurar(req.body && req.body.origem);
  res.json(r);
}));

module.exports = router;
