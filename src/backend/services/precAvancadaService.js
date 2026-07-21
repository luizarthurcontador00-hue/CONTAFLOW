'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

/**
 * Precificacao avancada por markup divisor para pequenos negocios.
 * Toda a matematica derivada mora aqui (fonte unica da verdade): faturamento
 * liquido, impostos, AV% de despesas e o preco de venda sugerido com a
 * validacao "Prova Real" (que deve sempre fechar em R$ 0,00).
 */

// -------- Modulo 4: tabela de referencia de mercado (dados fixos) ----------
const TABELA_ATIVIDADES = {
  comercio: {
    nome: 'Comércio',
    despesa_fixa: { faixa: '15% a 25%', valor: 25 },
    custo_variavel: { faixa: '50% a 70%', valor: 70 },
    lucratividade: { faixa: '10% a 20%', valor: 10 },
  },
  servicos: {
    nome: 'Serviços',
    despesa_fixa: { faixa: '30% a 40%', valor: 40 },
    custo_variavel: { faixa: '20% a 40%', valor: 40 },
    lucratividade: { faixa: '20% a 35%', valor: 20 },
  },
  industria: {
    nome: 'Indústria',
    despesa_fixa: { faixa: '20% a 30%', valor: 30 },
    custo_variavel: { faixa: '45% a 60%', valor: 60 },
    lucratividade: { faixa: '10% a 15%', valor: 10 },
  },
};

const dinheiro = (n) => Number(Number(n || 0).toFixed(2));
const pct1 = (n) => Number(Number(n || 0).toFixed(1));
/** Equivalente a SEERRO(a/b; 0): retorna 0 quando b e invalido/zero. */
const dividirSeguro = (a, b) => (Number(b) ? Number(a) / Number(b) : 0);

// ------------------------------- Leitura -------------------------------
function getConfig() {
  return getDb().prepare('SELECT * FROM precificacao_config WHERE id = 1').get();
}
function listarDespesas() {
  return getDb().prepare('SELECT * FROM precificacao_despesas ORDER BY tipo, ordem, id').all();
}
function listarProdutos() {
  return getDb().prepare('SELECT * FROM precificacao_produtos ORDER BY (lote_data IS NULL), lote_data DESC, ordem, id').all();
}

/** Contexto (percentuais) usado no calculo de cada produto. Fonte unica. */
function contextoCalculo() {
  const cfg = getConfig();
  const bruto = Number(cfg.faturamento_mensal || 0);
  const impostosAtualPct = pct1(
    Number(cfg.simples_nacional_pct || 0) + Number(cfg.icms_pct || 0) + Number(cfg.pis_pct || 0) +
    Number(cfg.cofins_pct || 0) + Number(cfg.ir_pct || 0) + Number(cfg.cs_pct || 0)
  );
  const totalFixas = getDb()
    .prepare("SELECT COALESCE(SUM(valor),0) s FROM precificacao_despesas WHERE tipo='fixa'").get().s;
  const avFixasReal = pct1(dividirSeguro(totalFixas, bruto) * 100);
  const atividade = TABELA_ATIVIDADES[cfg.atividade] ? cfg.atividade : 'comercio';
  return {
    impostosPct: impostosAtualPct,
    despFixaSetorPct: TABELA_ATIVIDADES[atividade].despesa_fixa.valor,
    avFixasReal,
  };
}

