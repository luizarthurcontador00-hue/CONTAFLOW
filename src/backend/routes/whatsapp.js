'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const svc = require('../services/whatsappService');

const router = express.Router();

router.get('/status', asyncHandler((req, res) => res.json(svc.status())));
router.post('/conectar', asyncHandler(async (req, res) => res.json(await svc.iniciar())));
router.post('/desconectar', asyncHandler(async (req, res) => res.json(await svc.desconectar())));

router.get('/conversas', asyncHandler((req, res) => res.json(svc.listarConversas(req.query))));
router.get('/conversas/:id', asyncHandler((req, res) => res.json(svc.obterConversa(req.params.id))));
router.put('/conversas/:id/status', asyncHandler((req, res) => res.json(svc.atualizarStatusConversa(req.params.id, req.body.status))));
router.post('/conversas/:id/marcar-lida', asyncHandler((req, res) => res.json(svc.marcarLida(req.params.id))));
router.post('/conversas/:id/mensagens', asyncHandler(async (req, res) => res.status(201).json(await svc.enviarTexto(req.params.id, req.body.texto))));

module.exports = router;
