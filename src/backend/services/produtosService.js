'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { registrarMovimentacao } = require('./estoqueService');
const { precoPorMarkup, markupEfetivo } = require('./precificacaoService');
const paths = require('../paths');

const SELECT_BASE = `
  SELECT p.*, c.nome AS categoria_nome, f.nome AS fornecedor_nome
  FROM produtos p
  LEFT JOIN categorias c ON c.id = p.categoria_id
  LEFT JOIN fornecedores f ON f.id = p.fornecedor_id
`;

function listar({ busca, categoria_id, estoque_baixo, incluir_inativos } = {}) {
  const db = getDb();
  const where = [];
  const params = {};

  if (!incluir_inativos) where.push('p.ativo = 1');
  if (busca) {
    where.push('(p.nome LIKE @busca OR p.codigo_barras LIKE @busca OR p.descricao LIKE @busca)');
    params.busca = `%${busca}%`;
  }
  if (categoria_id) {
    where.push('p.categoria_id = @categoria_id');
    params.categoria_id = Number(categoria_id);
  }
  if (estoque_baixo === true || estoque_baixo === 'true' || estoque_baixo === '1') {
    where.push('p.estoque_atual <= p.estoque_minimo');
  }

  const sql = SELECT_BASE +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY p.nome COLLATE NOCASE';
  return db.prepare(sql).all(params);
}

function obter(id) {
  const db = getDb();
  const prod = db.prepare(SELECT_BASE + ' WHERE p.id = ?').get(id);
  if (!prod) throw new AppError('Produto nao encontrado.', 404);
  return prod;
}

function movimentacoes(id, limite = 100) {
  const db = getDb();
  obter(id); // garante existencia
  return db
    .prepare(
      `SELECT * FROM movimentacoes_estoque
       WHERE produto_id = ? ORDER BY id DESC LIMIT ?`
    )
    .all(id, limite);
}

function normalizar(dados) {
  const custo = Number(dados.custo || 0);
  let preco_venda = dados.preco_venda != null && dados.preco_venda !== ''
    ? Number(dados.preco_venda)
    : null;

  // Se nao informaram preco mas ha markup (produto/categoria/global), calcula.
  if (preco_venda == null) {
    const markup = markupEfetivo({ markupProduto: dados.markup, categoriaId: dados.categoria_id });
    preco_venda = precoPorMarkup(custo, markup);
  }

  return {
    nome: (dados.nome || '').trim(),
    descricao: dados.descricao || null,
    codigo_barras: dados.codigo_barras ? String(dados.codigo_barras).trim() : null,
    categoria_id: dados.categoria_id ? Number(dados.categoria_id) : null,
    fornecedor_id: dados.fornecedor_id ? Number(dados.fornecedor_id) : null,
    unidade: (dados.unidade || 'UN').trim().toUpperCase(),
    custo,
    markup: dados.markup != null && dados.markup !== '' ? Number(dados.markup) : null,
    preco_venda,
    estoque_minimo: Number(dados.estoque_minimo || 0),
  };
}

