'use strict';

const { getDb } = require('../db/connection');
const { arred } = require('./precificacaoService');

const PERIODO_PADRAO = () => {
  const hoje = new Date();
  const fim = hoje.toISOString().slice(0, 10);
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, hoje.getDate()).toISOString().slice(0, 10);
  return { inicio, fim };
};

function intervalo({ inicio, fim } = {}) {
  return { ini: inicio || '0000-01-01', f: fim || '9999-12-31' };
}

/** Vendas agrupadas por dia ou mes. */
function vendasPorPeriodo({ inicio, fim, agrupamento } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const fmt = agrupamento === 'mes' ? '%Y-%m' : '%Y-%m-%d';
  return db.prepare(`
    SELECT strftime('${fmt}', data) AS periodo,
           COALESCE(SUM(valor_total),0) AS total, COUNT(*) AS qtd
    FROM vendas
    WHERE status='concluida' AND date(data) BETWEEN date(?) AND date(?)
    GROUP BY periodo ORDER BY periodo
  `).all(ini, f);
}

/** Ranking de produtos mais vendidos. */
function maisVendidos({ inicio, fim, limite = 10, por = 'quantidade' } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const ordem = por === 'faturamento' ? 'total' : 'quantidade';
  return db.prepare(`
    SELECT vi.produto_id AS id,
           COALESCE(p.nome, vi.descricao) AS nome,
           COALESCE(SUM(vi.quantidade),0) AS quantidade,
           COALESCE(SUM(vi.valor_total),0) AS total
    FROM vendas_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE v.status='concluida' AND date(v.data) BETWEEN date(?) AND date(?)
    GROUP BY vi.produto_id
    ORDER BY ${ordem} DESC
    LIMIT ?
  `).all(ini, f, Number(limite));
}

/** Margem de lucro por categoria no periodo. */
function margemPorCategoria({ inicio, fim } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const linhas = db.prepare(`
    SELECT COALESCE(c.nome, 'Sem categoria') AS categoria,
           COALESCE(SUM(vi.valor_total),0) AS receita,
           COALESCE(SUM(vi.custo_unitario * vi.quantidade),0) AS custo
    FROM vendas_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    LEFT JOIN categorias c ON c.id = p.categoria_id
    WHERE v.status='concluida' AND date(v.data) BETWEEN date(?) AND date(?)
    GROUP BY c.id ORDER BY receita DESC
  `).all(ini, f);
  return linhas.map((l) => ({
    categoria: l.categoria,
    receita: arred(l.receita),
    custo: arred(l.custo),
    lucro: arred(l.receita - l.custo),
    margem: l.receita > 0 ? arred(((l.receita - l.custo) / l.receita) * 100) : 0,
  }));
}

/** Margem/lucro consolidado do periodo. */
function margemPeriodo({ inicio, fim } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const r = db.prepare(`
    SELECT COALESCE(SUM(vi.valor_total),0) AS receita,
           COALESCE(SUM(vi.custo_unitario * vi.quantidade),0) AS custo
    FROM vendas_itens vi JOIN vendas v ON v.id = vi.venda_id
    WHERE v.status='concluida' AND date(v.data) BETWEEN date(?) AND date(?)
  `).get(ini, f);
  return {
    receita: arred(r.receita), custo: arred(r.custo), lucro: arred(r.receita - r.custo),
    margem: r.receita > 0 ? arred(((r.receita - r.custo) / r.receita) * 100) : 0,
  };
}

