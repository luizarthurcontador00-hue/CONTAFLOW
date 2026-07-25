'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');

function primeiroDiaMes() { return new Date().toISOString().slice(0, 8) + '01'; }
function ultimoDiaMes() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
}

/**
 * Relatorio de comissoes por profissional num periodo: soma o que cada um
 * produziu (atendimentos da Agenda + Ordens de Servico ja faturados) e
 * calcula a comissao pelo percentual cadastrado. Traz tambem o detalhamento
 * item a item, para auditoria, e se a comissao do periodo ja foi lancada.
 */
function relatorioPeriodo({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || primeiroDiaMes();
  const f = fim || ultimoDiaMes();

  const profissionais = db.prepare('SELECT * FROM profissionais WHERE ativo = 1 ORDER BY nome COLLATE NOCASE').all();

  return profissionais.map((p) => {
    const agenda = db.prepare(`
      SELECT a.id, a.data, a.servico_nome, a.valor,
             COALESCE(c.nome, a.cliente_nome) AS cliente_nome
      FROM agendamentos a LEFT JOIN clientes c ON c.id = a.cliente_id
      WHERE a.profissional_id = ? AND a.venda_id IS NOT NULL
        AND date(a.data) BETWEEN date(?) AND date(?)
      ORDER BY a.data
    `).all(p.id, ini, f);

    const ordens = db.prepare(`
      SELECT o.id, o.numero, o.equipamento, o.valor_total AS valor, o.data_entrega,
             c.nome AS cliente_nome
      FROM ordens_servico o LEFT JOIN clientes c ON c.id = o.cliente_id
      WHERE o.profissional_id = ? AND o.venda_id IS NOT NULL AND o.tipo = 'os'
        AND date(o.data_entrega) BETWEEN date(?) AND date(?)
      ORDER BY o.data_entrega
    `).all(p.id, ini, f);

    const totalAgenda = arred(agenda.reduce((s, a) => s + Number(a.valor), 0));
    const totalOrdens = arred(ordens.reduce((s, o) => s + Number(o.valor), 0));
    const totalProduzido = arred(totalAgenda + totalOrdens);
    const comissao = arred(totalProduzido * Number(p.comissao_pct || 0) / 100);

    const lancamento = db.prepare(`
      SELECT * FROM comissoes_lancamentos
      WHERE profissional_id = ? AND periodo_inicio = ? AND periodo_fim = ?
      ORDER BY id DESC LIMIT 1
    `).get(p.id, ini, f);

    const detalhes = [
      ...agenda.map((a) => ({ tipo: 'agenda', id: a.id, data: a.data, descricao: a.servico_nome || 'Atendimento', cliente: a.cliente_nome, valor: Number(a.valor) })),
      ...ordens.map((o) => ({ tipo: 'os', id: o.id, data: o.data_entrega, descricao: `OS #${o.numero}${o.equipamento ? ' — ' + o.equipamento : ''}`, cliente: o.cliente_nome, valor: Number(o.valor) })),
    ].sort((x, y) => String(x.data).localeCompare(String(y.data)));

    return {
      profissional_id: p.id,
      nome: p.nome,
      cor: p.cor,
      comissao_pct: Number(p.comissao_pct || 0),
      total_atendimentos: detalhes.length,
      total_agenda: totalAgenda,
      total_ordens: totalOrdens,
      total_produzido: totalProduzido,
      comissao,
      ja_lancado: !!lancamento,
      lancamento: lancamento || null,
      detalhes,
    };
  });
}

/**
 * Lanca a comissao de um profissional (do periodo) como conta a pagar,
 * evitando duplicidade (uma unica vez por profissional+periodo).
 */
function lancarComissao(profissionalId, { inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || primeiroDiaMes();
  const f = fim || ultimoDiaMes();
  const relatorio = relatorioPeriodo({ inicio: ini, fim: f });
  const item = relatorio.find((r) => r.profissional_id === Number(profissionalId));
  if (!item) throw new AppError('Profissional não encontrado ou inativo.', 404);
  if (item.ja_lancado) throw new AppError('A comissão deste período já foi lançada.');
  if (!(item.comissao > 0)) throw new AppError('Não há comissão a lançar neste período.');

  // eslint-disable-next-line global-require
  const financeiroService = require('./financeiroService');
  const categoria = db.prepare("SELECT id FROM categorias_despesa WHERE nome = 'Salários e encargos'").get();

  const tx = db.transaction(() => {
    const contaPagar = financeiroService.criarPagar({
      descricao: `Comissão — ${item.nome} (${ini} a ${f})`,
      valor: item.comissao,
      primeiro_vencimento: f,
      categoria_despesa_id: categoria ? categoria.id : null,
    });
    db.prepare(`
      INSERT INTO comissoes_lancamentos (profissional_id, periodo_inicio, periodo_fim, valor, conta_pagar_id)
      VALUES (?, ?, ?, ?, ?)
    `).run(Number(profissionalId), ini, f, item.comissao, contaPagar.id);
    return contaPagar;
  });
  const contaPagar = tx();

  return { ok: true, conta_pagar: contaPagar, relatorio: relatorioPeriodo({ inicio: ini, fim: f }) };
}

module.exports = { relatorioPeriodo, lancarComissao };
