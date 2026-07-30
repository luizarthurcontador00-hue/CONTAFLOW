'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const turmas = require('../services/turmasService');
const presencas = require('../services/presencasService');

const router = express.Router();

// --------------------------- Relatorios (antes de /:id) ---------------------------
router.get('/alunos-em-risco', asyncHandler((req, res) => res.json(presencas.alunosEmRisco(Number(req.query.minimo) || 3))));
router.get('/horas-voluntariado', asyncHandler((req, res) => res.json(presencas.horasVoluntariado(req.query))));
router.get('/encontros', asyncHandler((req, res) => res.json(presencas.listarEncontros(req.query))));

// ------------------------------- Chamada -------------------------------
router.get('/encontros/:agendamentoId/chamada', asyncHandler((req, res) => res.json(presencas.folhaDeChamada(req.params.agendamentoId))));
router.post('/encontros/:agendamentoId/chamada', asyncHandler((req, res) => res.json(presencas.registrarChamada(req.params.agendamentoId, req.body || {}))));

// -------------------------------- Turmas --------------------------------
router.get('/', asyncHandler((req, res) => res.json(turmas.listar(req.query))));
router.post('/', asyncHandler((req, res) => res.status(201).json(turmas.criar(req.body || {}))));
router.get('/:id', asyncHandler((req, res) => res.json(turmas.obter(req.params.id))));
router.put('/:id', asyncHandler((req, res) => res.json(turmas.atualizar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(turmas.excluir(req.params.id))));
router.get('/:id/frequencia', asyncHandler((req, res) => res.json(presencas.frequenciaDaTurma(req.params.id))));

// ------------------------------ Matriculas ------------------------------
router.post('/:id/matriculas', asyncHandler((req, res) => res.status(201).json(turmas.matricular(req.params.id, req.body || {}))));
router.put('/matriculas/:matriculaId', asyncHandler((req, res) => res.json(turmas.mudarStatusMatricula(req.params.matriculaId, (req.body || {}).status, (req.body || {}).observacao))));
router.delete('/matriculas/:matriculaId', asyncHandler((req, res) => res.json(turmas.removerMatricula(req.params.matriculaId))));

module.exports = router;
