'use strict';

/**
 * Sacola de vendas ("leva e traz"): produtos que saem fisicamente da loja
 * para serem mostrados/vendidos em outro lugar (ex.: na casa do cliente).
 * Ao montar a sacola, os itens ja saem do estoque (nao estao mais na loja).
 * Na conferencia (quando a sacola volta), o que retornou entra de volta no
 * estoque e o que nao retornou vira uma venda automaticamente — cobre tanto
 * o caso do cliente ter comprado quanto o de ter ficado devendo.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { registrarMovimentacao } = require('./estoqueService');
const { arred } = require('./precificacaoService');

function listar({ status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('s.status = @status'); params.status = status; }
  return db.prepare(`
    SELECT s.*, c.nome AS cliente_cadastrado_nome, p.nome AS vendedor_nome,
      (SELECT COUNT(*) FROM sacolas_venda_itens WHERE sacola_id = s.id) AS total_itens,
      (SELECT COALESCE(SUM(quantidade_levada),0) FROM sacolas_venda_itens WHERE sacola_id = s.id) AS total_pecas
    FROM sacolas_venda s
    LEFT JOIN clientes c ON c.id = s.cliente_id
    LEFT JOIN profissionais p ON p.id = s.vendedor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (s.status = 'conferida'), s.id DESC
  `).all(params);
}

function obter(id) {
  const db = getDb();
  const s = db.prepare(`
    SELECT s.*, c.nome AS cliente_cadastrado_nome, p.nome AS vendedor_nome
    FROM sacolas_venda s
    LEFT JOIN clientes c ON c.id = s.cliente_id
    LEFT JOIN profissionais p ON p.id = s.vendedor_id
    WHERE s.id = ?
  `).get(id);
  if (!s) throw new AppError('Sacola não encontrada.', 404);
  s.itens = db.prepare('SELECT * FROM sacolas_venda_itens WHERE sacola_id = ? ORDER BY id').all(id);
  return s;
}

/**
 * Monta uma sacola: dados = { cliente_id?, cliente_nome?, vendedor_id?,
 * observacao?, itens: [{ produto_id, quantidade }] }. Da saida no estoque
 * de cada item na hora (a mercadoria sai fisicamente da loja).
 */
function criar(dados) {
  const db = getDb();
  const itens = Array.isArray(dados.itens) ? dados.itens : [];
  if (!itens.length) throw new AppError('Adicione ao menos um produto na sacola.');

  const itensCalc = itens.map((it) => {
    const prod = db.prepare('SELECT * FROM produtos WHERE id = ?').get(it.produto_id);
    if (!prod) throw new AppError('Produto não encontrado (id ' + it.produto_id + ').', 404);
    if (prod.eh_servico || prod.eh_kit) throw new AppError(`"${prod.nome}" não pode ir numa sacola (serviço/kit não tem estoque próprio).`);
    const qtd = Number(it.quantidade);
    if (!(qtd > 0)) throw new AppError(`Quantidade inválida para "${prod.nome}".`);
    if (qtd > Number(prod.estoque_atual) + 0.0001) {
      throw new AppError(`"${prod.nome}": só há ${prod.estoque_atual} em estoque.`);
    }
    return { prod, qtd };
  });

  const ins = db.prepare(
    `INSERT INTO sacolas_venda_itens (sacola_id, produto_id, descricao, quantidade_levada, preco_unitario, custo_unitario)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO sacolas_venda (cliente_id, cliente_nome, vendedor_id, observacao)
       VALUES (?, ?, ?, ?)`
    ).run(dados.cliente_id || null, (dados.cliente_nome || '').trim() || null, dados.vendedor_id || null, (dados.observacao || '').trim() || null);
    const sacolaId = info.lastInsertRowid;

    for (const { prod, qtd } of itensCalc) {
      ins.run(sacolaId, prod.id, prod.nome, qtd, Number(prod.preco_venda), Number(prod.custo || 0));
      registrarMovimentacao(db, {
        produto_id: prod.id, tipo: 'saida', quantidade: qtd, custo_unitario: Number(prod.custo || 0),
        origem: 'sacola', referencia_id: sacolaId, observacao: `Saiu na sacola #${sacolaId}`,
      });
    }
    return sacolaId;
  });

  return obter(tx());
}

/** Cancela uma sacola ainda aberta, devolvendo tudo ao estoque. */
function excluir(id) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM sacolas_venda WHERE id = ?').get(id);
  if (!s) throw new AppError('Sacola não encontrada.', 404);
  if (s.status !== 'aberta') throw new AppError('Só é possível excluir sacolas ainda não conferidas.');
  const tx = db.transaction(() => {
    const itens = db.prepare('SELECT * FROM sacolas_venda_itens WHERE sacola_id = ?').all(id);
    for (const it of itens) {
      registrarMovimentacao(db, {
        produto_id: it.produto_id, tipo: 'entrada', quantidade: it.quantidade_levada, custo_unitario: it.custo_unitario,
        origem: 'sacola_cancelada', referencia_id: id, observacao: `Sacola #${id} cancelada`,
      });
    }
    db.prepare('DELETE FROM sacolas_venda WHERE id = ?').run(id);
  });
  tx();
  return { ok: true };
}

