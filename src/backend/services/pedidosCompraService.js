'use strict';

/**
 * Pedido de compra: um "rascunho" a ser enviado para o fornecedor, ANTES da
 * mercadoria chegar — diferente de "compras" (nota fiscal ja importada, com
 * estoque ja recebido). Cada pedido e sempre de UM fornecedor so, e os itens
 * precisam ser de produtos daquele mesmo fornecedor (produtos.fornecedor_id).
 *
 * Nao mexe em estoque nem financeiro: quando a mercadoria chega de verdade,
 * o fluxo de "Importar NF-e" continua sendo quem da entrada no estoque; o
 * pedido so e marcado como "recebido" para sair da lista do que esta em
 * aberto (e pode ficar vinculado a compra real gerada pela NF-e).
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');

const TRANSICOES = {
  aberto: ['enviado', 'recebido', 'cancelado'],
  enviado: ['recebido', 'cancelado', 'aberto'],
  recebido: [],
  cancelado: [],
};

function listar({ status, fornecedor_id } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('pc.status = @status'); params.status = status; }
  if (fornecedor_id) { where.push('pc.fornecedor_id = @fornecedor_id'); params.fornecedor_id = Number(fornecedor_id); }
  return db.prepare(`
    SELECT pc.*, f.nome AS fornecedor_nome,
      (SELECT COUNT(*) FROM pedidos_compra_itens WHERE pedido_id = pc.id) AS qtd_itens
    FROM pedidos_compra pc
    JOIN fornecedores f ON f.id = pc.fornecedor_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (pc.status = 'aberto') DESC, pc.criado_em DESC
  `).all(params);
}

function obter(id) {
  const db = getDb();
  const pedido = db.prepare(`
    SELECT pc.*, f.nome AS fornecedor_nome, f.telefone AS fornecedor_telefone, f.email AS fornecedor_email
    FROM pedidos_compra pc JOIN fornecedores f ON f.id = pc.fornecedor_id
    WHERE pc.id = ?
  `).get(id);
  if (!pedido) throw new AppError('Pedido de compra não encontrado.', 404);
  pedido.itens = db.prepare(`
    SELECT pci.*, p.nome AS produto_nome, p.codigo_barras, p.unidade, p.estoque_atual
    FROM pedidos_compra_itens pci JOIN produtos p ON p.id = pci.produto_id
    WHERE pci.pedido_id = ?
    ORDER BY p.nome COLLATE NOCASE
  `).all(id);
  return pedido;
}

/**
 * Valida que cada item e' de um produto do fornecedor do pedido, e calcula
 * os totais. Itens sem produto_id (vindos da importacao de planilha, sem
 * correspondencia num produto ja cadastrado desse fornecedor) tem o produto
 * criado na hora — sem preco de venda ainda, sera definido na Precificacao.
 */
function validarEPrepararItens(db, fornecedorId, itens) {
  if (!Array.isArray(itens) || !itens.length) throw new AppError('Adicione ao menos um item ao pedido.');
  // eslint-disable-next-line global-require
  const produtosService = require('./produtosService');
  const criadosNovos = [];

  const preparados = itens.map((it) => {
    let produtoId = Number(it.produto_id) || null;
    const quantidade = Number(it.quantidade);
    if (!(quantidade > 0)) throw new AppError('Item inválido: informe produto e quantidade maior que zero.');

    if (!produtoId) {
      const nome = ((it.novo && it.novo.nome) || it.nome || '').toString().trim();
      if (!nome) throw new AppError('Item inválido: informe produto e quantidade maior que zero.');
      const codigoBarras = ((it.novo && it.novo.codigo_barras) || it.codigo_barras || '').toString().trim() || null;
      // Reconfere no momento de salvar (evita duplicar se o produto foi
      // cadastrado por outro caminho entre a importacao da planilha e o salvar).
      let existente = null;
      if (codigoBarras) {
        existente = db.prepare('SELECT id FROM produtos WHERE ativo = 1 AND fornecedor_id = ? AND codigo_barras = ?').get(fornecedorId, codigoBarras);
      }
      if (!existente) {
        existente = db.prepare("SELECT id FROM produtos WHERE ativo = 1 AND fornecedor_id = ? AND LOWER(TRIM(nome)) = ?").get(fornecedorId, nome.toLowerCase());
      }
      if (existente) {
        produtoId = existente.id;
      } else {
        const custoUnitario = arred(Number(it.custo_unitario || 0));
        const novoProduto = produtosService.criar({
          nome, codigo_barras: codigoBarras, fornecedor_id: fornecedorId,
          custo: custoUnitario, estoque_atual: 0, _semPrecoAuto: true,
        });
        produtoId = novoProduto.id;
        criadosNovos.push(novoProduto);
      }
    }

    const produto = db.prepare('SELECT id, nome, fornecedor_id, custo FROM produtos WHERE id = ?').get(produtoId);
    if (!produto) throw new AppError('Produto não encontrado.', 404);
    if (Number(produto.fornecedor_id) !== Number(fornecedorId)) {
      throw new AppError(`O produto "${produto.nome}" não é cadastrado com esse fornecedor.`);
    }
    const custoUnitario = arred(it.custo_unitario !== undefined && it.custo_unitario !== '' ? Number(it.custo_unitario) : Number(produto.custo || 0));
    return {
      produto_id: produtoId, quantidade, custo_unitario: custoUnitario,
      valor_total: arred(quantidade * custoUnitario), _nome: produto.nome,
    };
  });

  return { preparados, criadosNovos };
}

