'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const instrumentos = require('../services/instrumentosService');

const router = express.Router();

router.get('/', asyncHandler((req, res) => res.json(instrumentos.listar(req.query))));

// Quantas vagas cabem numa turma com estes horarios (usado ao montar a turma).
router.post('/:id/vagas-disponiveis', asyncHandler((req, res) => {
  const { horarios, turma_id, instrumentos_por_aluno } = req.body || {};
  res.json(instrumentos.vagasDisponiveis(Number(req.params.id), horarios || [], {
    turmaIdIgnorar: turma_id ? Number(turma_id) : null,
    instrumentosPorAluno: instrumentos_por_aluno,
  }));
}));

router.get('/:id', asyncHandler((req, res) => res.json(instrumentos.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(instrumentos.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(instrumentos.atualizar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(instrumentos.excluir(req.params.id))));

module.exports = router;
