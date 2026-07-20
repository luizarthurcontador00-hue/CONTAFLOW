'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const clientes = require('../services/clientesService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(clientes.listar(req.query))));
router.get('/:id', asyncHandler((req, res) => res.json(clientes.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(clientes.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(clientes.atualizar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(clientes.excluir(req.params.id))));

module.exports = router;