// --------------------------- Calculo completo ---------------------------
function calcularTudo() {
  const cfg = getConfig();
  const despesas = listarDespesas();
  const produtos = listarProdutos();

  const bruto = Number(cfg.faturamento_mensal || 0);

  // Modulo 2 - impostos
  const impostosAtual = [
    { chave: 'simples_nacional', nome: 'Simples Nacional', pct: Number(cfg.simples_nacional_pct || 0) },
    { chave: 'icms', nome: 'ICMS', pct: Number(cfg.icms_pct || 0) },
    { chave: 'pis', nome: 'PIS', pct: Number(cfg.pis_pct || 0) },
    { chave: 'cofins', nome: 'COFINS', pct: Number(cfg.cofins_pct || 0) },
    { chave: 'ir', nome: 'IR (Imposto de Renda)', pct: Number(cfg.ir_pct || 0) },
    { chave: 'cs', nome: 'CS (Contribuição Social)', pct: Number(cfg.cs_pct || 0) },
  ].map((i) => ({ ...i, valor: dinheiro(bruto * i.pct / 100) }));

  const impostosReforma = [
    { chave: 'ibs', nome: 'IBS', pct: Number(cfg.ibs_pct || 0) },
    { chave: 'cbs', nome: 'CBS', pct: Number(cfg.cbs_pct || 0) },
  ].map((i) => ({ ...i, valor: dinheiro(bruto * i.pct / 100) }));

  const totalImpostosAtualPct = pct1(impostosAtual.reduce((s, i) => s + i.pct, 0));
  const totalImpostosReformaPct = pct1(impostosReforma.reduce((s, i) => s + i.pct, 0));
  const totalImpostosValor = dinheiro(
    impostosAtual.reduce((s, i) => s + i.valor, 0) + impostosReforma.reduce((s, i) => s + i.valor, 0)
  );
  const faturamentoLiquido = dinheiro(bruto - totalImpostosValor);

  // Modulo 3 - despesas
  const fixas = despesas.filter((d) => d.tipo === 'fixa').map((d) => ({ ...d, av: dividirSeguro(d.valor, bruto) * 100 }));
  const variaveis = despesas.filter((d) => d.tipo === 'variavel').map((d) => ({ ...d, av: dividirSeguro(d.valor, bruto) * 100 }));
  const totalFixas = dinheiro(fixas.reduce((s, d) => s + Number(d.valor), 0));
  const totalVariaveis = dinheiro(variaveis.reduce((s, d) => s + Number(d.valor), 0));
  const totalDespesas = dinheiro(totalFixas + totalVariaveis);
  const avFixasReal = pct1(dividirSeguro(totalFixas, bruto) * 100);
  const avVariaveisReal = pct1(dividirSeguro(totalVariaveis, bruto) * 100);

  const atividade = TABELA_ATIVIDADES[cfg.atividade] ? cfg.atividade : 'comercio';
  const ref = TABELA_ATIVIDADES[atividade];

  // Modulo 5 - produtos (markup divisor + prova real)
  const ctx = { impostosPct: totalImpostosAtualPct, despFixaSetorPct: ref.despesa_fixa.valor, avFixasReal };
  const produtosCalc = produtos.map((p) => calcularProduto(p, ctx));

  // Agrupa por lote de importacao (o grupo sem lote = "Produtos avulsos").
  const mapaGrupos = new Map();
  produtosCalc.forEach((p) => {
    const chave = p.lote || '__avulsos__';
    if (!mapaGrupos.has(chave)) {
      mapaGrupos.set(chave, {
        lote: p.lote || null,
        rotulo: p.lote || 'Produtos avulsos',
        lote_data: p.lote_data || null,
        itens: [],
      });
    }
    mapaGrupos.get(chave).itens.push(p);
  });
  const grupos = Array.from(mapaGrupos.values()).map((g) => ({
    ...g,
    qtd: g.itens.length,
    aplicaveis: g.itens.filter((i) => i.produto_id && !i.markup_invalido && i.preco_sugerido > 0).length,
  }));

  return {
    config: cfg,
    modulo2: {
      faturamento_bruto: dinheiro(bruto),
      impostos_atual: impostosAtual,
      impostos_reforma: impostosReforma,
      total_impostos_atual_pct: totalImpostosAtualPct,
      total_impostos_reforma_pct: totalImpostosReformaPct,
      total_impostos_valor: totalImpostosValor,
      faturamento_liquido: faturamentoLiquido,
    },
    modulo3: {
      fixas, variaveis,
      total_fixas: totalFixas, total_variaveis: totalVariaveis, total_despesas: totalDespesas,
      av_fixas_real: avFixasReal, av_variaveis_real: avVariaveisReal,
      atividade,
      max_desp_fixa_pct: ref.despesa_fixa.valor,
      max_desp_variavel_pct: ref.custo_variavel.valor,
      lucratividade_esperada_pct: ref.lucratividade.valor,
    },
    modulo4: TABELA_ATIVIDADES,
    modulo5: produtosCalc,
    modulo5_grupos: grupos,
  };
}

