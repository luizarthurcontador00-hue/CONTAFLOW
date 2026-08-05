'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const svc = require('../services/conferenciaService');

const router = express.Router();

router.get('/lotes', asyncHandler((req, res) => res.json(svc.listarLotes())));
router.get('/', asyncHandler((req, res) => res.json(svc.listar(req.query))));
router.post('/:id/conferir', asyncHandler((req, res) => res.json(svc.conferirItem(req.params.id, req.body || {}))));
router.post('/:id/reabrir', asyncHandler((req, res) => res.json(svc.reabrirItem(req.params.id))));
router.delete('/lote/:lote', asyncHandler((req, res) => res.json(svc.excluirLote(req.params.lote))));
router.delete('/:id', asyncHandler((req, res) => { svc.excluirItem(req.params.id); res.status(204).end(); }));

module.exports = router;