/**
 * Confere a sacola: dados = { itens: [{ item_id, quantidade_retornada }],
 * forma_pagamento? ('dinheiro'|'pix'|'cartao_credito'|'cartao_debito'|'prazo'),
 * vencimento_prazo? }. O que voltou entra no estoque; o que nao voltou vira
 * uma venda (a prazo por padrao, se a forma nao for informada — cobre o
 * caso do cliente ter ficado devendo).
 */
function conferir(id, dados) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM sacolas_venda WHERE id = ?').get(id);
  if (!s) throw new AppError('Sacola não encontrada.', 404);
  if (s.status !== 'aberta') throw new AppError('Esta sacola já foi conferida.');

  const itensSacola = db.prepare('SELECT * FROM sacolas_venda_itens WHERE sacola_id = ?').all(id);
  const infos = Array.isArray(dados.itens) ? dados.itens : [];
  const porId = new Map(infos.map((i) => [Number(i.item_id), i]));

  const plano = itensSacola.map((it) => {
    const info = porId.get(it.id);
    if (!info) throw new AppError(`Informe o retorno do item "${it.descricao}".`);
    const retornada = Number(info.quantidade_retornada);
    if (Number.isNaN(retornada) || retornada < 0 || retornada > it.quantidade_levada + 0.0001) {
      throw new AppError(`Quantidade retornada inválida para "${it.descricao}" (levado: ${it.quantidade_levada}).`);
    }
    const vendida = arred(it.quantidade_levada - retornada);
    return { it, retornada, vendida };
  });

  const itensVendidos = plano.filter((p) => p.vendida > 0);
  // eslint-disable-next-line global-require
  const fin = require('./financeiroService');

  const tx = db.transaction(() => {
    for (const { it, retornada } of plano) {
      db.prepare('UPDATE sacolas_venda_itens SET quantidade_retornada = ? WHERE id = ?').run(retornada, it.id);
      if (retornada > 0) {
        registrarMovimentacao(db, {
          produto_id: it.produto_id, tipo: 'entrada', quantidade: retornada, custo_unitario: it.custo_unitario,
          origem: 'sacola_retorno', referencia_id: id, observacao: `Retorno da sacola #${id}`,
        });
      }
    }

    let vendaId = null;
    if (itensVendidos.length) {
      const totalBruto = arred(itensVendidos.reduce((soma, p) => soma + p.vendida * p.it.preco_unitario, 0));
      const vInfo = db.prepare(
        `INSERT INTO vendas (valor_bruto, desconto, valor_total, status, cliente_id, observacao)
         VALUES (?, 0, ?, 'concluida', ?, ?)`
      ).run(totalBruto, totalBruto, s.cliente_id, `Venda gerada pela sacola #${id}`);
      vendaId = vInfo.lastInsertRowid;

      const insItem = db.prepare(
        `INSERT INTO vendas_itens (venda_id, produto_id, descricao, quantidade, preco_unitario, custo_unitario, desconto_item, valor_total)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?)`
      );
      for (const { it, vendida } of itensVendidos) {
        insItem.run(vendaId, it.produto_id, it.descricao, vendida, it.preco_unitario, it.custo_unitario, arred(vendida * it.preco_unitario));
      }

      const forma = dados.forma_pagamento || 'prazo';
      db.prepare('INSERT INTO vendas_pagamentos (venda_id, forma_pagamento, valor) VALUES (?, ?, ?)').run(vendaId, forma, totalBruto);

      if (forma === 'prazo') {
        db.prepare(
          `INSERT INTO contas_receber (venda_id, cliente_id, descricao, valor, parcela, total_parcelas, vencimento, status, tipo)
           VALUES (?, ?, ?, ?, 1, 1, ?, 'pendente', 'normal')`
        ).run(vendaId, s.cliente_id, `Venda #${vendaId} (sacola)`, totalBruto, dados.vencimento_prazo || null);
      } else {
        const contaId = fin.contaDaForma(db, forma);
        fin.lancarMovimentoConta(db, {
          conta_id: contaId, tipo: 'entrada', valor: totalBruto, origem: 'venda',
          referencia_id: vendaId, descricao: `Venda #${vendaId} (sacola)`,
        });
        db.prepare(
          `INSERT INTO contas_receber (venda_id, cliente_id, descricao, valor, parcela, total_parcelas,
             vencimento, status, tipo, forma_recebimento, data_recebimento, conta_financeira_id)
           VALUES (?, ?, ?, ?, 1, 1, date('now','localtime'), 'recebido', 'venda_vista', ?, date('now','localtime'), ?)`
        ).run(vendaId, s.cliente_id, `Venda #${vendaId}`, totalBruto, forma, contaId);
      }
    }

    db.prepare(
      "UPDATE sacolas_venda SET status='conferida', data_conferencia=datetime('now','localtime'), venda_id=? WHERE id=?"
    ).run(vendaId, id);
  });
  tx();

  return obter(id);
}

module.exports = { listar, obter, criar, excluir, conferir };