/** Curva ABC de produtos por faturamento. */
function curvaABC({ inicio, fim } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const produtos = db.prepare(`
    SELECT vi.produto_id AS id, COALESCE(p.nome, vi.descricao) AS nome,
           COALESCE(SUM(vi.valor_total),0) AS faturamento,
           COALESCE(SUM(vi.quantidade),0) AS quantidade
    FROM vendas_itens vi
    JOIN vendas v ON v.id = vi.venda_id
    LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE v.status='concluida' AND date(v.data) BETWEEN date(?) AND date(?)
    GROUP BY vi.produto_id
    HAVING faturamento > 0
    ORDER BY faturamento DESC
  `).all(ini, f);

  const totalGeral = produtos.reduce((s, p) => s + Number(p.faturamento), 0);
  let acumulado = 0;
  return {
    total: arred(totalGeral),
    itens: produtos.map((p) => {
      acumulado += Number(p.faturamento);
      const percAcum = totalGeral > 0 ? (acumulado / totalGeral) * 100 : 0;
      const classe = percAcum <= 80 ? 'A' : percAcum <= 95 ? 'B' : 'C';
      return {
        id: p.id, nome: p.nome, faturamento: arred(p.faturamento), quantidade: arred(p.quantidade),
        perc: totalGeral > 0 ? arred((p.faturamento / totalGeral) * 100) : 0,
        perc_acumulado: arred(percAcum), classe,
      };
    }),
  };
}

/** Comparativo contas a pagar x a receber no periodo (por vencimento). */
function pagarVsReceber({ inicio, fim } = {}) {
  const db = getDb();
  const { ini, f } = intervalo({ inicio, fim });
  const pagar = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE date(vencimento) BETWEEN date(?) AND date(?)").get(ini, f).t;
  const receber = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_receber WHERE status!='cancelada' AND tipo <> 'venda_vista' AND date(vencimento) BETWEEN date(?) AND date(?)").get(ini, f).t;
  const pagarPend = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE status='pendente' AND date(vencimento) BETWEEN date(?) AND date(?)").get(ini, f).t;
  const receberPend = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_receber WHERE status='pendente' AND date(vencimento) BETWEEN date(?) AND date(?)").get(ini, f).t;
  return {
    pagar: arred(pagar), receber: arred(receber),
    pagar_pendente: arred(pagarPend), receber_pendente: arred(receberPend),
    saldo_previsto: arred(receber - pagar),
  };
}

/** Cartoes-resumo para a tela de dashboard. */
function resumoGeral() {
  const db = getDb();
  const hoje = new Date().toISOString().slice(0, 10);
  const mesIni = hoje.slice(0, 8) + '01';
  const vendasHoje = db.prepare("SELECT COALESCE(SUM(valor_total),0) t, COUNT(*) c FROM vendas WHERE status='concluida' AND date(data)=date(?)").get(hoje);
  const vendasMes = db.prepare("SELECT COALESCE(SUM(valor_total),0) t, COUNT(*) c FROM vendas WHERE status='concluida' AND date(data)>=date(?)").get(mesIni);
  const estoqueBaixo = db.prepare('SELECT COUNT(*) c FROM produtos WHERE ativo=1 AND eh_servico=0 AND eh_kit=0 AND estoque_atual <= estoque_minimo').get().c;
  const aReceber = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_receber WHERE status='pendente'").get().t;
  const aPagar = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE status='pendente'").get().t;
  const margemMes = margemPeriodo({ inicio: mesIni, fim: hoje });
  return {
    vendas_hoje: { total: arred(vendasHoje.t), qtd: vendasHoje.c },
    vendas_mes: { total: arred(vendasMes.t), qtd: vendasMes.c },
    lucro_mes: margemMes.lucro,
    margem_mes: margemMes.margem,
    estoque_baixo: estoqueBaixo,
    a_receber: arred(aReceber),
    a_pagar: arred(aPagar),
  };
}