/** Rotulo estavel do pedido, usado pra agrupar seus itens na fila de Conferência de Mercadoria. */
function rotuloConferencia(pedidoId, fornecedorNome) {
  return `Pedido de compra #${pedidoId} — ${fornecedorNome}`;
}

/**
 * Manda os itens do pedido pra fila de Conferência de Mercadoria (quantidade
 * pedida = quantidade esperada, pra bater contra o que chegar de verdade) e
 * os produtos novos criados na hora pra Precificacao (ainda sem preco de
 * venda). Reimporta do zero a cada chamada (idempotente), pra manter a fila
 * sincronizada quando o pedido e' editado.
 */
function sincronizarFilas(pedidoId, fornecedorNome, preparados, criadosNovos) {
  // eslint-disable-next-line global-require
  const conferencia = require('./conferenciaService');
  const rotulo = rotuloConferencia(pedidoId, fornecedorNome);
  conferencia.excluirLote(rotulo);
  conferencia.importarProdutos(preparados.map((i) => ({
    produto_id: i.produto_id, descricao: i._nome, quantidade: i.quantidade,
  })), rotulo);

  if (criadosNovos.length) {
    // eslint-disable-next-line global-require
    const prec = require('./precAvancadaService');
    prec.importarProdutos(criadosNovos.map((p) => ({
      produto_id: p.id, referencia: p.codigo_barras, descricao: p.nome, quantidade: 1, valor_pedido: Number(p.custo || 0),
    })), rotulo);
  }
}

function criar({ fornecedor_id, observacao, itens }) {
  const db = getDb();
  const fornecedorId = Number(fornecedor_id);
  const fornecedor = db.prepare('SELECT id, nome FROM fornecedores WHERE id = ?').get(fornecedorId);
  if (!fornecedor) throw new AppError('Selecione um fornecedor.');

  const { preparados, criadosNovos } = validarEPrepararItens(db, fornecedorId, itens);
  const valorTotal = arred(preparados.reduce((s, i) => s + i.valor_total, 0));

  const id = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO pedidos_compra (fornecedor_id, observacao, valor_total) VALUES (?, ?, ?)
    `).run(fornecedorId, (observacao || '').trim() || null, valorTotal);
    const pedidoId = info.lastInsertRowid;
    const ins = db.prepare(`
      INSERT INTO pedidos_compra_itens (pedido_id, produto_id, quantidade, custo_unitario, valor_total)
      VALUES (?, ?, ?, ?, ?)
    `);
    preparados.forEach((i) => ins.run(pedidoId, i.produto_id, i.quantidade, i.custo_unitario, i.valor_total));
    return pedidoId;
  })();

  sincronizarFilas(id, fornecedor.nome, preparados, criadosNovos);
  return obter(id);
}

function atualizar(id, { observacao, itens }) {
  const db = getDb();
  const pedido = db.prepare(`
    SELECT pc.*, f.nome AS fornecedor_nome FROM pedidos_compra pc
    JOIN fornecedores f ON f.id = pc.fornecedor_id WHERE pc.id = ?
  `).get(id);
  if (!pedido) throw new AppError('Pedido de compra não encontrado.', 404);
  if (pedido.status !== 'aberto') throw new AppError('Só é possível editar um pedido em aberto.');

  const { preparados, criadosNovos } = validarEPrepararItens(db, pedido.fornecedor_id, itens);
  const valorTotal = arred(preparados.reduce((s, i) => s + i.valor_total, 0));

  db.transaction(() => {
    db.prepare('UPDATE pedidos_compra SET observacao = ?, valor_total = ? WHERE id = ?')
      .run((observacao || '').trim() || null, valorTotal, id);
    db.prepare('DELETE FROM pedidos_compra_itens WHERE pedido_id = ?').run(id);
    const ins = db.prepare(`
      INSERT INTO pedidos_compra_itens (pedido_id, produto_id, quantidade, custo_unitario, valor_total)
      VALUES (?, ?, ?, ?, ?)
    `);
    preparados.forEach((i) => ins.run(id, i.produto_id, i.quantidade, i.custo_unitario, i.valor_total));
  })();

  sincronizarFilas(id, pedido.fornecedor_nome, preparados, criadosNovos);
  return obter(id);
}

function mudarStatus(id, status) {
  const db = getDb();
  const pedido = db.prepare(`
    SELECT pc.*, f.nome AS fornecedor_nome FROM pedidos_compra pc
    JOIN fornecedores f ON f.id = pc.fornecedor_id WHERE pc.id = ?
  `).get(id);
  if (!pedido) throw new AppError('Pedido de compra não encontrado.', 404);
  const permitidas = TRANSICOES[pedido.status] || [];
  if (!permitidas.includes(status)) {
    throw new AppError(`Não é possível mudar de "${pedido.status}" para "${status}".`);
  }
  const campos = { status };
  if (status === 'enviado') campos.enviado_em = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (status === 'recebido') campos.recebido_em = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const sets = Object.keys(campos).map((k) => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE pedidos_compra SET ${sets} WHERE id = @id`).run({ ...campos, id });
  if (status === 'cancelado') {
    // eslint-disable-next-line global-require
    require('./conferenciaService').excluirLote(rotuloConferencia(id, pedido.fornecedor_nome));
  }
  return obter(id);
}

