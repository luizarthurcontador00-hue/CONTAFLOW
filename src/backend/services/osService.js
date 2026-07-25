'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { arred } = require('./precificacaoService');

const STATUS = {
  os: ['aberta', 'em_andamento', 'concluida', 'entregue', 'cancelada'],
  orcamento: ['aberto', 'aprovado', 'recusado', 'expirado', 'cancelada'],
};

function tipoValido(t) { return t === 'orcamento' ? 'orcamento' : 'os'; }

function proximoNumero(db, tipo) {
  return db.prepare('SELECT COALESCE(MAX(numero),0)+1 n FROM ordens_servico WHERE tipo = ?').get(tipo).n;
}

/** Normaliza e calcula os itens; busca custo do produto vinculado. */
function prepararItens(db, itens) {
  const lista = Array.isArray(itens) ? itens : [];
  return lista.map((it) => {
    let produto_id = it.produto_id ? Number(it.produto_id) : null;
    let custo = Number(it.custo_unitario || 0);
    let tipo = it.tipo || 'livre';
    let descricao = (it.descricao || '').trim();
    if (produto_id) {
      const prod = db.prepare('SELECT nome, custo, eh_servico FROM produtos WHERE id = ?').get(produto_id);
      if (!prod) { produto_id = null; } else {
        if (!descricao) descricao = prod.nome;
        custo = Number(prod.custo || 0);
        tipo = prod.eh_servico ? 'servico' : 'produto';
      }
    }
    if (!descricao) throw new AppError('Todo item precisa de uma descrição.');
    const quantidade = Number(it.quantidade || 0) || 1;
    const preco = Number(it.preco_unitario || 0);
    return {
      produto_id, tipo, descricao, quantidade,
      preco_unitario: arred(preco), custo_unitario: arred(custo),
      valor_total: arred(quantidade * preco),
    };
  });
}

function calcularTotal(itens, desconto) {
  const bruto = itens.reduce((s, i) => s + Number(i.valor_total), 0);
  return arred(Math.max(0, bruto - Number(desconto || 0)));
}

function listar({ tipo, status, cliente_id, busca } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (tipo) { where.push('os.tipo = @tipo'); params.tipo = tipoValido(tipo); }
  if (status) { where.push('os.status = @status'); params.status = status; }
  if (cliente_id) { where.push('os.cliente_id = @cliente_id'); params.cliente_id = Number(cliente_id); }
  if (busca) {
    where.push('(c.nome LIKE @busca OR os.equipamento LIKE @busca OR os.defeito LIKE @busca OR CAST(os.numero AS TEXT) LIKE @busca)');
    params.busca = `%${busca}%`;
  }
  return db.prepare(`
    SELECT os.*, c.nome AS cliente_nome, p.nome AS profissional_nome, p.cor AS profissional_cor,
      (SELECT COUNT(*) FROM ordens_servico_itens i WHERE i.os_id = os.id) AS total_itens
    FROM ordens_servico os
    LEFT JOIN clientes c ON c.id = os.cliente_id
    LEFT JOIN profissionais p ON p.id = os.profissional_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY os.numero DESC
  `).all(params);
}

function obter(id) {
  const db = getDb();
  const os = db.prepare(`
    SELECT os.*, c.nome AS cliente_nome, c.telefone AS cliente_telefone, c.cpf AS cliente_cpf,
      p.nome AS profissional_nome, p.cor AS profissional_cor
    FROM ordens_servico os
    LEFT JOIN clientes c ON c.id = os.cliente_id
    LEFT JOIN profissionais p ON p.id = os.profissional_id
    WHERE os.id = ?
  `).get(id);
  if (!os) throw new AppError('Ordem/orçamento não encontrado.', 404);
  os.itens = db.prepare('SELECT * FROM ordens_servico_itens WHERE os_id = ? ORDER BY id').all(id);
  return os;
}

