'use strict';

const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const { uploadFoto } = require('../middleware/upload');
const produtos = require('../services/produtosService');

const router = express.Router();

// Lista com filtros: busca, categoria_id, estoque_baixo
router.get('/', asyncHandler((req, res) => {
  res.json(produtos.listar({
    busca: req.query.busca,
    categoria_id: req.query.categoria_id,
    estoque_baixo: req.query.estoque_baixo,
    incluir_inativos: req.query.incluir_inativos === '1',
  }));
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