/** Calcula os derivados de um produto (linha do Modulo 5). */
function calcularProduto(p, ctx) {
  const quantidade = Number(p.quantidade || 0);
  const valorPedido = Number(p.valor_pedido || 0);
  const custoUnit = dinheiro(dividirSeguro(valorPedido, quantidade));
  const custoTotalProduto = dinheiro(custoUnit + Number(p.custo_frete_fixo || 0) + Number(p.custo_embalagem || 0));

  const fretePct = Number(p.frete_pct || 0);
  const cartaoPct = Number(p.taxa_cartao_pct || 0);
  const impostosPct = Number(ctx.impostosPct || 0);
  const margemPct = Number(p.margem_pct || 0);
  const despFixaPct = p.usar_margem_setor ? Number(ctx.despFixaSetorPct || 0) : Number(ctx.avFixasReal || 0);

  const somaPct = fretePct + cartaoPct + impostosPct + margemPct + despFixaPct;
  const denomPct = 100 - somaPct;
  // Markup multiplicador = 1 / (100% - soma%). SEERRO -> 0 quando invalido.
  const markup = denomPct > 0 ? 100 / denomPct : 0;
  const precoSugerido = dinheiro(custoTotalProduto * markup);

  // Margem de lucro atual (sobre o preco praticado)
  const precoPraticado = p.preco_praticado != null ? Number(p.preco_praticado) : null;
  let margemAtual = 0;
  if (precoPraticado) {
    const descontos = precoPraticado * (fretePct + cartaoPct + impostosPct + despFixaPct) / 100;
    margemAtual = dividirSeguro(precoPraticado - custoTotalProduto - descontos, precoPraticado) * 100;
  }

  // Prova Real: decomposicao do preco sugerido (deve somar zero).
  const pr = {
    frete: dinheiro(precoSugerido * fretePct / 100),
    cartao: dinheiro(precoSugerido * cartaoPct / 100),
    impostos: dinheiro(precoSugerido * impostosPct / 100),
    margem: dinheiro(precoSugerido * margemPct / 100),
    despesas: dinheiro(precoSugerido * despFixaPct / 100),
    custo_produto: custoTotalProduto,
  };
  const provaReal = dinheiro(precoSugerido - (pr.frete + pr.cartao + pr.impostos + pr.margem + pr.despesas + pr.custo_produto));

  return {
    ...p,
    custo_unitario: custoUnit,
    custo_total_produto: custoTotalProduto,
    impostos_pct: pct1(impostosPct),
    desp_fixa_pct_aplicado: pct1(despFixaPct),
    markup: Number(markup.toFixed(4)),
    markup_invalido: denomPct <= 0,
    preco_sugerido: precoSugerido,
    margem_atual_pct: pct1(margemAtual),
    prova_real: { ...pr, total: provaReal },
  };
}

// ------------------------------- Escrita -------------------------------
const CAMPOS_CONFIG = [
  'faturamento_mensal', 'simples_nacional_pct', 'icms_pct', 'pis_pct', 'cofins_pct',
  'ir_pct', 'cs_pct', 'ibs_pct', 'cbs_pct', 'atividade',
];

function salvarConfig(dados) {
  const db = getDb();
  const atual = getConfig();
  const merged = {};
  CAMPOS_CONFIG.forEach((c) => {
    merged[c] = dados[c] !== undefined ? dados[c] : atual[c];
  });
  if (!TABELA_ATIVIDADES[merged.atividade]) merged.atividade = 'comercio';
  db.prepare(`
    UPDATE precificacao_config SET
      faturamento_mensal=@faturamento_mensal, simples_nacional_pct=@simples_nacional_pct,
      icms_pct=@icms_pct, pis_pct=@pis_pct, cofins_pct=@cofins_pct, ir_pct=@ir_pct,
      cs_pct=@cs_pct, ibs_pct=@ibs_pct, cbs_pct=@cbs_pct, atividade=@atividade,
      atualizado_em=datetime('now','localtime')
    WHERE id = 1
  `).run({
    faturamento_mensal: Number(merged.faturamento_mensal || 0),
    simples_nacional_pct: Number(merged.simples_nacional_pct || 0),
    icms_pct: Number(merged.icms_pct || 0),
    pis_pct: Number(merged.pis_pct || 0),
    cofins_pct: Number(merged.cofins_pct || 0),
    ir_pct: Number(merged.ir_pct || 0),
    cs_pct: Number(merged.cs_pct || 0),
    ibs_pct: Number(merged.ibs_pct || 0),
    cbs_pct: Number(merged.cbs_pct || 0),
    atividade: merged.atividade,
  });
  return calcularTudo();
}

function criarDespesa(dados) {
  const db = getDb();
  const tipo = dados.tipo === 'variavel' ? 'variavel' : 'fixa';
  const descricao = (dados.descricao || '').trim() || 'Nova despesa';
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem),0)+1 o FROM precificacao_despesas WHERE tipo=?').get(tipo).o;
  db.prepare('INSERT INTO precificacao_despesas (tipo, descricao, valor, ordem) VALUES (?, ?, ?, ?)')
    .run(tipo, descricao, Number(dados.valor || 0), ordem);
  return calcularTudo();
}

