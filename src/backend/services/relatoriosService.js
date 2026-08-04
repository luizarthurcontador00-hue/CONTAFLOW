'use strict';

const XLSX = require('xlsx');
const { getDb } = require('../db/connection');
const { arred } = require('./precificacaoService');
const turmasService = require('./turmasService');

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

/**
 * Vendas item a item (produto/serviço, valor e custo lado a lado), com o
 * total de cada coluna no fim — pensado pra conferir com o CMV/CSP do DRE
 * do mesmo período: mesmas vendas concluídas, mesma janela de datas, só que
 * abertas item por item em vez de resumidas.
 */
function vendasComCusto({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';
  const itens = db.prepare(`
    SELECT vi.id, v.id AS venda_id, v.data,
      COALESCE(p.nome, vi.descricao, 'Item removido') AS produto_nome,
      CASE WHEN p.eh_servico = 1 THEN 'Serviço' ELSE 'Produto' END AS tipo,
      vi.quantidade, vi.preco_unitario, vi.custo_unitario, vi.valor_total,
      (vi.custo_unitario * vi.quantidade) AS custo_total
    FROM vendas_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE v.status = 'concluida' AND date(v.data) BETWEEN date(?) AND date(?)
    ORDER BY v.data, v.id
  `).all(ini, f);

  const valorTotal = arred(itens.reduce((s, i) => s + Number(i.valor_total), 0));
  const custoTotal = arred(itens.reduce((s, i) => s + Number(i.custo_total), 0));
  return {
    itens: itens.map((i) => ({ ...i, custo_total: arred(i.custo_total) })),
    totais: {
      itens: itens.length,
      valor_total: valorTotal,
      custo_total: custoTotal,
      margem: arred(valorTotal - custoTotal),
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

/**
 * Ofertas recebidas no periodo — o equivalente do "vendas detalhado" para um
 * instituto sem fins lucrativos: aqui a entrada e doacao, nao faturamento.
 */
function ofertasRelatorio({ inicio, fim, projeto_id } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';
  const itens = db.prepare(`
    SELECT o.id, o.data, o.valor, o.forma, o.recibo_emitido,
      COALESCE(c.nome, o.doador_nome) AS doador,
      p.nome AS projeto, cf.nome AS conta
    FROM ofertas o
    LEFT JOIN clientes c ON c.id = o.cliente_id
    LEFT JOIN projetos p ON p.id = o.projeto_id
    LEFT JOIN contas_financeiras cf ON cf.id = o.conta_financeira_id
    WHERE date(o.data) BETWEEN date(@ini) AND date(@fim)
      AND (@projeto_id IS NULL OR o.projeto_id = @projeto_id)
    ORDER BY date(o.data) DESC, o.id DESC
  `).all({ ini, fim: f, projeto_id: projeto_id ? Number(projeto_id) : null });

  const porForma = {};
  itens.forEach((i) => {
    const k = i.forma || 'outro';
    porForma[k] = arred((porForma[k] || 0) + Number(i.valor));
  });

  return {
    itens,
    por_forma: Object.entries(porForma).map(([forma, total]) => ({ forma, total })).sort((a, b) => b.total - a.total),
    totais: {
      quantidade: itens.length,
      total: arred(itens.reduce((s, i) => s + Number(i.valor), 0)),
      sem_recibo: itens.filter((i) => !i.recibo_emitido).length,
      fora_do_caixa: itens.filter((i) => !i.conta).length,
    },
  };
}

/**
 * Turmas ativas com a lista de matriculados — o "diario de secretaria" do
 * instituto: quem esta em que turma, com quem e em qual horario.
 */
function turmasRelatorio() {
  const db = getDb();
  const turmas = db.prepare(`
    SELECT t.id, t.nome, t.vagas, t.sala, t.periodo_inicio, t.periodo_fim,
      c.nome AS curso, c.categoria,
      (SELECT GROUP_CONCAT(p.nome, ', ') FROM turmas_instrutores ti
        JOIN profissionais p ON p.id = ti.profissional_id WHERE ti.turma_id = t.id) AS instrutores,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'ativa') AS matriculados,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'espera') AS na_fila
    FROM turmas t LEFT JOIN cursos c ON c.id = t.curso_id
    WHERE t.status IN ('aberta','planejada')
    ORDER BY c.nome, t.nome
  `).all();

  const horarios = db.prepare('SELECT * FROM turmas_horarios ORDER BY dia_semana, hora_inicio').all();
  const alunos = db.prepare(`
    SELECT m.turma_id, m.aluno_id, m.instrumento_id, cl.nome, cl.telefone, cl.responsavel_nome, cl.responsavel_telefone
    FROM matriculas m JOIN clientes cl ON cl.id = m.aluno_id
    WHERE m.status = 'ativa' ORDER BY cl.nome COLLATE NOCASE
  `).all();

  const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const itens = turmas.map((t) => {
    const alunosDaTurma = alunos.filter((a) => a.turma_id === t.id);
    const v = turmasService.contarVagas(alunosDaTurma, t.vagas);
    return {
      ...t,
      horarios: horarios.filter((h) => h.turma_id === t.id)
        .map((h) => `${DIAS[h.dia_semana] || h.dia_semana} ${h.hora_inicio}–${h.hora_fim}`).join(' · '),
      alunos: alunosDaTurma,
      vagas_ocupadas: v.ocupadas,
      vagas_total: v.total,
    };
  });

  return {
    itens,
    totais: {
      turmas: itens.length,
      matriculados: itens.reduce((s, t) => s + Number(t.matriculados), 0),
      vagas: itens.reduce((s, t) => s + Number(t.vagas_total || 0), 0),
      sem_instrutor: itens.filter((t) => !t.instrutores).length,
    },
  };
}

/**
 * Produtos ativos, com estoque, que nao vendem ha X dias (ou nunca venderam).
 * Ajuda a identificar estoque encalhado.
 */
function produtosParados({ dias } = {}) {
  const db = getDb();
  const limite = Math.max(0, dias !== undefined && dias !== null && dias !== '' ? Number(dias) : 30);
  const itens = db.prepare(`
    SELECT p.id, p.nome, c.nome AS categoria, p.estoque_atual, p.custo, p.preco_venda,
      (p.estoque_atual * p.custo) AS valor_parado,
      (SELECT MAX(v.data) FROM vendas_itens vi JOIN vendas v ON v.id = vi.venda_id
        WHERE vi.produto_id = p.id AND v.status = 'concluida') AS ultima_venda
    FROM produtos p LEFT JOIN categorias c ON c.id = p.categoria_id
    WHERE p.ativo = 1 AND p.eh_kit = 0 AND p.eh_servico = 0 AND p.estoque_atual > 0
  `).all();

  const agora = Date.now();
  const diasDesde = (dataISO) => Math.floor((agora - new Date(dataISO).getTime()) / 86400000);

  const parados = itens
    .map((i) => ({ ...i, dias_sem_venda: i.ultima_venda ? diasDesde(i.ultima_venda) : null }))
    .filter((i) => i.dias_sem_venda === null || i.dias_sem_venda >= limite)
    .map((i) => ({ ...i, valor_parado: arred(i.valor_parado) }))
    .sort((a, b) => (b.dias_sem_venda ?? Infinity) - (a.dias_sem_venda ?? Infinity));

  return {
    itens: parados,
    totais: { itens: parados.length, valor_parado: arred(parados.reduce((s, i) => s + Number(i.valor_parado), 0)) },
  };
}

/**
 * Funil do CRM (agencia de viagem): quantidade de leads por etapa e as
 * vendas fechadas no periodo, com a comissao da agencia (receita de
 * verdade — o valor_venda e so informativo) e a comissao repassada ao
 * funcionario que fechou.
 */
function funilCRM({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';

  const porEtapaLinhas = db.prepare(`
    SELECT status, COUNT(*) AS qtd FROM leads
    WHERE date(criado_em) BETWEEN date(?) AND date(?)
    GROUP BY status
  `).all(ini, f);
  const porStatus = { contato: 0, proposta: 0, pagamento: 0, vendido: 0, perdido: 0 };
  porEtapaLinhas.forEach((l) => { porStatus[l.status] = l.qtd; });
  const totalLeads = Object.values(porStatus).reduce((s, n) => s + n, 0);

  const vendas = db.prepare(`
    SELECT v.*, l.nome AS lead_nome, p.nome AS agente_nome
    FROM vendas_viagem v
    JOIN leads l ON l.id = v.lead_id
    LEFT JOIN profissionais p ON p.id = v.agente_id
    WHERE date(v.criado_em) BETWEEN date(?) AND date(?)
    ORDER BY v.criado_em DESC
  `).all(ini, f);

  const totalComissaoAgencia = vendas.reduce((s, v) => s + Number(v.comissao_valor), 0);
  const totalComissaoFuncionario = vendas.reduce((s, v) => s + Number(v.comissao_funcionario_valor || 0), 0);

  return {
    porStatus, totalLeads, vendas,
    totais: {
      vendas: vendas.length,
      taxa_conversao: totalLeads ? arred((porStatus.vendido / totalLeads) * 100) : 0,
      valor_venda_bruto: arred(vendas.reduce((s, v) => s + Number(v.valor_venda), 0)),
      comissao_agencia: arred(totalComissaoAgencia),
      comissao_funcionario: arred(totalComissaoFuncionario),
      lucro_liquido: arred(totalComissaoAgencia - totalComissaoFuncionario),
    },
  };
}

/** Viagens com data de ida no periodo — usa a mesma comissao da agencia/funcionario do CRM. */
function viagensRelatorio({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';
  const itens = db.prepare(`
    SELECT v.*, l.nome AS cliente_nome, l.telefone, p.nome AS agente_nome
    FROM vendas_viagem v
    JOIN leads l ON l.id = v.lead_id
    LEFT JOIN profissionais p ON p.id = v.agente_id
    WHERE v.data_ida IS NOT NULL AND date(v.data_ida) BETWEEN date(?) AND date(?)
    ORDER BY date(v.data_ida)
  `).all(ini, f);

  return {
    itens,
    totais: {
      viagens: itens.length,
      checkins_feitos: itens.filter((i) => i.checkin_feito).length,
      valor_venda_bruto: arred(itens.reduce((s, i) => s + Number(i.valor_venda), 0)),
      comissao_agencia: arred(itens.reduce((s, i) => s + Number(i.comissao_valor), 0)),
      comissao_funcionario: arred(itens.reduce((s, i) => s + Number(i.comissao_funcionario_valor || 0), 0)),
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

/**
 * Gera uma planilha .xlsx (varias abas) com vendas, compras e financeiro do
 * periodo, pronta para mandar para o contador fechar o mes.
 */
function exportarContador({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';

  const vendas = db.prepare(`
    SELECT v.id AS "Venda", date(v.data) AS "Data", v.valor_bruto AS "Bruto",
      v.desconto AS "Desconto", v.valor_total AS "Total", v.status AS "Status",
      (SELECT GROUP_CONCAT(forma_pagamento, ', ') FROM vendas_pagamentos vp WHERE vp.venda_id=v.id) AS "Formas de pagamento"
    FROM vendas v WHERE date(v.data) BETWEEN date(?) AND date(?) ORDER BY v.id
  `).all(ini, f);

  const compras = db.prepare(`
    SELECT c.id AS "Compra", c.numero_nf AS "Nº NF", f.nome AS "Fornecedor",
      date(c.data_emissao) AS "Emissão", c.valor_total AS "Valor total", c.status AS "Status"
    FROM compras c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
    WHERE date(c.data_emissao) BETWEEN date(?) AND date(?) ORDER BY c.id
  `).all(ini, f);

  const contasPagas = db.prepare(`
    SELECT cp.descricao AS "Descrição", f.nome AS "Fornecedor", cp.data_pagamento AS "Pago em", cp.valor AS "Valor"
    FROM contas_pagar cp LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id
    WHERE cp.status = 'pago' AND date(cp.data_pagamento) BETWEEN date(?) AND date(?) ORDER BY date(cp.data_pagamento)
  `).all(ini, f);

  const contasRecebidas = db.prepare(`
    SELECT cr.descricao AS "Descrição", c.nome AS "Cliente", cr.data_recebimento AS "Recebido em", cr.valor AS "Valor"
    FROM contas_receber cr LEFT JOIN clientes c ON c.id = cr.cliente_id
    WHERE cr.status = 'recebido' AND date(cr.data_recebimento) BETWEEN date(?) AND date(?) ORDER BY date(cr.data_recebimento)
  `).all(ini, f);

  const extratoConciliado = db.prepare(`
    SELECT t.data AS "Data", cf.nome AS "Conta", t.tipo AS "Tipo", t.valor AS "Valor",
      t.descricao AS "Descrição (banco)",
      COALESCE(cp.descricao, cr.descricao,
        CASE WHEN o.id IS NULL THEN NULL ELSE 'Oferta — ' || COALESCE(oc.nome, o.doador_nome, 'doador') END
      ) AS "Lançamento vinculado"
    FROM extrato_ofx_transacoes t
    JOIN contas_financeiras cf ON cf.id = t.conta_financeira_id
    LEFT JOIN contas_pagar cp ON cp.id = t.contas_pagar_id
    LEFT JOIN contas_receber cr ON cr.id = t.contas_receber_id
    LEFT JOIN ofertas o ON o.id = t.oferta_id
    LEFT JOIN clientes oc ON oc.id = o.cliente_id
    WHERE t.status = 'conciliada' AND date(t.data) BETWEEN date(?) AND date(?)
    ORDER BY date(t.data)
  `).all(ini, f);

  const wb = XLSX.utils.book_new();
  const addSheet = (nome, linhas) => {
    const ws = linhas.length ? XLSX.utils.json_to_sheet(linhas) : XLSX.utils.aoa_to_sheet([['Sem registros no período']]);
    XLSX.utils.book_append_sheet(wb, ws, nome);
  };

  // Num instituto sem fins lucrativos nao existe venda nem compra de
  // mercadoria: o que o contador precisa e a entrada de doacao, a despesa e o
  // extrato batido. Mantem-se a mesma planilha, com as abas que fazem sentido.
  const ramoCfg = db.prepare("SELECT valor FROM config WHERE chave = 'ramo_servico'").get();
  if (ramoCfg && ramoCfg.valor === 'instituto') {
    const ofertas = db.prepare(`
      SELECT date(o.data) AS "Data", COALESCE(c.nome, o.doador_nome) AS "Doador",
        o.valor AS "Valor", o.forma AS "Forma", cf.nome AS "Entrou na conta",
        p.nome AS "Projeto", CASE WHEN o.recibo_emitido THEN 'Sim' ELSE 'Não' END AS "Recibo emitido"
      FROM ofertas o
      LEFT JOIN clientes c ON c.id = o.cliente_id
      LEFT JOIN projetos p ON p.id = o.projeto_id
      LEFT JOIN contas_financeiras cf ON cf.id = o.conta_financeira_id
      WHERE date(o.data) BETWEEN date(?) AND date(?) ORDER BY date(o.data)
    `).all(ini, f);

    const despesas = db.prepare(`
      SELECT cp.descricao AS "Descrição", f.nome AS "Fornecedor", cd.nome AS "Categoria",
        pj.nome AS "Projeto", cp.data_pagamento AS "Pago em", cp.valor AS "Valor"
      FROM contas_pagar cp
      LEFT JOIN fornecedores f ON f.id = cp.fornecedor_id
      LEFT JOIN categorias_despesa cd ON cd.id = cp.categoria_despesa_id
      LEFT JOIN projetos pj ON pj.id = cp.projeto_id
      WHERE cp.status = 'pago' AND date(cp.data_pagamento) BETWEEN date(?) AND date(?)
      ORDER BY date(cp.data_pagamento)
    `).all(ini, f);

    const especie = db.prepare(`
      SELECT date(d.data) AS "Data", COALESCE(c.nome, d.doador_nome) AS "Doador",
        d.descricao AS "Bem doado", d.quantidade AS "Quantidade",
        d.valor_estimado AS "Valor estimado", p.nome AS "Projeto"
      FROM doacoes_especie d
      LEFT JOIN clientes c ON c.id = d.cliente_id
      LEFT JOIN projetos p ON p.id = d.projeto_id
      WHERE date(d.data) BETWEEN date(?) AND date(?) ORDER BY date(d.data)
    `).all(ini, f);

    const saldos = db.prepare(`
      SELECT cf.nome AS "Conta", cf.tipo AS "Tipo",
        cf.saldo_inicial + COALESCE((
          SELECT SUM(CASE WHEN m.tipo = 'entrada' THEN m.valor ELSE -m.valor END)
          FROM contas_financeiras_mov m WHERE m.conta_id = cf.id
        ), 0) AS "Saldo atual"
      FROM contas_financeiras cf WHERE cf.ativa = 1 ORDER BY cf.nome
    `).all();

    addSheet('Ofertas Recebidas', ofertas);
    addSheet('Despesas Pagas', despesas);
    addSheet('Cobrancas Recebidas', contasRecebidas);
    addSheet('Doacoes em Especie', especie);
    addSheet('Extrato Conciliado', extratoConciliado);
    addSheet('Saldos das Contas', saldos);
    return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  }

  addSheet('Vendas', vendas);
  addSheet('Compras', compras);
  addSheet('Contas Pagas', contasPagas);
  addSheet('Contas Recebidas', contasRecebidas);
  addSheet('Extrato Conciliado', extratoConciliado);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = {
  estoqueAtual, vendasDetalhado, vendasComCusto, financeiro, produtosParados, exportarContador,
  funilCRM, viagensRelatorio,
  ofertasRelatorio, turmasRelatorio,
  gerarCSV, gerarXLS,
};
