'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const arr = require('../services/arrecadacaoService');

const router = express.Router();

router.get('/prestacao-de-contas', asyncHandler((req, res) => res.json(arr.prestacaoDeContas(req.query))));
router.get('/mantenedores', asyncHandler((req, res) => res.json(arr.listarMantenedores())));

router.get('/projetos', asyncHandler((req, res) => res.json(arr.listarProjetos(req.query))));
router.post('/projetos', asyncHandler((req, res) => res.status(201).json(arr.criarProjeto(req.body || {}))));
router.put('/projetos/:id', asyncHandler((req, res) => res.json(arr.atualizarProjeto(req.params.id, req.body || {}))));
router.delete('/projetos/:id', asyncHandler((req, res) => res.json(arr.excluirProjeto(req.params.id))));

router.get('/ofertas', asyncHandler((req, res) => res.json(arr.listarOfertas(req.query))));
router.post('/ofertas', asyncHandler((req, res) => res.status(201).json(arr.registrarOferta(req.body || {}))));
router.get('/ofertas/:id', asyncHandler((req, res) => res.json(arr.obterOferta(req.params.id))));
router.put('/ofertas/:id', asyncHandler((req, res) => res.json(arr.atualizarOferta(req.params.id, req.body || {}))));
router.delete('/ofertas/:id', asyncHandler((req, res) => res.json(arr.excluirOferta(req.params.id))));
router.post('/ofertas/:id/recibo-emitido', asyncHandler((req, res) => res.json(arr.marcarReciboEmitido(req.params.id))));

router.get('/doacoes-especie', asyncHandler((req, res) => res.json(arr.listarDoacoesEspecie(req.query))));
router.post('/doacoes-especie', asyncHandler((req, res) => res.status(201).json(arr.registrarDoacaoEspecie(req.body || {}))));
router.delete('/doacoes-especie/:id', asyncHandler((req, res) => res.json(arr.excluirDoacaoEspecie(req.params.id))));

module.exports = router;
