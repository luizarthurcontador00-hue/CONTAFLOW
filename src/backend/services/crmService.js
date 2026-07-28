'use strict';

/**
 * CRM da agencia de viagem: funil de leads (contato -> proposta -> pagamento
 * -> vendido) e, ao fechar a venda, geracao automatica da conta a receber
 * (financeiro) e da comissao do agente (contas a pagar), alem do registro
 * que alimenta o calendario de viagens (data_ida/data_volta).
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');

const STATUS_VALIDOS = ['contato', 'proposta', 'pagamento', 'vendido', 'perdido'];

function listarLeads({ status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('status = @status'); params.status = status; }
  return db.prepare(`
    SELECT * FROM leads
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (status = 'perdido'), atualizado_em DESC, criado_em DESC
  `).all(params);
}

function obterLead(id) {
  const db = getDb();
  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!lead) throw new AppError('Lead nao encontrado.', 404);
  lead.venda = db.prepare('SELECT * FROM vendas_viagem WHERE lead_id = ?').get(id) || null;
  return lead;
}

function criarLead(dados) {
  const db = getDb();
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome do lead.');
  const info = db.prepare(
    `INSERT INTO leads (nome, telefone, email, origem, observacao)
     VALUES (?, ?, ?, ?, ?)`
  ).run(nome, dados.telefone || null, dados.email || null, dados.origem || null, dados.observacao || null);
  return obterLead(info.lastInsertRowid);
}

function atualizarLead(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM leads WHERE id = ?').get(id);
  if (!atual) throw new AppError('Lead nao encontrado.', 404);

  const status = dados.status !== undefined ? dados.status : atual.status;
  if (!STATUS_VALIDOS.includes(status)) throw new AppError('Status invalido.');
  if (status === 'vendido' && atual.status !== 'vendido') {
    throw new AppError('Para marcar como vendido, use "Fechar venda" (preenche os dados da venda).');
  }

  const nome = dados.nome !== undefined ? (dados.nome || '').trim() : atual.nome;
  if (!nome) throw new AppError('Informe o nome do lead.');

  db.prepare(
    `UPDATE leads SET nome=?, telefone=?, email=?, origem=?, status=?, observacao=?, atualizado_em=datetime('now','localtime')
     WHERE id=?`
  ).run(
    nome,
    dados.telefone !== undefined ? dados.telefone : atual.telefone,
    dados.email !== undefined ? dados.email : atual.email,
    dados.origem !== undefined ? dados.origem : atual.origem,
    status,
    dados.observacao !== undefined ? dados.observacao : atual.observacao,
    id
  );
  return obterLead(id);
}

function excluirLead(id) {
  const db = getDb();
  const temVenda = db.prepare('SELECT 1 FROM vendas_viagem WHERE lead_id = ?').get(id);
  if (temVenda) throw new AppError('Este lead ja tem uma venda registrada e nao pode ser excluido.');
  db.prepare('DELETE FROM leads WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Fecha a venda de um lead: cria o registro de venda de viagem, gera a
 * conta a receber (parcelada opcionalmente) e a comissao do agente (conta a
 * pagar), vincula/cria o cliente, e marca o lead como 'vendido'.
 */
/**
 * Fecha a venda de uma viagem. Importante: quem vende o pacote de verdade e a
 * operadora — o valor_venda e so informativo (nao entra como receita da
 * agencia). A receita de verdade da agencia e a comissao que a operadora
 * repassa por ter vendido (comissao_pct/comissao_valor), e isso e o que vira
 * conta a receber. Se um funcionario (agente_id) fechou a venda, uma fatia
 * dessa comissao (comissao_funcionario_pct/valor) vira conta a pagar pra ele.
 */