function criar(dados) {
  const db = getDb();
  const d = normalizar(dados);
  if (!d.nome) throw new AppError('O nome do produto e obrigatorio.');

  const estoqueInicial = Number(dados.estoque_atual || 0);

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO produtos
          (nome, descricao, codigo_barras, categoria_id, fornecedor_id, unidade,
           custo, markup, preco_venda, estoque_atual, estoque_minimo, foto_path)
         VALUES
          (@nome, @descricao, @codigo_barras, @categoria_id, @fornecedor_id, @unidade,
           @custo, @markup, @preco_venda, 0, @estoque_minimo, @foto_path)`
      )
      .run({ ...d, foto_path: dados.foto_path || null });

    const id = info.lastInsertRowid;
    if (estoqueInicial > 0) {
      registrarMovimentacao(db, {
        produto_id: id,
        tipo: 'entrada',
        quantidade: estoqueInicial,
        custo_unitario: d.custo,
        origem: 'inicial',
        observacao: 'Estoque inicial do cadastro',
      });
    }
    return id;
  });

  const id = tx();
  return obter(id);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = obter(id);
  const d = normalizar({ ...atual, ...dados });

  // foto: mantem a atual se nao veio nova
  const foto_path = dados.foto_path !== undefined ? dados.foto_path : atual.foto_path;

  // Se trocou a foto e havia uma antiga diferente, remove o arquivo antigo.
  if (dados.foto_path !== undefined && atual.foto_path && atual.foto_path !== dados.foto_path) {
    removerFotoArquivo(atual.foto_path);
  }

  db.prepare(
    `UPDATE produtos SET
       nome=@nome, descricao=@descricao, codigo_barras=@codigo_barras,
       categoria_id=@categoria_id, fornecedor_id=@fornecedor_id, unidade=@unidade,
       custo=@custo, markup=@markup, preco_venda=@preco_venda,
       estoque_minimo=@estoque_minimo, foto_path=@foto_path,
       atualizado_em=datetime('now','localtime')
     WHERE id=@id`
  ).run({ ...d, foto_path, id });

  return obter(id);
}

/**
 * Ajuste manual de estoque para um valor absoluto (inventario). Gera a
 * movimentacao de entrada/saida correspondente a diferenca.
 */
function ajustarEstoque(id, novaQuantidade, motivo) {
  const db = getDb();
  const prod = obter(id);
  const nova = Number(novaQuantidade);
  if (Number.isNaN(nova)) throw new AppError('Quantidade invalida.');
  const diff = Number((nova - Number(prod.estoque_atual)).toFixed(3));
  if (diff === 0) return prod;

  const tx = db.transaction(() => {
    registrarMovimentacao(db, {
      produto_id: id,
      tipo: diff > 0 ? 'entrada' : 'saida',
      quantidade: Math.abs(diff),
      custo_unitario: prod.custo,
      origem: 'ajuste',
      observacao: motivo || 'Ajuste manual de estoque',
    });
  });
  tx();
  return obter(id);
}

/**
 * Exclusao: se o produto ja tem movimentacoes/vendas, apenas inativa
 * (soft delete) para preservar historico. Caso contrario, remove de fato.
 */
function excluir(id) {
  const db = getDb();
  const prod = obter(id);

  const temMov = db
    .prepare('SELECT 1 FROM movimentacoes_estoque WHERE produto_id = ? LIMIT 1')
    .get(id);
  const temVenda = db
    .prepare('SELECT 1 FROM vendas_itens WHERE produto_id = ? LIMIT 1')
    .get(id);

  if (temMov || temVenda) {
    db.prepare('UPDATE produtos SET ativo = 0 WHERE id = ?').run(id);
    return { inativado: true };
  }

  if (prod.foto_path) removerFotoArquivo(prod.foto_path);
  db.prepare('DELETE FROM produtos WHERE id = ?').run(id);
  return { excluido: true };
}

function removerFotoArquivo(nomeArquivo) {
  try {
    const p = path.join(paths.produtosImgDir, path.basename(nomeArquivo));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch (_) {
    /* ignora falha ao remover arquivo antigo */
  }
}

// ----------------------- Codigo de barras (etiquetas) -----------------------

/** Digito verificador padrao EAN-13 a partir dos 12 primeiros digitos. */
function ean13DigitoVerificador(doze) {
  let soma = 0;
  for (let i = 0; i < 12; i++) {
    soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const resto = soma % 10;
  return resto === 0 ? 0 : 10 - resto;
}

/**
 * Gera um codigo EAN-13 interno e unico para o produto, usando o prefixo
 * 20-29 (faixa reservada pelo GS1 para uso interno/circulacao restrita,
 * convencao comum em varejo para itens sem codigo de fabrica).
 */
function gerarCodigoInterno(id) {
  const doze = '20' + String(id).padStart(10, '0');
  return doze + ean13DigitoVerificador(doze);
}

/**
 * Garante que o produto tenha um codigo de barras EAN-13 valido (13 digitos)
 * para impressao de etiqueta. Se ja tiver um codigo de 13 digitos, usa-o sem
 * alterar. Caso contrario, gera um codigo interno e SALVA no cadastro, para
 * que a etiqueta impressa sempre corresponda ao que o PDV reconhece.
 */
function garantirCodigoBarras(id) {
  const db = getDb();
  const p = obter(id);
  const digitos = (p.codigo_barras || '').replace(/\D/g, '');
  if (digitos.length === 13) return digitos;
  const novo = gerarCodigoInterno(id);
  db.prepare("UPDATE produtos SET codigo_barras = ?, atualizado_em = datetime('now','localtime') WHERE id = ?")
    .run(novo, id);
  return novo;
}

/** Prepara os dados de uma lista de produtos para impressao de etiquetas. */
function prepararEtiquetas(ids) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new AppError('Selecione ao menos um produto para gerar etiquetas.');
  }
  return ids.map((id) => {
    const codigo_barras = garantirCodigoBarras(id);
    const p = obter(id);
    return { id: p.id, nome: p.nome, preco_venda: p.preco_venda, codigo_barras };
  });
}

module.exports = {
  listar,
  obter,
  movimentacoes,
  criar,
  atualizar,
  ajustarEstoque,
  excluir,
  prepararEtiquetas,
};