/** Painel de indicadores voltado para o ramo "professor" (aula particular). */
function painelProfessor() {
  const db = getDb();
  const hoje = new Date().toISOString().slice(0, 10);
  const mesIni = hoje.slice(0, 8) + '01';

  const carga = db.prepare(`
    SELECT COUNT(*) AS qtd, COALESCE(SUM(
      (CAST(substr(hora_fim,1,2) AS INTEGER) * 60 + CAST(substr(hora_fim,4,2) AS INTEGER)) -
      (CAST(substr(hora_inicio,1,2) AS INTEGER) * 60 + CAST(substr(hora_inicio,4,2) AS INTEGER))
    ),0) AS minutos
    FROM agendamentos
    WHERE date(data) >= date(?) AND status != 'cancelado' AND hora_fim IS NOT NULL
  `).get(mesIni);

  const alunosAtivos = db.prepare('SELECT COUNT(*) c FROM clientes WHERE ativo = 1').get().c;
  const faturamentoMes = db.prepare("SELECT COALESCE(SUM(valor_total),0) t FROM vendas WHERE status='concluida' AND date(data)>=date(?)").get(mesIni).t;
  const margemMes = margemPeriodo({ inicio: mesIni, fim: hoje });
  const aReceber = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_receber WHERE status='pendente'").get().t;
  const aPagar = db.prepare("SELECT COALESCE(SUM(valor),0) t FROM contas_pagar WHERE status='pendente'").get().t;

  return {
    aulas_mes: carga.qtd,
    horas_aula_mes: arred(carga.minutos / 60),
    alunos_ativos: alunosAtivos,
    faturamento_mes: arred(faturamentoMes),
    lucro_mes: margemMes.lucro,
    margem_mes: margemMes.margem,
    a_receber: arred(aReceber),
    a_pagar: arred(aPagar),
  };
}

/**
 * Central de Gestão: lista de pontos que precisam de atenção agora, cada um
 * com um nivel de urgencia (vermelho/laranja/amarelo/azul/verde) e uma rota
 * para onde o clique deve levar. O frontend monta o texto/emoji a partir do
 * "tipo" — aqui so vao os dados brutos (numeros), sem formatacao.
 */
