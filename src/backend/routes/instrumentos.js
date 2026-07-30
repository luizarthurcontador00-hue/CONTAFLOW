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

// ---------------------------- Emprestimos ----------------------------
router.get('/emprestimos', asyncHandler((req, res) => res.json(instrumentos.listarEmprestimos({
  abertos: req.query.abertos === '1', aluno_id: req.query.aluno_id, instrumento_id: req.query.instrumento_id,
}))));
router.post('/emprestimos', asyncHandler((req, res) => res.status(201).json(instrumentos.emprestar(req.body || {}))));
router.post('/emprestimos/:id/devolver', asyncHandler((req, res) => res.json(instrumentos.devolver(req.params.id, req.body || {}))));

// --------------------- Instrumento proprio do aluno ---------------------
router.get('/proprios/:alunoId', asyncHandler((req, res) => res.json(instrumentos.instrumentosProprios(req.params.alunoId))));
router.put('/proprios/:alunoId', asyncHandler((req, res) => res.json(
  instrumentos.definirInstrumentosProprios(Number(req.params.alunoId), (req.body || {}).instrumento_ids)
)));

// ------------------------ Unidades (patrimonio) ------------------------
router.get('/:id/unidades', asyncHandler((req, res) => res.json(instrumentos.listarUnidades(req.params.id))));
router.post('/:id/unidades', asyncHandler((req, res) => res.status(201).json(instrumentos.criarUnidade(Number(req.params.id), req.body || {}))));
router.post('/:id/unidades/gerar', asyncHandler((req, res) => res.json(instrumentos.gerarUnidades(Number(req.params.id), (req.body || {}).quantidade))));
router.put('/unidades/:unidadeId', asyncHandler((req, res) => res.json(instrumentos.atualizarUnidade(req.params.unidadeId, req.body || {}))));
router.delete('/unidades/:unidadeId', asyncHandler((req, res) => res.json(instrumentos.excluirUnidade(req.params.unidadeId))));

router.get('/:id', asyncHandler((req, res) => res.json(instrumentos.obter(req.params.id))));
router.post('/', asyncHandler((req, res) => res.status(201).json(instrumentos.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(instrumentos.atualizar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(instrumentos.excluir(req.params.id))));

module.exports = router;
