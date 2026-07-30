'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const { uploadOfx } = require('../middleware/upload');
const svc = require('../services/conciliacaoService');

const router = express.Router();

router.get('/regras', asyncHandler((req, res) => res.json(svc.listarRegras())));
router.post('/regras', asyncHandler((req, res) => res.status(201).json(svc.criarRegra(req.body || {}))));
router.put('/regras/:id', asyncHandler((req, res) => res.json(svc.atualizarRegra(req.params.id, req.body || {}))));
router.delete('/regras/:id', asyncHandler((req, res) => res.json(svc.excluirRegra(req.params.id))));

router.get('/', asyncHandler((req, res) => res.json(svc.listarTransacoes(req.query))));
router.get('/:id/sugestoes', asyncHandler((req, res) => res.json(svc.sugestoes(req.params.id))));
router.get('/:id/buscar', asyncHandler((req, res) => res.json(svc.buscarContas(req.params.id, req.query))));
router.post('/:id/conciliar', asyncHandler((req, res) => res.json(svc.conciliarComExistente(req.params.id, req.body || {}))));
router.post('/:id/novo-lancamento', asyncHandler((req, res) => res.json(svc.conciliarComNovo(req.params.id, req.body || {}))));
router.post('/:id/ignorar', asyncHandler((req, res) => res.json(svc.ignorar(req.params.id))));
router.post('/:id/reabrir', asyncHandler((req, res) => res.json(svc.reabrir(req.params.id))));

router.post('/importar', uploadOfx.single('ofx'), asyncHandler((req, res) => {
  if (!req.file) throw new AppError('Selecione um arquivo .ofx.');
  const contaFinanceiraId = Number(req.body.conta_financeira_id);
  if (!contaFinanceiraId) throw new AppError('Selecione a conta financeira deste extrato.');
  res.status(201).json(svc.importarExtrato(contaFinanceiraId, req.file.buffer));
}));

router.post('/:conta_financeira_id/aplicar-regras', asyncHandler((req, res) => res.json(svc.aplicarRegrasPendentes(req.params.conta_financeira_id))));

module.exports = router;
