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

// ------------------------- Vendas × Custo (conferência DRE) -------------------------
router.get('/vendas-custo', asyncHandler((req, res) => {
  const dados = rel.vendasComCusto(req.query);
  const colunas = [
    { chave: 'venda_id', titulo: 'Venda' },
    { chave: 'data', titulo: 'Data' },
    { chave: 'produto_nome', titulo: 'Produto/Serviço' },
    { chave: 'tipo', titulo: 'Tipo' },
    { chave: 'quantidade', titulo: 'Qtd' },
    { chave: 'valor_total', titulo: 'Valor' },
    { chave: 'custo_total', titulo: 'Custo' },
  ];
  const linhas = dados.itens.map((i) => ({
    ...i, valor_total: money(i.valor_total), custo_total: money(i.custo_total),
  }));
  enviar(res, { formato: req.query.formato, titulo: 'Vendas x Custo', colunas, linhas, json: dados });
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

// ------------------------- Ofertas (instituto) -------------------------
router.get('/ofertas', asyncHandler((req, res) => {
  const dados = rel.ofertasRelatorio(req.query);
  const colunas = [
    { chave: 'data', titulo: 'Data' },
    { chave: 'doador', titulo: 'Doador' },
    { chave: 'valor', titulo: 'Valor' },
    { chave: 'forma', titulo: 'Forma' },
    { chave: 'conta', titulo: 'Entrou na conta' },
    { chave: 'projeto', titulo: 'Projeto' },
    { chave: 'recibo', titulo: 'Recibo emitido' },
  ];
  const linhas = dados.itens.map((o) => ({
    ...o, valor: money(o.valor), recibo: o.recibo_emitido ? 'Sim' : 'Não',
  }));
  enviar(res, { formato: req.query.formato, titulo: 'Relatorio de Ofertas', colunas, linhas, json: dados });
}));

// -------------------- Turmas e matriculas (instituto) --------------------
router.get('/turmas', asyncHandler((req, res) => {
  const dados = rel.turmasRelatorio();
  const colunas = [
    { chave: 'turma', titulo: 'Turma' },
    { chave: 'curso', titulo: 'Curso' },
    { chave: 'horarios', titulo: 'Horários' },
    { chave: 'instrutores', titulo: 'Instrutores' },
    { chave: 'aluno', titulo: 'Aluno' },
    { chave: 'telefone', titulo: 'Telefone' },
    { chave: 'responsavel', titulo: 'Responsável' },
  ];
  // Na exportacao vira uma linha por aluno (formato que a secretaria usa).
  const linhas = [];
  dados.itens.forEach((t) => {
    if (!t.alunos.length) {
      linhas.push({ turma: t.nome, curso: t.curso || '', horarios: t.horarios, instrutores: t.instrutores || '', aluno: '(sem matrículas)', telefone: '', responsavel: '' });
      return;
    }
    t.alunos.forEach((a) => linhas.push({
      turma: t.nome, curso: t.curso || '', horarios: t.horarios, instrutores: t.instrutores || '',
      aluno: a.nome, telefone: a.telefone || '',
      responsavel: a.responsavel_nome ? `${a.responsavel_nome}${a.responsavel_telefone ? ' (' + a.responsavel_telefone + ')' : ''}` : '',
    }));
  });
  enviar(res, { formato: req.query.formato, titulo: 'Turmas e Matriculas', colunas, linhas, json: dados });
}));

// --------------------------- CRM (agencia de viagem) ---------------------------
router.get('/crm', asyncHandler((req, res) => {
  const dados = rel.funilCRM(req.query);
  const colunas = [
    { chave: 'lead_nome', titulo: 'Cliente' },
    { chave: 'descricao', titulo: 'Descrição' },
    { chave: 'agente_nome', titulo: 'Funcionário' },
    { chave: 'valor_venda', titulo: 'Valor da venda' },
    { chave: 'comissao_valor', titulo: 'Comissão agência' },
    { chave: 'comissao_funcionario_valor', titulo: 'Comissão funcionário' },
  ];
  const linhas = dados.vendas.map((v) => ({
    ...v, valor_venda: money(v.valor_venda), comissao_valor: money(v.comissao_valor),
    comissao_funcionario_valor: money(v.comissao_funcionario_valor || 0),
  }));
  enviar(res, { formato: req.query.formato, titulo: 'Funil do CRM', colunas, linhas, json: dados });
}));

// ------------------------------- Viagens -------------------------------
router.get('/viagens', asyncHandler((req, res) => {
  const dados = rel.viagensRelatorio(req.query);
  const colunas = [
    { chave: 'cliente_nome', titulo: 'Cliente' },
    { chave: 'descricao', titulo: 'Destino/pacote' },
    { chave: 'data_ida', titulo: 'Ida' },
    { chave: 'data_volta', titulo: 'Volta' },
    { chave: 'agente_nome', titulo: 'Funcionário' },
    { chave: 'valor_venda', titulo: 'Valor da venda' },
    { chave: 'comissao_valor', titulo: 'Comissão agência' },
    { chave: 'comissao_funcionario_valor', titulo: 'Comissão funcionário' },
  ];
  const linhas = dados.itens.map((v) => ({
    ...v, valor_venda: money(v.valor_venda), comissao_valor: money(v.comissao_valor),
    comissao_funcionario_valor: money(v.comissao_funcionario_valor || 0),
  }));
  enviar(res, { formato: req.query.formato, titulo: 'Relatorio de Viagens', colunas, linhas, json: dados });
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
