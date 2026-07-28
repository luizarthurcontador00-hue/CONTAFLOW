'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const dev = require('../services/devolucoesService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(dev.listarDevolucoes(req.query))));
router.get('/:id', asyncHandler((req, res) => res.json(dev.obterDevolucao(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(dev.criarDevolucao(req.body || {}))));

module.exports = router;
