'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const os = require('../services/osService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(os.listar(req.query))));
router.get('/:id', asyncHandler((req, res) => res.json(os.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(os.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(os.atualizar(req.params.id, req.body || {}))));
router.post('/:id/status', asyncHandler((req, res) => res.json(os.mudarStatus(req.params.id, req.body && req.body.status))));
router.post('/:id/faturar', asyncHandler((req, res) => res.json(os.faturar(req.params.id, req.body || {}))));
router.post('/:id/vincular-venda', asyncHandler((req, res) => res.json(os.vincularVenda(req.params.id, req.body && req.body.venda_id))));
router.post('/:id/gerar-os', asyncHandler((req, res) => res.status(201).json(os.gerarOSDeOrcamento(req.params.id))));
router.delete('/:id', asyncHandler((req, res) => res.json(os.excluir(req.params.id))));

module.exports = router;
