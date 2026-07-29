'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const svc = require('../services/sacolasService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(svc.listar(req.query))));
router.get('/:id', asyncHandler((req, res) => res.json(svc.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(svc.criar(req.body || {}))));
router.post('/:id/conferir', asyncHandler((req, res) => res.json(svc.conferir(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(svc.excluir(req.params.id))));

module.exports = router;
