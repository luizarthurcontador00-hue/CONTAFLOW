'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const inst = require('../services/institutoService');

const router = express.Router();

// ------------------------------- Atas -------------------------------
router.get('/atas', asyncHandler((req, res) => res.json(inst.listarAtas(req.query))));
router.get('/atas/:id', asyncHandler((req, res) => res.json(inst.obterAta(req.params.id))));
router.post('/atas', asyncHandler((req, res) => res.status(201).json(inst.criarAta(req.body || {}))));
router.put('/atas/:id', asyncHandler((req, res) => res.json(inst.atualizarAta(req.params.id, req.body || {}))));
router.delete('/atas/:id', asyncHandler((req, res) => res.json(inst.excluirAta(req.params.id))));

// --------------------------- Autorizacoes ---------------------------
router.get('/autorizacoes', asyncHandler((req, res) => res.json(inst.listarAutorizacoes({
  somente_pendentes: req.query.somente_pendentes === '1', tipo: req.query.tipo,
}))));
router.post('/autorizacoes/:alunoId', asyncHandler((req, res) => res.json(inst.registrarAutorizacao(req.params.alunoId, req.body || {}))));

// ---------------------- Ficha e documentos do aluno ----------------------
router.get('/ficha-aluno/:id', asyncHandler((req, res) => res.json(inst.fichaDoAluno(req.params.id))));
router.get('/declaracao-matricula/:id', asyncHandler((req, res) => res.json(inst.declaracaoMatricula(req.params.id, req.query))));
router.get('/certificado/:alunoId/:turmaId', asyncHandler((req, res) => res.json(inst.certificadoConclusao(req.params.alunoId, req.params.turmaId))));

// ------------------------ Relatorio de impacto ------------------------
router.get('/impacto', asyncHandler((req, res) => res.json(inst.relatorioImpacto(req.query))));

module.exports = router;