function excluir(id) {
  const db = getDb();
  const pedido = db.prepare(`
    SELECT pc.*, f.nome AS fornecedor_nome FROM pedidos_compra pc
    JOIN fornecedores f ON f.id = pc.fornecedor_id WHERE pc.id = ?
  `).get(id);
  if (!pedido) throw new AppError('Pedido de compra não encontrado.', 404);
  if (pedido.status !== 'aberto') throw new AppError('Só é possível excluir um pedido em aberto.');
  db.prepare('DELETE FROM pedidos_compra WHERE id = ?').run(id);
  // eslint-disable-next-line global-require
  require('./conferenciaService').excluirLote(rotuloConferencia(id, pedido.fornecedor_nome));
  return { ok: true };
}

/**
 * Casa cada linha da planilha importada com um produto ja cadastrado desse
 * fornecedor (por codigo de barras ou nome); o que nao bater volta marcado
 * como "novo" pro usuario revisar antes de salvar o pedido. Nao persiste
 * nada — quem cria os produtos novos de verdade e' validarEPrepararItens,
 * no momento de salvar.
 */
function resolverItensDaPlanilha(fornecedorId, linhas) {
  const db = getDb();
  return linhas.map((l) => {
    const codigo = String(l.codigo_barras || '').trim();
    const nomeNorm = String(l.nome || '').trim().toLowerCase();
    let produto = null;
    if (codigo) {
      produto = db.prepare('SELECT id, nome, codigo_barras, unidade, custo FROM produtos WHERE ativo = 1 AND fornecedor_id = ? AND codigo_barras = ?').get(fornecedorId, codigo);
    }
    if (!produto && nomeNorm) {
      produto = db.prepare("SELECT id, nome, codigo_barras, unidade, custo FROM produtos WHERE ativo = 1 AND fornecedor_id = ? AND LOWER(TRIM(nome)) = ?").get(fornecedorId, nomeNorm);
    }
    const quantidade = Number(l.quantidade) > 0 ? Number(l.quantidade) : 1;
    const custoPlanilha = l.custo_unitario !== undefined && l.custo_unitario !== '' && !Number.isNaN(Number(l.custo_unitario))
      ? Number(l.custo_unitario) : null;

    if (produto) {
      return {
        produto_id: produto.id, nome: produto.nome, unidade: produto.unidade,
        quantidade, custo_unitario: custoPlanilha != null ? custoPlanilha : Number(produto.custo || 0),
      };
    }
    return {
      produto_id: null, novo: true, nome: l.nome, codigo_barras: l.codigo_barras || null,
      unidade: 'UN', quantidade, custo_unitario: custoPlanilha || 0,
    };
  });
}

/** Sugere itens para um novo pedido: produtos do fornecedor abaixo do estoque mínimo. */
function sugerirItens(fornecedor_id) {
  const db = getDb();
  const produtos = db.prepare(`
    SELECT id AS produto_id, nome AS produto_nome, codigo_barras, unidade, custo, estoque_atual, estoque_minimo
    FROM produtos
    WHERE fornecedor_id = ? AND ativo = 1 AND eh_servico = 0 AND estoque_atual <= estoque_minimo
    ORDER BY nome COLLATE NOCASE
  `).all(Number(fornecedor_id));
  return produtos.map((p) => ({
    ...p,
    quantidade: Math.max(1, Math.ceil(Number(p.estoque_minimo) - Number(p.estoque_atual)) || 1),
    custo_unitario: p.custo,
  }));
}

module.exports = { listar, obter, criar, atualizar, mudarStatus, excluir, sugerirItens, resolverItensDaPlanilha };
