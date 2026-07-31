'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const espera = require('../services/listaEsperaService');

const router = express.Router();

router.get('/resumo', asyncHandler((req, res) => res.json(espera.resumoPorCurso())));
router.get('/curso/:cursoId', asyncHandler((req, res) => res.json(espera.interessadosDoCurso(req.params.cursoId))));
router.get('/', asyncHandler((req, res) => res.json(espera.listar(req.query))));
router.post('/', asyncHandler((req, res) => res.status(201).json(espera.adicionar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(espera.atualizar(req.params.id, req.body || {}))));
router.post('/:id/status', asyncHandler((req, res) => res.json(espera.mudarStatus(req.params.id, (req.body || {}).status, (req.body || {}).observacao))));
router.post('/:id/matricular', asyncHandler((req, res) => res.json(espera.matricularNaTurma(req.params.id, (req.body || {}).turma_id))));
router.delete('/:id', asyncHandler((req, res) => res.json(espera.excluir(req.params.id))));

module.exports = router;
