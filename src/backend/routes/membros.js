'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const membros = require('../services/membrosService');

const router = express.Router();

router.get('/assinante', asyncHandler((req, res) => res.json(membros.assinante())));
router.get('/', asyncHandler((req, res) => res.json(membros.listar(req.query))));
router.get('/:id', asyncHandler((req, res) => res.json(membros.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(membros.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(membros.atualizar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(membros.excluir(req.params.id))));

module.exports = router;