function fecharVenda(leadId, dados) {
  const db = getDb();
  // eslint-disable-next-line global-require
  const financeiroService = require('./financeiroService');
  // eslint-disable-next-line global-require
  const clientesService = require('./clientesService');

  const lead = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  if (!lead) throw new AppError('Lead nao encontrado.', 404);
  if (lead.status === 'vendido') throw new AppError('Este lead ja tem uma venda fechada.');

  const descricao = (dados.descricao || '').trim();
  if (!descricao) throw new AppError('Informe a descricao da venda (ex.: pacote/destino).');
  const valorVenda = Number(dados.valor_venda);
  if (!(valorVenda > 0)) throw new AppError('Informe o valor da venda.');
  if (dados.data_ida && dados.data_volta && dados.data_volta < dados.data_ida) {
    throw new AppError('A data de volta nao pode ser anterior a data de ida.');
  }

  const comissaoPct = dados.comissao_pct != null && dados.comissao_pct !== '' ? Number(dados.comissao_pct) : null;
  const comissaoValor = comissaoPct != null ? arred(valorVenda * comissaoPct / 100) : arred(Number(dados.comissao_valor || 0));
  if (!(comissaoValor > 0)) throw new AppError('Informe a comissão da agência (é o que a operadora repassa pela venda).');

  const comissaoFuncPct = dados.comissao_funcionario_pct != null && dados.comissao_funcionario_pct !== '' ? Number(dados.comissao_funcionario_pct) : null;
  const comissaoFuncValor = comissaoFuncPct != null ? arred(comissaoValor * comissaoFuncPct / 100) : arred(Number(dados.comissao_funcionario_valor || 0));

  const tx = db.transaction(() => {
    let clienteId = lead.cliente_id;
    if (!clienteId) {
      const cliente = clientesService.criar({ nome: lead.nome, telefone: lead.telefone, email: lead.email });
      clienteId = cliente.id;
    }

    const parcelas = Math.max(1, Number(dados.parcelas || 1));
    const receber = financeiroService.criarReceber({
      descricao: `Comissão — ${descricao}${dados.operadora ? ` (${dados.operadora})` : ''}`,
      valor: comissaoValor, parcelas,
      primeiro_vencimento: dados.primeiro_vencimento || null,
    });
    const contaReceberId = receber && receber.ids && receber.ids.length ? receber.ids[0] : null;

    let contaPagarFuncionarioId = null;
    if (dados.agente_id && comissaoFuncValor > 0) {
      const categoria = db.prepare("SELECT id FROM categorias_despesa WHERE nome = 'Salários e encargos'").get();
      const pagar = financeiroService.criarPagar({
        descricao: `Comissão de venda — ${descricao} (${lead.nome})`,
        valor: comissaoFuncValor,
        primeiro_vencimento: dados.data_ida || null,
        categoria_despesa_id: categoria ? categoria.id : null,
      });
      contaPagarFuncionarioId = pagar && pagar.id ? pagar.id : null;
    }

    const info = db.prepare(`
      INSERT INTO vendas_viagem
        (lead_id, cliente_id, descricao, operadora, numero_reserva, valor_venda,
         agente_id, comissao_pct, comissao_valor, comissao_funcionario_pct, comissao_funcionario_valor,
         data_ida, data_volta, observacao, conta_receber_id, conta_pagar_funcionario_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      leadId, clienteId, descricao, dados.operadora || null, dados.numero_reserva || null, valorVenda,
      dados.agente_id ? Number(dados.agente_id) : null, comissaoPct, comissaoValor,
      comissaoFuncPct, comissaoFuncValor,
      dados.data_ida || null, dados.data_volta || null, dados.observacao || null,
      contaReceberId, contaPagarFuncionarioId
    );

    db.prepare("UPDATE leads SET status='vendido', cliente_id=?, atualizado_em=datetime('now','localtime') WHERE id=?")
      .run(clienteId, leadId);

    return info.lastInsertRowid;
  });

  const vendaId = tx();
  return obterLead(leadId).venda || db.prepare('SELECT * FROM vendas_viagem WHERE id = ?').get(vendaId);
}

/** Viagens (vendas fechadas) cujo periodo ida-volta cruza com [inicio, fim]. */
function listarViagens({ inicio, fim } = {}) {
  const db = getDb();
  const ini = inicio || '0000-01-01';
  const f = fim || '9999-12-31';
  return db.prepare(`
    SELECT vv.*, l.nome AS cliente_nome, p.nome AS agente_nome, p.cor AS agente_cor
    FROM vendas_viagem vv
    JOIN leads l ON l.id = vv.lead_id
    LEFT JOIN profissionais p ON p.id = vv.agente_id
    WHERE vv.data_ida IS NOT NULL AND vv.data_volta IS NOT NULL
      AND date(vv.data_ida) <= date(?) AND date(vv.data_volta) >= date(?)
    ORDER BY date(vv.data_ida)
  `).all(f, ini);
}

/** Viagens vendidas com check-in ainda pendente (para a coluna do Kanban). */
function listarCheckinsPendentes() {
  const db = getDb();
  return db.prepare(`
    SELECT vv.*, l.nome AS cliente_nome, l.telefone AS cliente_telefone
    FROM vendas_viagem vv JOIN leads l ON l.id = vv.lead_id
    WHERE vv.checkin_feito = 0
    ORDER BY (vv.data_ida IS NULL), date(vv.data_ida)
  `).all();
}

function marcarCheckinFeito(vendaViagemId) {
  const db = getDb();
  const venda = db.prepare('SELECT * FROM vendas_viagem WHERE id = ?').get(vendaViagemId);
  if (!venda) throw new AppError('Venda de viagem nao encontrada.', 404);
  db.prepare("UPDATE vendas_viagem SET checkin_feito = 1, checkin_feito_em = datetime('now','localtime') WHERE id = ?")
    .run(vendaViagemId);
  return db.prepare('SELECT * FROM vendas_viagem WHERE id = ?').get(vendaViagemId);
}

module.exports = {
  listarLeads, obterLead, criarLead, atualizarLead, excluirLead, fecharVenda, listarViagens,
  listarCheckinsPendentes, marcarCheckinFeito,
};
