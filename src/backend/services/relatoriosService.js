'use strict';

const { getDb } = require('../db/connection');
const { arred } = require('./precificacaoService');

/** Relatorio de estoque atual com valor em custo e em venda. */
function estoqueAtual({ apenas_baixo } = {}) {
  const db = getDb();
  const where = ['p.ativo = 1'];
  if (apenas_baixo === '1' || apenas_baixo === true) where.push('p.estoque_atual <= p.estoque_minimo');
  const itens = db.prepare(`
    SELECT p.id, p.nome, p.codigo_barras, c.nome AS categoria, p.unidade,
           p.estoque_atual, p.estoque_minimo, p.custo, p.preco_venda,
           (p.estoque_atual * p.custo) AS valor_custo,
           (p.estoque_atual * p.preco_venda) AS valor_venda
    FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id
    WHERE ${where.join(' AND ')}
    ORDER BY p.nome COLLATE NOCASE
  `).all();
  const totalCusto = itens.reduce((s, i) => s + Number(i.valor_custo), 0);
  const totalVenda = itens.reduce((s, i) => s + Number(i.valor_venda), 0);
  return {
    itens: itens.map((i) => ({ ...i, valor_custo: arred(i.valor_custo), valor_venda: arred(i.valor_venda) })),
    totais: { itens: itens.length, valor_custo: arred(totalCusto), valor_venda: arred(totalVenda), lucro_potencial: arred(totalVenda - totalCusto) },
  };
}

/** Relatorio de vendas detalhado por periodo. */
function vendasDetalhado({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';
  const vendas = db.prepare(`
    SELECT v.id, v.data, v.valor_bruto, v.desconto, v.valor_total, v.status,
      (SELECT GROUP_CONCAT(forma_pagamento, ', ') FROM vendas_pagamentos vp WHERE vp.venda_id=v.id) AS formas,
      (SELECT COUNT(*) FROM vendas_itens vi WHERE vi.venda_id=v.id) AS itens
    FROM vendas v
    WHERE date(v.data) BETWEEN date(?) AND date(?)
    ORDER BY v.id DESC
  `).all(ini, f);
  const concl = vendas.filter((v) => v.status === 'concluida');
  return {
    itens: vendas,
    totais: {
      vendas: concl.length,
      faturamento: arred(concl.reduce((s, v) => s + Number(v.valor_total), 0)),
      descontos: arred(concl.reduce((s, v) => s + Number(v.desconto), 0)),
      canceladas: vendas.length - concl.length,
    },
  };
}

/** Relatorio financeiro (contas a pagar e a receber) por periodo de vencimento. */
function financeiro({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';
  const pagar = db.prepare(`
    SELECT cp.descricao, f.nome AS fornecedor, cp.valor, cp.vencimento, cp.status, cp.data_pagamento
    FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id=cp.fornecedor_id
    WHERE date(cp.vencimento) BETWEEN date(?) AND date(?) ORDER BY date(cp.vencimento)
  `).all(ini, f);
  const receber = db.prepare(`
    SELECT descricao, valor, vencimento, status, data_recebimento
    FROM contas_receber
    WHERE date(vencimento) BETWEEN date(?) AND date(?) ORDER BY date(vencimento)
  `).all(ini, f);
  return {
    pagar, receber,
    totais: {
      total_pagar: arred(pagar.reduce((s, c) => s + Number(c.valor), 0)),
      total_receber: arred(receber.filter((c) => c.status !== 'cancelada').reduce((s, c) => s + Number(c.valor), 0)),
      pagar_pendente: arred(pagar.filter((c) => c.status === 'pendente').reduce((s, c) => s + Number(c.valor), 0)),
      receber_pendente: arred(receber.filter((c) => c.status === 'pendente').reduce((s, c) => s + Number(c.valor), 0)),
    },
  };
}

// ------------------------- Exportacao -------------------------

function escaparCSV(v) {
  const s = v == null ? '' : String(v);
  return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Gera CSV (separador ';', com BOM para acentos no Excel pt-BR). */
function gerarCSV(colunas, linhas) {
  const head = colunas.map((c) => escaparCSV(c.titulo)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => escaparCSV(l[c.chave])).join(';')).join('\n');
  return '﻿' + head + '\n' + corpo;
}

function escaparHTML(v) {
  return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Gera um arquivo .xls (tabela HTML que o Excel abre como planilha). */
function gerarXLS(titulo, colunas, linhas) {
  const ths = colunas.map((c) => `<th style="background:#dbeafe;border:1px solid #93c5fd">${escaparHTML(c.titulo)}</th>`).join('');
  const trs = linhas.map((l) => '<tr>' + colunas.map((c) => `<td style="border:1px solid #cbd5e1">${escaparHTML(l[c.chave])}</td>`).join('') + '</tr>').join('');
  return `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" />
    <!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>
    <x:Name>${escaparHTML(titulo)}</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
    </x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->
    </head><body><h3>${escaparHTML(titulo)}</h3>
    <table border="1"><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
}

module.exports = {
  estoqueAtual, vendasDetalhado, financeiro,
  gerarCSV, gerarXLS,
};