function montarCabecalho(dados) {
  return {
    cliente_id: dados.cliente_id ? Number(dados.cliente_id) : null,
    equipamento: dados.equipamento || null,
    marca_modelo: dados.marca_modelo || null,
    identificacao: dados.identificacao || null,
    defeito: dados.defeito || null,
    laudo: dados.laudo || null,
    responsavel: dados.responsavel || null,
    profissional_id: dados.profissional_id ? Number(dados.profissional_id) : null,
    observacao: dados.observacao || null,
    desconto: Number(dados.desconto || 0),
    garantia_dias: Number(dados.garantia_dias || 0),
    validade: dados.validade || null,
    data_previsao: dados.data_previsao || null,
  };
}

function criar(dados) {
  const db = getDb();
  const tipo = tipoValido(dados.tipo);
  const h = montarCabecalho(dados);
  const itens = prepararItens(db, dados.itens);
  const total = calcularTotal(itens, h.desconto);
  const statusInicial = tipo === 'orcamento' ? 'aberto' : 'aberta';

  const tx = db.transaction(() => {
    const numero = proximoNumero(db, tipo);
    const info = db.prepare(`
      INSERT INTO ordens_servico
        (tipo, numero, cliente_id, status, equipamento, marca_modelo, identificacao, defeito, laudo,
         responsavel, profissional_id, observacao, desconto, valor_total, garantia_dias, validade, data_previsao)
      VALUES (@tipo, @numero, @cliente_id, @status, @equipamento, @marca_modelo, @identificacao, @defeito, @laudo,
         @responsavel, @profissional_id, @observacao, @desconto, @valor_total, @garantia_dias, @validade, @data_previsao)
    `).run({ tipo, numero, status: statusInicial, valor_total: total, ...h });
    const osId = info.lastInsertRowid;
    inserirItens(db, osId, itens);
    return osId;
  });
  return obter(tx());
}

function inserirItens(db, osId, itens) {
  const ins = db.prepare(`
    INSERT INTO ordens_servico_itens (os_id, produto_id, tipo, descricao, quantidade, preco_unitario, custo_unitario, valor_total)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  itens.forEach((i) => ins.run(osId, i.produto_id, i.tipo, i.descricao, i.quantidade, i.preco_unitario, i.custo_unitario, i.valor_total));
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = obter(id);
  if (atual.venda_id) throw new AppError('Esta ordem já foi faturada e não pode ser editada.');
  const h = montarCabecalho({ ...atual, ...dados });
  const itens = dados.itens !== undefined ? prepararItens(db, dados.itens) : atual.itens;
  const total = calcularTotal(itens, h.desconto);

  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE ordens_servico SET
        cliente_id=@cliente_id, equipamento=@equipamento, marca_modelo=@marca_modelo, identificacao=@identificacao,
        defeito=@defeito, laudo=@laudo, responsavel=@responsavel, profissional_id=@profissional_id, observacao=@observacao, desconto=@desconto,
        valor_total=@valor_total, garantia_dias=@garantia_dias, validade=@validade, data_previsao=@data_previsao,
        atualizado_em=datetime('now','localtime')
      WHERE id=@id
    `).run({ id, valor_total: total, ...h });
    if (dados.itens !== undefined) {
      db.prepare('DELETE FROM ordens_servico_itens WHERE os_id = ?').run(id);
      inserirItens(db, id, itens);
    }
  });
  tx();
  return obter(id);
}

function mudarStatus(id, status) {
  const db = getDb();
  const os = obter(id);
  if (!STATUS[os.tipo].includes(status)) throw new AppError('Status inválido para este tipo.');
  const sets = ['status=@status', "atualizado_em=datetime('now','localtime')"];
  if (status === 'concluida') sets.push("data_conclusao=COALESCE(data_conclusao, datetime('now','localtime'))");
  if (status === 'entregue') sets.push("data_entrega=COALESCE(data_entrega, datetime('now','localtime'))");
  db.prepare(`UPDATE ordens_servico SET ${sets.join(', ')} WHERE id=@id`).run({ id, status });
  return obter(id);
}

