'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const { uploadWhatsappMidia } = require('../middleware/upload');
const svc = require('../services/whatsappService');

const router = express.Router();

router.get('/status', asyncHandler((req, res) => res.json(svc.status())));
router.post('/conectar', asyncHandler(async (req, res) => res.json(await svc.iniciar())));
router.post('/desconectar', asyncHandler(async (req, res) => res.json(await svc.desconectar())));

router.get('/conversas', asyncHandler((req, res) => res.json(svc.listarConversas(req.query))));
router.post('/conversas', asyncHandler(async (req, res) => res.status(201).json(await svc.iniciarConversa(req.body.telefone, req.body.texto, req.body.nome, req.body.atendente_id))));
router.get('/conversas/:id', asyncHandler((req, res) => res.json(svc.obterConversa(req.params.id))));
router.put('/conversas/:id/status', asyncHandler((req, res) => res.json(svc.atualizarStatusConversa(req.params.id, req.body.status))));
router.put('/conversas/:id/atendente', asyncHandler((req, res) => res.json(svc.atribuirAtendente(req.params.id, req.body.atendente_id))));
router.post('/conversas/:id/iniciar-atendimento', asyncHandler((req, res) => res.json(svc.iniciarAtendimento(req.params.id, req.body.atendente_id))));
router.post('/conversas/:id/alternar-bot', asyncHandler((req, res) => res.json(svc.alternarModoConversa(req.params.id))));
router.post('/conversas/:id/finalizar', asyncHandler((req, res) => res.json(svc.finalizarConversa(req.params.id, req.body.comentario))));
router.post('/conversas/:id/marcar-lida', asyncHandler((req, res) => res.json(svc.marcarLida(req.params.id))));
router.post('/conversas/:id/digitando', asyncHandler(async (req, res) => res.json(await svc.enviarDigitando(req.params.id))));
router.post('/conversas/:id/mensagens', asyncHandler(async (req, res) => res.status(201).json(await svc.enviarTexto(req.params.id, req.body.texto, req.body.atendente_id))));
router.post('/conversas/:id/midia', uploadWhatsappMidia.single('arquivo'), asyncHandler(async (req, res) => {
  if (!req.file) throw new AppError('Nenhum arquivo enviado.');
  const resultado = await svc.enviarMidia(req.params.id, {
    arquivoSalvo: req.file.filename,
    mimetype: req.file.mimetype,
    nomeOriginal: req.file.originalname,
    legenda: req.body.legenda,
    comoAudio: req.body.como_audio === '1' || req.body.como_audio === 'true',
    atendenteId: req.body.atendente_id,
  });
  res.status(201).json(resultado);
}));

// ------------------------------- Contatos -------------------------------
router.get('/contatos', asyncHandler((req, res) => res.json(svc.listarContatos(req.query))));
router.get('/contatos/:id', asyncHandler((req, res) => res.json(svc.obterContato(req.params.id))));
router.put('/contatos/:id', asyncHandler((req, res) => res.json(svc.atualizarContato(req.params.id, req.body.nome))));

// ------------------------------- Bot configuravel -------------------------------
router.get('/bot/config', asyncHandler((req, res) => res.json(svc.obterConfigBot())));
router.put('/bot/config', asyncHandler((req, res) => res.json(svc.salvarConfigBot(req.body || {}))));
router.get('/bot/regras', asyncHandler((req, res) => res.json(svc.listarRegrasBot())));
router.post('/bot/regras', asyncHandler((req, res) => res.status(201).json(svc.criarRegraBot(req.body || {}))));
router.put('/bot/regras/:id', asyncHandler((req, res) => res.json(svc.atualizarRegraBot(req.params.id, req.body || {}))));
router.delete('/bot/regras/:id', asyncHandler((req, res) => res.json(svc.excluirRegraBot(req.params.id))));

// ------------------------------- Respostas rapidas -------------------------------
router.get('/respostas-rapidas', asyncHandler((req, res) => res.json(svc.listarRespostasRapidas())));
router.post('/respostas-rapidas', asyncHandler((req, res) => res.status(201).json(svc.criarRespostaRapida(req.body || {}))));
router.put('/respostas-rapidas/:id', asyncHandler((req, res) => res.json(svc.atualizarRespostaRapida(req.params.id, req.body || {}))));
router.delete('/respostas-rapidas/:id', asyncHandler((req, res) => res.json(svc.excluirRespostaRapida(req.params.id))));

// ------------------------------- Mensagens agendadas -------------------------------
router.get('/mensagens-agendadas', asyncHandler((req, res) => res.json(svc.listarAgendadas())));
router.post('/mensagens-agendadas', asyncHandler((req, res) => res.status(201).json(svc.criarAgendada(req.body || {}))));
router.post('/mensagens-agendadas/:id/cancelar', asyncHandler((req, res) => res.json(svc.cancelarAgendada(req.params.id))));

router.get('/mensagens-recorrentes', asyncHandler((req, res) => res.json(svc.listarRecorrentes())));
router.post('/mensagens-recorrentes', asyncHandler((req, res) => res.status(201).json(svc.criarRecorrente(req.body || {}))));
router.put('/mensagens-recorrentes/:id', asyncHandler((req, res) => res.json(svc.atualizarRecorrente(req.params.id, req.body || {}))));
router.delete('/mensagens-recorrentes/:id', asyncHandler((req, res) => res.json(svc.excluirRecorrente(req.params.id))));

module.exports = router;
