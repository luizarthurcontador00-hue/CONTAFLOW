'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const svc = require('../services/lembretesService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(svc.listar(req.query))));
router.get('/vencidos', asyncHandler((req, res) => res.json(svc.pendentesVencidos())));
router.post('/', asyncHandler((req, res) => res.status(201).json(svc.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(svc.atualizar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(svc.excluir(req.params.id))));

module.exports = router;
