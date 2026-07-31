'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const svc = require('../services/tarefasService');

const router = express.Router();

router.get('/fixas', asyncHandler((req, res) => res.json(svc.listarFixas())));
router.post('/fixas', asyncHandler((req, res) => res.status(201).json(svc.criarFixa(req.body || {}))));
router.put('/fixas/:id', asyncHandler((req, res) => res.json(svc.atualizarFixa(req.params.id, req.body || {}))));
router.delete('/fixas/:id', asyncHandler((req, res) => res.json(svc.excluirFixa(req.params.id))));
router.post('/fixas/gerar-pendentes', asyncHandler((req, res) => res.json(svc.gerarFixasPendentes())));

router.get('/', asyncHandler((req, res) => res.json(svc.listar(req.query))));
router.post('/', asyncHandler((req, res) => res.status(201).json(svc.criar(req.body || {}))));
router.put('/:id', asyncHandler((req, res) => res.json(svc.atualizar(req.params.id, req.body || {}))));
router.delete('/:id', asyncHandler((req, res) => res.json(svc.excluir(req.params.id))));

module.exports = router;
