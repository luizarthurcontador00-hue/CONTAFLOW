'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const { uploadFoto, uploadPlanilha } = require('../middleware/upload');
const produtos = require('../services/produtosService');
const planilha = require('../services/planilhaService');

const router = express.Router();

// Lista com filtros: busca, categoria_id, estoque_baixo
router.get('/', asyncHandler((req, res) => {
  res.json(produtos.listar({
    busca: req.query.busca,
    categoria_id: req.query.categoria_id,
    estoque_baixo: req.query.estoque_baixo,
    incluir_inativos: req.query.incluir_inativos === '1',
    eh_servico: req.query.eh_servico,
  }));
}));

// Prepara (gera codigo interno se preciso e persiste) produtos para etiquetas.
router.post('/etiquetas/preparar', asyncHandler((req, res) => {
  const ids = (req.body && req.body.ids) || [];
  res.json(produtos.prepararEtiquetas(ids));
}));

// Cadastro em lote (grade na tela ou vindo da importacao de planilha).
router.post('/lote', asyncHandler((req, res) => {
  const linhas = (req.body && req.body.produtos) || [];
  res.json(produtos.criarLote(linhas));
}));

// Conferencia de estoque (inventario) em lote: ajusta o saldo dos produtos
// contados para a quantidade informada, registrando as diferencas.
router.post('/conferencia', asyncHandler((req, res) => {
  const itens = (req.body && req.body.itens) || [];
  const observacao = (req.body && req.body.observacao) || null;
  res.json(produtos.conferenciaEstoque(itens, observacao));
}));

// Excluir/editar varios produtos selecionados de uma vez.
router.post('/lote-excluir', asyncHandler((req, res) => {
  const ids = (req.body && req.body.ids) || [];
  res.json(produtos.excluirLote(ids));
}));

router.post('/lote-editar', asyncHandler((req, res) => {
  const ids = (req.body && req.body.ids) || [];
  const campos = (req.body && req.body.campos) || {};
  res.json(produtos.editarLote(ids, campos));
}));

// Planilha modelo para download.
router.get('/planilha/modelo', asyncHandler((req, res) => {
  const buffer = planilha.gerarModelo();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="modelo-produtos.xlsx"');
  res.send(buffer);
}));

// Le uma planilha enviada e devolve as linhas interpretadas (nao salva nada).
router.post('/planilha/importar', uploadPlanilha.single('planilha'), asyncHandler((req, res) => {
  if (!req.file) throw new AppError('Selecione um arquivo de planilha.');
  res.json(planilha.analisarPlanilha(req.file.buffer));
}));

// ----------------------------- Fotos (galeria) -----------------------------
router.get('/:id/fotos', asyncHandler((req, res) => res.json(produtos.listarFotos(req.params.id))));

router.post('/:id/fotos', uploadFoto.array('fotos', 8), asyncHandler((req, res) => {
  const arquivos = (req.files || []).map((f) => f.filename);
  res.status(201).json(produtos.adicionarFotos(req.params.id, arquivos));
}));

router.post('/:id/fotos/:fotoId/principal', asyncHandler((req, res) => {
  res.json(produtos.definirFotoPrincipal(req.params.id, req.params.fotoId));
}));

router.delete('/:id/fotos/:fotoId', asyncHandler((req, res) => {
  res.json(produtos.removerFoto(req.params.id, req.params.fotoId));
}));

// Composicao de um kit/combo.
router.get('/:id/composicao', asyncHandler((req, res) => {
  res.json(produtos.obterComposicao(req.params.id));
}));

router.put('/:id/composicao', asyncHandler((req, res) => {
  const itens = (req.body && req.body.itens) || [];
  res.json(produtos.salvarComposicao(req.params.id, itens));
}));

router.get('/:id', asyncHandler((req, res) => {
  res.json(produtos.obter(req.params.id));
}));

router.get('/:id/movimentacoes', asyncHandler((req, res) => {
  res.json(produtos.movimentacoes(req.params.id));
}));

// Criar produto (aceita multipart com campo 'foto' opcional)
router.post('/', uploadFoto.single('foto'), asyncHandler((req, res) => {
  const dados = { ...req.body };
  if (req.file) dados.foto_path = req.file.filename;
  res.status(201).json(produtos.criar(dados));
}));

// Atualizar produto
router.put('/:id', uploadFoto.single('foto'), asyncHandler((req, res) => {
  const dados = { ...req.body };
  if (req.file) {
    dados.foto_path = req.file.filename;
  } else if (req.body.remover_foto === '1') {
    dados.foto_path = null;
  }
  res.json(produtos.atualizar(req.params.id, dados));
}));

// Ajuste manual de estoque (inventario)
router.post('/:id/estoque', asyncHandler((req, res) => {
  const { quantidade, motivo } = req.body;
  if (quantidade == null) throw new AppError('Informe a nova quantidade de estoque.');
  res.json(produtos.ajustarEstoque(req.params.id, quantidade, motivo));
}));

router.delete('/:id', asyncHandler((req, res) => {
  res.json(produtos.excluir(req.params.id));
}));

module.exports = router;
