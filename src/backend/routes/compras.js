'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { asyncHandler, AppError } = require('../utils/errors');
const { uploadXml } = require('../middleware/upload');
const { parseNFe } = require('../services/nfeParser');
const compras = require('../services/comprasService');
const paths = require('../paths');

const router = express.Router();

// Historico de compras
router.get('/', asyncHandler((req, res) => {
  res.json(compras.listarCompras());
}));

router.get('/:id', asyncHandler((req, res) => {
  res.json(compras.obterCompra(req.params.id));
}));

/**
 * Passo 1: upload do XML -> parse -> preview (NAO persiste a compra).
 * Se o XML for invalido, remove o arquivo salvo e retorna erro amigavel.
 */
router.post('/importar-xml', uploadXml.single('xml'), asyncHandler((req, res) => {
  if (!req.file) throw new AppError('Selecione um arquivo XML de NF-e.');
  const caminho = req.file.path;
  let conteudo;
  try {
    conteudo = fs.readFileSync(caminho, 'utf8');
    const nfe = parseNFe(conteudo);
    const preview = compras.montarPreview(nfe, req.file.filename);
    res.json(preview);
  } catch (err) {
    // XML invalido/duplicado: nao deixa lixo no disco.
    try { fs.unlinkSync(caminho); } catch (_) { /* ignora */ }
    throw err;
  }
}));

/**
 * Passo 2: confirma a importacao com os ajustes do usuario (produtos novos,
 * vinculos, conta a pagar).
 */
router.post('/confirmar', asyncHandler((req, res) => {
  const resultado = compras.confirmarImportacao(req.body);
  res.status(201).json(resultado);
}));

// Baixar/visualizar o XML de uma compra
router.get('/:id/xml', asyncHandler((req, res) => {
  const compra = compras.obterCompra(req.params.id);
  if (!compra.xml_path) throw new AppError('Esta compra nao possui XML.', 404);
  const arquivo = path.join(paths.notasDir, path.basename(compra.xml_path));
  if (!fs.existsSync(arquivo)) throw new AppError('Arquivo XML nao encontrado.', 404);
  res.type('application/xml').sendFile(arquivo);
}));

module.exports = router;
