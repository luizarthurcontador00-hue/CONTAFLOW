'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const fiscal = require('../services/fiscalService');

const router = express.Router();

router.get('/status', asyncHandler((req, res) => res.json({ configurado: fiscal.estaConfigurado() })));

router.get('/vendas/:vendaId/notas', asyncHandler((req, res) => res.json(fiscal.listarPorVenda(req.params.vendaId))));
router.post('/vendas/:vendaId/emitir-nfce', asyncHandler(async (req, res) => res.status(201).json(await fiscal.emitirNFCe(req.params.vendaId))));
router.post('/notas/:notaId/consultar', asyncHandler(async (req, res) => res.json(await fiscal.consultarStatus(req.params.notaId))));

module.exports = router;