function atualizarDespesa(id, dados) {
  const db = getDb();
  const d = db.prepare('SELECT * FROM precificacao_despesas WHERE id=?').get(id);
  if (!d) throw new AppError('Despesa não encontrada.', 404);
  db.prepare('UPDATE precificacao_despesas SET descricao=?, valor=? WHERE id=?')
    .run(dados.descricao !== undefined ? String(dados.descricao) : d.descricao, Number(dados.valor != null ? dados.valor : d.valor), id);
  return calcularTudo();
}

function excluirDespesa(id) {
  getDb().prepare('DELETE FROM precificacao_despesas WHERE id=?').run(id);
  return calcularTudo();
}

const CAMPOS_PRODUTO = [
  'referencia', 'descricao', 'quantidade', 'valor_pedido', 'custo_embalagem',
  'custo_frete_fixo', 'frete_pct', 'taxa_cartao_pct', 'margem_pct',
  'usar_margem_setor', 'preco_mercado', 'preco_praticado',
];

function criarProduto(dados = {}) {
  const db = getDb();
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem),0)+1 o FROM precificacao_produtos').get().o;
  db.prepare(`
    INSERT INTO precificacao_produtos
      (referencia, descricao, quantidade, valor_pedido, custo_embalagem, custo_frete_fixo,
       frete_pct, taxa_cartao_pct, margem_pct, usar_margem_setor, preco_mercado, preco_praticado, ordem)
    VALUES (@referencia, @descricao, @quantidade, @valor_pedido, @custo_embalagem, @custo_frete_fixo,
       @frete_pct, @taxa_cartao_pct, @margem_pct, @usar_margem_setor, @preco_mercado, @preco_praticado, @ordem)
  `).run({
    referencia: dados.referencia || null,
    descricao: (dados.descricao || 'Novo produto').toString(),
    quantidade: Number(dados.quantidade || 1),
    valor_pedido: Number(dados.valor_pedido || 0),
    custo_embalagem: Number(dados.custo_embalagem || 0),
    custo_frete_fixo: Number(dados.custo_frete_fixo || 0),
    frete_pct: Number(dados.frete_pct || 0),
    taxa_cartao_pct: Number(dados.taxa_cartao_pct || 0),
    margem_pct: Number(dados.margem_pct || 0),
    usar_margem_setor: dados.usar_margem_setor === false || dados.usar_margem_setor === 0 || dados.usar_margem_setor === '0' ? 0 : 1,
    preco_mercado: dados.preco_mercado != null && dados.preco_mercado !== '' ? Number(dados.preco_mercado) : null,
    preco_praticado: dados.preco_praticado != null && dados.preco_praticado !== '' ? Number(dados.preco_praticado) : null,
    ordem,
  });
  return calcularTudo();
}

function atualizarProduto(id, dados) {
  const db = getDb();
  const p = db.prepare('SELECT * FROM precificacao_produtos WHERE id=?').get(id);
  if (!p) throw new AppError('Produto de precificação não encontrado.', 404);
  const m = {};
  CAMPOS_PRODUTO.forEach((c) => { m[c] = dados[c] !== undefined ? dados[c] : p[c]; });
  db.prepare(`
    UPDATE precificacao_produtos SET
      referencia=@referencia, descricao=@descricao, quantidade=@quantidade, valor_pedido=@valor_pedido,
      custo_embalagem=@custo_embalagem, custo_frete_fixo=@custo_frete_fixo, frete_pct=@frete_pct,
      taxa_cartao_pct=@taxa_cartao_pct, margem_pct=@margem_pct, usar_margem_setor=@usar_margem_setor,
      preco_mercado=@preco_mercado, preco_praticado=@preco_praticado, atualizado_em=datetime('now','localtime')
    WHERE id=@id
  `).run({
    referencia: m.referencia || null,
    descricao: (m.descricao || '').toString(),
    quantidade: Number(m.quantidade || 0),
    valor_pedido: Number(m.valor_pedido || 0),
    custo_embalagem: Number(m.custo_embalagem || 0),
    custo_frete_fixo: Number(m.custo_frete_fixo || 0),
    frete_pct: Number(m.frete_pct || 0),
    taxa_cartao_pct: Number(m.taxa_cartao_pct || 0),
    margem_pct: Number(m.margem_pct || 0),
    usar_margem_setor: (m.usar_margem_setor === false || m.usar_margem_setor === 0 || m.usar_margem_setor === '0') ? 0 : 1,
    preco_mercado: m.preco_mercado != null && m.preco_mercado !== '' ? Number(m.preco_mercado) : null,
    preco_praticado: m.preco_praticado != null && m.preco_praticado !== '' ? Number(m.preco_praticado) : null,
    id,
  });
  return calcularTudo();
}

