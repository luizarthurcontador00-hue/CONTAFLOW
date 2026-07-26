'use strict';

const express = require('express');
const { asyncHandler } = require('../utils/errors');
const rel = require('../services/relatoriosService');

const router = express.Router();

const money = (v) => Number(v || 0).toFixed(2).replace('.', ',');

/** Envia a resposta no formato pedido (json padrao, csv ou xls). */
function enviar(res, { formato, titulo, colunas, linhas, json }) {
  if (formato === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug(titulo)}.csv"`);
    return res.send(rel.gerarCSV(colunas, linhas));
  }
  if (formato === 'xls') {
    res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${slug(titulo)}.xls"`);
    return res.send(rel.gerarXLS(titulo, colunas, linhas));
  }
  return res.json(json);
}

function slug(s) { return String(s).toLowerCase().normalize('NFD').replace(/[^\w]+/g, '-'); }

// ----------------------------- Estoque -----------------------------
router.get('/estoque', asyncHandler((req, res) => {
  const dados = rel.estoqueAtual(req.query);
  const colunas = [
    { chave: 'nome', titulo: 'Produto' },
    { chave: 'categoria', titulo: 'Categoria' },
    { chave: 'estoque_atual', titulo: 'Estoque' },
    { chave: 'estoque_minimo', titulo: 'Mínimo' },
    { chave: 'custo', titulo: 'Custo' },
    { chave: 'preco_venda', titulo: 'Preço venda' },
    { chave: 'valor_custo', titulo: 'Valor em custo' },
    { chave: 'valor_venda', titulo: 'Valor em venda' },
  ];
  const linhas = dados.itens.map((i) => ({
    ...i, custo: money(i.custo), preco_venda: money(i.preco_venda),
    valor_custo: money(i.valor_custo), valor_venda: money(i.valor_venda),
  }));
  enviar(res, { formato: req.query.formato, titulo: 'Relatorio de Estoque', colunas, linhas, json: dados });
}));

// ------------------------------ Vendas -----------------------------
router.get('/vendas', asyncHandler((req, res) => {
  const dados = rel.vendasDetalhado(req.query);
  const colunas = [
    { chave: 'id', titulo: 'Venda' },
    { chave: 'data', titulo: 'Data' },
    { chave: 'itens', titulo: 'Itens' },
    { chave: 'formas', titulo: 'Formas de pagamento' },
    { chave: 'valor_bruto', titulo: 'Bruto' },
    { chave: 'desconto', titulo: 'Desconto' },
    { chave: 'valor_total', titulo: 'Total' },
    { chave: 'status', titulo: 'Status' },
  ];
  const linhas = dados.itens.map((v) => ({
    ...v, valor_bruto: money(v.valor_bruto), desconto: money(v.desconto), valor_total: money(v.valor_total),
  }));
  enviar(res, { formato: req.query.formato, titulo: 'Relatorio de Vendas', colunas, linhas, json: dados });
}));

// ---------------------------- Financeiro ---------------------------
router.get('/financeiro', asyncHandler((req, res) => {
  const dados = rel.financeiro(req.query);
  // Para exportacao, unifica pagar/receber com uma coluna tipo.
  const colunas = [
    { chave: 'tipo', titulo: 'Tipo' },
    { chave: 'descricao', titulo: 'Descrição' },
    { chave: 'vencimento', titulo: 'Vencimento' },
    { chave: 'valor', titulo: 'Valor' },
    { chave: 'status', titulo: 'Situação' },
  ];
  const linhas = [
    ...dados.pagar.map((c) => ({ tipo: 'A pagar', descricao: c.descricao, vencimento: c.vencimento, valor: money(c.valor), status: c.status })),
    ...dados.receber.map((c) => ({ tipo: 'A receber', descricao: c.descricao, vencimento: c.vencimento, valor: money(c.valor), status: c.status })),
  ];
  enviar(res, { formato: req.query.formato, titulo: 'Relatorio Financeiro', colunas, linhas, json: dados });
}));

// ------------------------- Produtos parados -------------------------
router.get('/parados', asyncHandler((req, res) => {
  const dados = rel.produtosParados(req.query);
  const colunas = [
    { chave: 'nome', titulo: 'Produto' },
    { chave: 'categoria', titulo: 'Categoria' },
    { chave: 'estoque_atual', titulo: 'Estoque' },
    { chave: 'dias_sem_venda', titulo: 'Dias sem venda' },
    { chave: 'valor_parado', titulo: 'Valor parado (custo)' },
  ];
  const linhas = dados.itens.map((i) => ({
    ...i, dias_sem_venda: i.dias_sem_venda == null ? 'Nunca vendido' : i.dias_sem_venda,
    valor_parado: money(i.valor_parado),
  }));
  enviar(res, { formato: req.query.formato, titulo: 'Produtos Parados', colunas, linhas, json: dados });
}));

// ------------------------- Exportar para o contador -------------------------
router.get('/contador', asyncHandler((req, res) => {
  const buffer = rel.exportarContador(req.query);
  const nome = `fechamento-${req.query.inicio || 'periodo'}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
  res.send(buffer);
}));

module.exports = router;
