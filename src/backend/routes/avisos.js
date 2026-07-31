'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const avisos = require('../services/avisosService');
const whats = require('../services/avisosWhatsappService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(avisos.listar())));
router.get('/whatsapp', asyncHandler((req, res) => res.json(whats.previa())));
router.put('/whatsapp', asyncHandler((req, res) => res.json(whats.salvarConfig(req.body || {}))));

module.exports = router;