function excluirProduto(id) {
  getDb().prepare('DELETE FROM precificacao_produtos WHERE id=?').run(id);
  return calcularTudo();
}

/**
 * Cria linhas de precificacao a partir de produtos importados (cadastro em
 * lote ou NF-e), vinculadas ao produto real e agrupadas por um rotulo de lote.
 * itens: [{ produto_id, referencia, descricao, quantidade, valor_pedido }]
 */
function importarProdutos(itens, rotulo) {
  if (!Array.isArray(itens) || !itens.length) return { criadas: 0, lote: rotulo };
  const db = getDb();
  const loteData = new Date().toISOString();
  const base = db.prepare('SELECT COALESCE(MAX(ordem),0) o FROM precificacao_produtos').get().o;
  const ins = db.prepare(`
    INSERT INTO precificacao_produtos
      (produto_id, referencia, descricao, quantidade, valor_pedido, lote, lote_data, ordem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const tx = db.transaction(() => {
    itens.forEach((it, i) => ins.run(
      it.produto_id || null,
      it.referencia || null,
      (it.descricao || 'Produto').toString(),
      Number(it.quantidade || 1),
      Number(it.valor_pedido || 0),
      rotulo,
      loteData,
      base + i + 1
    ));
  });
  tx();
  return { criadas: itens.length, lote: rotulo };
}

/** Grava o preco sugerido de uma linha no produto real vinculado. */
function aplicarPreco(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM precificacao_produtos WHERE id=?').get(id);
  if (!row) throw new AppError('Linha de precificação não encontrada.', 404);
  if (!row.produto_id) throw new AppError('Esta linha não está vinculada a um produto do cadastro.');
  const calc = calcularProduto(row, contextoCalculo());
  if (calc.markup_invalido || !(calc.preco_sugerido > 0)) {
    throw new AppError('Preço sugerido inválido — revise os percentuais (a soma não pode chegar a 100%).');
  }
  db.prepare("UPDATE produtos SET preco_venda=?, atualizado_em=datetime('now','localtime') WHERE id=?")
    .run(calc.preco_sugerido, row.produto_id);
  return { ok: true, produto_id: row.produto_id, preco: calc.preco_sugerido, estado: calcularTudo() };
}

/** Aplica o preco sugerido de todas as linhas vinculadas de um lote. */
function aplicarPrecoLote(lote) {
  const db = getDb();
  const rows = lote
    ? db.prepare('SELECT * FROM precificacao_produtos WHERE lote=? AND produto_id IS NOT NULL').all(lote)
    : db.prepare('SELECT * FROM precificacao_produtos WHERE lote IS NULL AND produto_id IS NOT NULL').all();
  const ctx = contextoCalculo();
  const upd = db.prepare("UPDATE produtos SET preco_venda=?, atualizado_em=datetime('now','localtime') WHERE id=?");
  let aplicados = 0, ignorados = 0;
  const tx = db.transaction(() => {
    rows.forEach((row) => {
      const calc = calcularProduto(row, ctx);
      if (calc.markup_invalido || !(calc.preco_sugerido > 0)) { ignorados++; return; }
      upd.run(calc.preco_sugerido, row.produto_id);
      aplicados++;
    });
  });
  tx();
  return { aplicados, ignorados, estado: calcularTudo() };
}

/** Exclui todas as linhas de um lote. */
function excluirLote(lote) {
  const db = getDb();
  if (lote) db.prepare('DELETE FROM precificacao_produtos WHERE lote=?').run(lote);
  else db.prepare('DELETE FROM precificacao_produtos WHERE lote IS NULL').run();
  return calcularTudo();
}

module.exports = {
  TABELA_ATIVIDADES,
  calcularTudo,
  salvarConfig,
  criarDespesa, atualizarDespesa, excluirDespesa,
  criarProduto, atualizarProduto, excluirProduto,
  importarProdutos, aplicarPreco, aplicarPrecoLote, excluirLote,
};