/**
 * Fatura a OS/orçamento: gera uma venda de verdade (baixa estoque das peças,
 * entra no financeiro/DRE/contas a receber) reutilizando o vendasService.
 */
function faturar(id, { forma_pagamento = 'dinheiro', vencimento_prazo, data } = {}) {
  const db = getDb();
  const os = obter(id);
  if (os.venda_id) throw new AppError('Esta ordem já foi faturada.');
  if (os.status === 'cancelada') throw new AppError('Ordem cancelada não pode ser faturada.');
  if (!os.itens.length) throw new AppError('Adicione itens antes de faturar.');
  const semVinculo = os.itens.filter((i) => !i.produto_id);
  if (semVinculo.length) {
    throw new AppError('Para faturar, todos os itens precisam estar vinculados a um produto ou serviço do cadastro.');
  }

  // eslint-disable-next-line global-require
  const vendasService = require('./vendasService');
  const rotulo = (os.tipo === 'orcamento' ? 'Orçamento' : 'OS') + ' #' + os.numero;
  const venda = vendasService.criarVenda({
    itens: os.itens.map((i) => ({ produto_id: i.produto_id, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
    desconto: Number(os.desconto || 0),
    cliente_id: os.cliente_id || null,
    pagamentos: [{ forma_pagamento, valor: Number(os.valor_total) }],
    vencimento_prazo: vencimento_prazo || null,
    observacao: rotulo,
  });

  return { os: vincularVenda(id, venda.id), venda };
}

/**
 * Vincula uma venda ja existente (criada em outro lugar, ex.: PDV) a uma
 * ordem/orcamento: grava venda_id e avanca o status, sem criar nova venda.
 * Usada quando o usuario finaliza o pagamento diretamente na tela do PDV
 * (carrinho pre-carregado com os itens da ordem).
 */
function vincularVenda(id, vendaId) {
  const db = getDb();
  const os = obter(id);
  if (os.venda_id) throw new AppError('Esta ordem já foi faturada.');
  if (!vendaId) throw new AppError('Informe a venda a vincular.');
  const novoStatus = os.tipo === 'orcamento' ? 'aprovado' : 'entregue';
  db.prepare(`
    UPDATE ordens_servico SET venda_id=?, status=?,
      data_entrega=COALESCE(data_entrega, datetime('now','localtime')),
      atualizado_em=datetime('now','localtime')
    WHERE id=?
  `).run(Number(vendaId), novoStatus, id);
  return obter(id);
}

/** Gera uma OS a partir de um orçamento aprovado (copiando os itens). */
function gerarOSDeOrcamento(id) {
  const db = getDb();
  const orc = obter(id);
  if (orc.tipo !== 'orcamento') throw new AppError('Só é possível gerar OS a partir de um orçamento.');
  const nova = criar({
    tipo: 'os',
    cliente_id: orc.cliente_id,
    equipamento: orc.equipamento, marca_modelo: orc.marca_modelo, identificacao: orc.identificacao,
    defeito: orc.defeito, observacao: orc.observacao, desconto: orc.desconto, garantia_dias: orc.garantia_dias,
    itens: orc.itens.map((i) => ({ produto_id: i.produto_id, tipo: i.tipo, descricao: i.descricao, quantidade: i.quantidade, preco_unitario: i.preco_unitario })),
  });
  db.prepare("UPDATE ordens_servico SET status='aprovado', atualizado_em=datetime('now','localtime') WHERE id=?").run(id);
  return nova;
}

function excluir(id) {
  const db = getDb();
  const os = db.prepare('SELECT venda_id FROM ordens_servico WHERE id = ?').get(id);
  if (!os) throw new AppError('Ordem/orçamento não encontrado.', 404);
  if (os.venda_id) throw new AppError('Esta ordem já foi faturada; cancele a venda pelo módulo de Vendas.');
  db.prepare('DELETE FROM ordens_servico WHERE id = ?').run(id);
  return { ok: true };
}

module.exports = {
  STATUS, listar, obter, criar, atualizar, mudarStatus, faturar, vincularVenda, gerarOSDeOrcamento, excluir,
};
