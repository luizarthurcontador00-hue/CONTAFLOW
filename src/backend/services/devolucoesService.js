'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { registrarMovimentacao } = require('./estoqueService');
const { arred } = require('./precificacaoService');

/**
 * Registra a devolucao (parcial ou total) de itens de uma venda concluida,
 * com troca opcional por outro(s) produto(s).
 *
 * dados = {
 *   venda_id, motivo?, observacao?,
 *   itens: [{ venda_item_id, quantidade }],           // o que o cliente devolve
 *   itens_troca?: [{ produto_id, quantidade, preco_unitario? }], // o que leva no lugar
 *   forma_pagamento_diferenca?: 'dinheiro'|'pix'|'cartao_credito'|'cartao_debito',
 * }
 *
 * Regras:
 *  - Estorna o estoque dos itens devolvidos (produtos simples; kits/servicos
 *    nao geram movimentacao, pois tambem nao geram na venda original).
 *  - Da baixa no estoque dos itens de troca levados pelo cliente.
 *  - A diferenca (valor devolvido - valor da troca) e resolvida assim:
 *      1) primeiro abate de contas a receber "a prazo" pendentes desta venda
 *         (o cliente ainda nao pagou, entao nao ha dinheiro a devolver);
 *      2) o que sobrar vira reembolso (saida de caixa) ou cobranca (entrada
 *         de caixa) na conta financeira mapeada para a forma informada.
 */