function centralAtencao() {
  const db = getDb();
  const hoje = new Date().toISOString().slice(0, 10);
  const itens = [];

  // 1) Contas vencendo hoje (pagar + receber).
  const hojePagar = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM contas_pagar WHERE status='pendente' AND date(vencimento)=date(?)").get(hoje);
  const hojeReceber = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM contas_receber WHERE status='pendente' AND date(vencimento)=date(?)").get(hoje);
  if (hojePagar.c + hojeReceber.c > 0) {
    itens.push({
      tipo: 'contas_hoje', nivel: 'vermelho', rota: 'financeiro', peso: 1,
      dados: {
        qtd: hojePagar.c + hojeReceber.c,
        qtd_pagar: hojePagar.c, valor_pagar: arred(hojePagar.v),
        qtd_receber: hojeReceber.c, valor_receber: arred(hojeReceber.v),
      },
    });
  }

  // 2) Contas atrasadas (pagar + receber).
  const atrasoPagar = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM contas_pagar WHERE status='pendente' AND date(vencimento)<date(?)").get(hoje);
  const atrasoReceber = db.prepare("SELECT COUNT(*) c, COALESCE(SUM(valor),0) v FROM contas_receber WHERE status='pendente' AND date(vencimento)<date(?)").get(hoje);
  if (atrasoPagar.c + atrasoReceber.c > 0) {
    itens.push({
      tipo: 'contas_atrasadas', nivel: 'vermelho', rota: 'financeiro', peso: 1,
      dados: {
        qtd: atrasoPagar.c + atrasoReceber.c,
        qtd_pagar: atrasoPagar.c, valor_pagar: arred(atrasoPagar.v),
        qtd_receber: atrasoReceber.c, valor_receber: arred(atrasoReceber.v),
      },
    });
  }

  // 3) Produtos abaixo do estoque minimo (so faz sentido para quem vende produtos;
  // nunca para o ramo "professor", que nao tem produto nenhum por definicao).
  const ramoCfg = db.prepare("SELECT valor FROM config WHERE chave = 'ramo_servico'").get();
  const ramoServico = ramoCfg && ramoCfg.valor;
  if (ramoServico !== 'professor') {
    const estoqueBaixo = db.prepare('SELECT COUNT(*) c FROM produtos WHERE ativo=1 AND eh_servico=0 AND eh_kit=0 AND estoque_atual <= estoque_minimo').get().c;
    if (estoqueBaixo > 0) {
      itens.push({ tipo: 'estoque_baixo', nivel: 'laranja', rota: 'produtos', peso: 2, dados: { qtd: estoqueBaixo } });
    }
  }

  // 4) Faturamento do mes (ate hoje) vs o mesmo intervalo de dias no mes anterior.
  const mesIni = hoje.slice(0, 8) + '01';
  const [ano, mes, dia] = hoje.split('-').map(Number);
  const mesAntIni = new Date(ano, mes - 2, 1).toISOString().slice(0, 10);
  const mesAntFim = new Date(ano, mes - 2, dia).toISOString().slice(0, 10);
  const fatAtual = db.prepare("SELECT COALESCE(SUM(valor_total),0) t FROM vendas WHERE status='concluida' AND date(data)>=date(?)").get(mesIni).t;
  const fatAnterior = db.prepare("SELECT COALESCE(SUM(valor_total),0) t FROM vendas WHERE status='concluida' AND date(data) BETWEEN date(?) AND date(?)").get(mesAntIni, mesAntFim).t;
  if (Number(fatAnterior) > 0) {
    const variacaoPct = arred(((Number(fatAtual) - Number(fatAnterior)) / Number(fatAnterior)) * 100);
    itens.push({
      tipo: 'faturamento_mes', nivel: variacaoPct >= 0 ? 'verde' : 'vermelho', rota: 'dashboard', peso: variacaoPct >= 0 ? 5 : 1,
      dados: { atual: arred(fatAtual), anterior: arred(fatAnterior), variacao_pct: variacaoPct },
    });
  }

  // 5) Clientes que ja compraram antes mas estao ha mais de 90 dias sem comprar.
  const diasInatividade = 90;
  const limiteInativo = new Date(Date.now() - diasInatividade * 864e5).toISOString().slice(0, 10);
  const clientesInativos = db.prepare(`
    SELECT COUNT(*) c FROM (
      SELECT cl.id, MAX(v.data) AS ultima
      FROM clientes cl JOIN vendas v ON v.cliente_id = cl.id AND v.status = 'concluida'
      WHERE cl.ativo = 1
      GROUP BY cl.id
      HAVING date(ultima) < date(?)
    )
  `).get(limiteInativo).c;
  if (clientesInativos > 0) {
    itens.push({ tipo: 'clientes_inativos', nivel: 'azul', rota: 'clientes', peso: 4, dados: { qtd: clientesInativos, dias: diasInatividade } });
  }

  // 6) Meta mensal de faturamento (configuravel em Configuracoes).
  const metaCfg = db.prepare("SELECT valor FROM config WHERE chave = 'meta_mensal_faturamento'").get();
  const meta = metaCfg && metaCfg.valor ? Number(metaCfg.valor) : 0;
  if (meta > 0) {
    const pct = arred((Number(fatAtual) / meta) * 100);
    itens.push({
      tipo: 'meta_mensal', nivel: 'amarelo', rota: 'dashboard', peso: 3,
      dados: { meta: arred(meta), atual: arred(fatAtual), pct, falta: arred(Math.max(0, meta - Number(fatAtual))) },
    });
  } else {
    itens.push({ tipo: 'meta_nao_definida', nivel: 'info', rota: 'configuracoes', peso: 6, dados: {} });
  }

  // 7) Lembretes vencidos.
  // eslint-disable-next-line global-require
  const lembretesVencidos = require('./lembretesService').pendentesVencidos();
  if (lembretesVencidos.length > 0) {
    itens.push({ tipo: 'lembretes_vencidos', nivel: 'vermelho', rota: 'lembretes', peso: 1, dados: { qtd: lembretesVencidos.length } });
  }

  itens.sort((a, b) => a.peso - b.peso);
  return { itens };
}

module.exports = {
  PERIODO_PADRAO,
  vendasPorPeriodo,
  maisVendidos,
  margemPorCategoria,
  margemPeriodo,
  curvaABC,
  pagarVsReceber,
  resumoGeral,
  centralAtencao,
  painelProfessor,
};
