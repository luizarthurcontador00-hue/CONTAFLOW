'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const cursos = require('../services/cursosService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(cursos.listar(req.query))));
router.get('/:id', asyncHandler((req, res) => res.json(cursos.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(cursos.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(cursos.atualizar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(cursos.excluir(req.params.id))));

module.exports = router;
