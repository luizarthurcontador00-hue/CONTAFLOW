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

// ------------------- Atividades de voluntariado (fora da aula) -------------------
router.get('/voluntarios/atividades', asyncHandler((req, res) => res.json(presencas.listarAtividades(req.query))));
router.get('/voluntarios/atividades/tipos', asyncHandler((req, res) => res.json(presencas.TIPOS_ATIVIDADE)));
router.post('/voluntarios/atividades', asyncHandler((req, res) => res.status(201).json(presencas.registrarAtividade(req.body || {}))));
router.put('/voluntarios/atividades/:id', asyncHandler((req, res) => res.json(presencas.atualizarAtividade(req.params.id, req.body || {}))));
router.delete('/voluntarios/atividades/:id', asyncHandler((req, res) => res.json(presencas.excluirAtividade(req.params.id))));

// --------------------------- Substituto ---------------------------
router.get('/encontros/:agendamentoId/substitutos', asyncHandler((req, res) => res.json(turmas.sugerirSubstitutos(req.params.agendamentoId))));
router.post('/encontros/:agendamentoId/instrutor', asyncHandler((req, res) => res.json(turmas.definirInstrutorDoEncontro(req.params.agendamentoId, (req.body || {}).profissional_id))));
router.post('/encontros/:agendamentoId/suspender', asyncHandler((req, res) => res.json(turmas.suspenderEncontro(req.params.agendamentoId, { suspender: true, motivo: (req.body || {}).motivo }))));
router.post('/encontros/:agendamentoId/reabrir', asyncHandler((req, res) => res.json(turmas.suspenderEncontro(req.params.agendamentoId, { suspender: false }))));

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
router.get('/:id/folha-impressao', asyncHandler((req, res) => res.json(presencas.folhaParaImpressao(req.params.id, req.query))));
router.get('/:id/progresso', asyncHandler((req, res) => res.json(turmas.progressoTurma(req.params.id))));

// -------------------------- Periodo / renovacao --------------------------
router.get('/:id/historico', asyncHandler((req, res) => res.json(turmas.historicoDaTurma(req.params.id))));
router.post('/:id/encerrar', asyncHandler((req, res) => res.json(turmas.encerrar(req.params.id, req.body || {}))));
router.post('/:id/renovar', asyncHandler((req, res) => res.json(turmas.renovar(req.params.id, req.body || {}))));

// ------------------------------ Matriculas ------------------------------
router.post('/:id/matriculas', asyncHandler((req, res) => res.status(201).json(turmas.matricular(req.params.id, req.body || {}))));
router.put('/matriculas/:matriculaId', asyncHandler((req, res) => res.json(turmas.mudarStatusMatricula(req.params.matriculaId, (req.body || {}).status, (req.body || {}).observacao))));
router.delete('/matriculas/:matriculaId', asyncHandler((req, res) => res.json(turmas.removerMatricula(req.params.matriculaId))));

module.exports = router;