function criarDevolucao(dados) {
  const db = getDb();
  const vendaId = Number(dados.venda_id);
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(vendaId);
  if (!venda) throw new AppError('Venda nao encontrada.', 404);
  if (venda.status === 'cancelada') throw new AppError('Esta venda ja esta cancelada.');

  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (!itens.length) throw new AppError('Selecione ao menos um item para devolver.');

  const itensCalc = itens.map((it) => {
    const vi = db.prepare('SELECT * FROM vendas_itens WHERE id = ? AND venda_id = ?').get(it.venda_item_id, vendaId);
    if (!vi) throw new AppError('Item da venda nao encontrado.', 404);
    const qtd = Number(it.quantidade);
    if (!(qtd > 0)) throw new AppError(`Quantidade invalida para "${vi.descricao}".`);
    const disponivel = arred(Number(vi.quantidade) - Number(vi.quantidade_devolvida || 0));
    if (qtd > disponivel + 0.0001) {
      throw new AppError(`"${vi.descricao}": so e possivel devolver ate ${disponivel} unidade(s).`);
    }
    const valorUnitario = arred(Number(vi.valor_total) / Number(vi.quantidade));
    return { vi, qtd, valorUnitario, valorItem: arred(valorUnitario * qtd) };
  });
  const valorDevolvido = arred(itensCalc.reduce((s, i) => s + i.valorItem, 0));

  const itensTroca = Array.isArray(dados.itens_troca) ? dados.itens_troca : [];
  const trocaCalc = itensTroca.filter((it) => it && it.produto_id).map((it) => {
    const prod = db.prepare('SELECT * FROM produtos WHERE id = ?').get(it.produto_id);
    if (!prod) throw new AppError('Produto da troca nao encontrado.', 404);
    const qtd = Number(it.quantidade);
    if (!(qtd > 0)) throw new AppError(`Quantidade invalida para "${prod.nome}".`);
    const preco = it.preco_unitario != null && it.preco_unitario !== '' ? Number(it.preco_unitario) : Number(prod.preco_venda);
    return { prod, qtd, preco, valorItem: arred(qtd * preco) };
  });
  const valorNovosItens = arred(trocaCalc.reduce((s, i) => s + i.valorItem, 0));

  const diferenca = arred(valorDevolvido - valorNovosItens);

  // eslint-disable-next-line global-require
  const fin = require('./financeiroService');

  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO devolucoes (venda_id, motivo, valor_devolvido, valor_novos_itens, diferenca, forma_pagamento_diferenca, observacao)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      vendaId, (dados.motivo || '').trim() || null, valorDevolvido, valorNovosItens, diferenca,
      dados.forma_pagamento_diferenca || null, (dados.observacao || '').trim() || null
    );
    const devolucaoId = info.lastInsertRowid;

    const insItem = db.prepare(
      `INSERT INTO devolucoes_itens (devolucao_id, venda_item_id, produto_id, descricao, quantidade, valor_unitario, valor_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );
    for (const { vi, qtd, valorUnitario, valorItem } of itensCalc) {
      insItem.run(devolucaoId, vi.id, vi.produto_id, vi.descricao, qtd, valorUnitario, valorItem);
      db.prepare('UPDATE vendas_itens SET quantidade_devolvida = quantidade_devolvida + ? WHERE id = ?').run(qtd, vi.id);

      const prod = vi.produto_id ? db.prepare('SELECT eh_servico, eh_kit FROM produtos WHERE id = ?').get(vi.produto_id) : null;
      if (prod && !prod.eh_servico && !prod.eh_kit) {
        registrarMovimentacao(db, {
          produto_id: vi.produto_id, tipo: 'entrada', quantidade: qtd, custo_unitario: vi.custo_unitario,
          origem: 'devolucao', referencia_id: devolucaoId, observacao: `Devolucao da venda #${vendaId}`,
        });
      }
    }

    const insTroca = db.prepare(
      `INSERT INTO devolucoes_itens_troca (devolucao_id, produto_id, descricao, quantidade, valor_unitario, valor_total)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const { prod, qtd, preco, valorItem } of trocaCalc) {
      insTroca.run(devolucaoId, prod.id, prod.nome, qtd, preco, valorItem);
      if (!prod.eh_servico && !prod.eh_kit) {
        registrarMovimentacao(db, {
          produto_id: prod.id, tipo: 'saida', quantidade: qtd, custo_unitario: Number(prod.custo || 0),
          origem: 'devolucao_troca', referencia_id: devolucaoId, observacao: `Troca (saida) - devolucao #${devolucaoId}`,
        });
      }
    }

    // Abate a diferenca positiva (loja deve ao cliente) primeiro das contas a
    // receber "a prazo" pendentes desta venda — o dinheiro ainda nem entrou.
    let resto = diferenca;
    if (resto > 0) {
      const pendentes = db.prepare(
        "SELECT * FROM contas_receber WHERE venda_id = ? AND status = 'pendente' AND tipo = 'normal' ORDER BY id"
      ).all(vendaId);
      for (const cr of pendentes) {
        if (resto <= 0) break;
        const abate = Math.min(Number(cr.valor), resto);
        const novoValor = arred(Number(cr.valor) - abate);
        if (novoValor <= 0.004) db.prepare("UPDATE contas_receber SET status = 'cancelada' WHERE id = ?").run(cr.id);
        else db.prepare('UPDATE contas_receber SET valor = ? WHERE id = ?').run(novoValor, cr.id);
        resto = arred(resto - abate);
      }
    }
    if (Math.abs(resto) > 0.004) {
      if (!dados.forma_pagamento_diferenca) {
        throw new AppError(resto > 0 ? 'Informe a forma de reembolso da diferenca.' : 'Informe a forma de pagamento da diferenca.');
      }
      const contaId = fin.contaDaForma(db, dados.forma_pagamento_diferenca);
      fin.lancarMovimentoConta(db, {
        conta_id: contaId, tipo: resto > 0 ? 'saida' : 'entrada', valor: Math.abs(resto),
        origem: 'devolucao', referencia_id: devolucaoId,
        descricao: `Devolucao venda #${vendaId}${resto > 0 ? ' (reembolso)' : ' (diferenca cobrada)'}`,
      });
    }

    return devolucaoId;
  });

  return obterDevolucao(tx());
}

function obterDevolucao(id) {
  const db = getDb();
  const d = db.prepare('SELECT * FROM devolucoes WHERE id = ?').get(id);
  if (!d) throw new AppError('Devolucao nao encontrada.', 404);
  d.itens = db.prepare('SELECT * FROM devolucoes_itens WHERE devolucao_id = ?').all(id);
  d.itens_troca = db.prepare('SELECT * FROM devolucoes_itens_troca WHERE devolucao_id = ?').all(id);
  return d;
}

function listarDevolucoes({ venda_id, inicio, fim } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (venda_id) { where.push('d.venda_id = @venda_id'); params.venda_id = Number(venda_id); }
  if (inicio) { where.push('date(d.data) >= date(@inicio)'); params.inicio = inicio; }
  if (fim) { where.push('date(d.data) <= date(@fim)'); params.fim = fim; }
  return db.prepare(`
    SELECT d.* FROM devolucoes d
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY d.id DESC LIMIT 300
  `).all(params);
}

module.exports = { criarDevolucao, obterDevolucao, listarDevolucoes };
