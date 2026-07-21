'use strict';

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { registrarMovimentacao } = require('./estoqueService');
const { precoPorMarkup, markupEfetivo } = require('./precificacaoService');

/**
 * Tenta localizar um produto existente que corresponda ao item da NF:
 * primeiro pelo EAN (codigo de barras), depois por codigo de barras igual ao
 * codigo do fornecedor.
 */
function acharProdutoExistente(db, item) {
  if (item.ean) {
    const p = db.prepare('SELECT id, nome, custo, preco_venda, estoque_atual, unidade FROM produtos WHERE codigo_barras = ?').get(item.ean);
    if (p) return p;
  }
  if (item.codigo_fornec) {
    const p = db.prepare('SELECT id, nome, custo, preco_venda, estoque_atual, unidade FROM produtos WHERE codigo_barras = ?').get(item.codigo_fornec);
    if (p) return p;
  }
  return null;
}

/**
 * Monta o preview da importacao (NAO persiste nada). Recebe o objeto ja
 * parseado da NF-e e o nome do arquivo XML salvo.
 */
function montarPreview(nfe, xml_path) {
  const db = getDb();

  if (nfe.chave) {
    const jaImportada = db.prepare('SELECT id FROM compras WHERE chave_nfe = ?').get(nfe.chave);
    if (jaImportada) {
      throw new AppError('Esta NF-e ja foi importada anteriormente.', 409);
    }
  }

  const itens = nfe.itens.map((it) => {
    const existente = acharProdutoExistente(db, it);
    return {
      ...it,
      produto_existente: existente
        ? { id: existente.id, nome: existente.nome, custo: existente.custo, estoque_atual: existente.estoque_atual }
        : null,
    };
  });

  const fornecedorExistente = nfe.fornecedor.cnpj
    ? db.prepare('SELECT id, nome FROM fornecedores WHERE cnpj = ?').get(nfe.fornecedor.cnpj)
    : null;

  return {
    xml_path,
    chave: nfe.chave,
    numero_nf: nfe.numero_nf,
    data_emissao: nfe.data_emissao,
    valor_total: nfe.valor_total,
    fornecedor: nfe.fornecedor,
    fornecedor_existente: fornecedorExistente || null,
    itens,
  };
}

function resolverFornecedor(db, fornecedor) {
  if (fornecedor && fornecedor.id) return fornecedor.id;
  if (fornecedor && fornecedor.cnpj) {
    const existe = db.prepare('SELECT id FROM fornecedores WHERE cnpj = ?').get(fornecedor.cnpj);
    if (existe) return existe.id;
  }
  if (!fornecedor || !fornecedor.nome) return null;
  const info = db.prepare(
    'INSERT INTO fornecedores (nome, cnpj, telefone, email) VALUES (?, ?, ?, ?)'
  ).run(fornecedor.nome, fornecedor.cnpj || null, fornecedor.telefone || null, fornecedor.email || null);
  return info.lastInsertRowid;
}

/**
 * Confirma a importacao: cria/atualiza produtos, registra a compra, os itens,
 * as movimentacoes de estoque de entrada e, opcionalmente, a conta a pagar.
 *
 * dados = {
 *   xml_path, chave, numero_nf, data_emissao, valor_total,
 *   fornecedor: { id? , nome, cnpj, ... },
 *   itens: [{
 *     descricao, ncm, ean, codigo_fornec, unidade, quantidade, valor_unitario, valor_total,
 *     produto_id?,             // quando vincula a produto existente
 *     novo?: { nome, categoria_id?, preco_venda?, markup?, estoque_minimo? }  // quando cria novo
 *   }],
 *   gerar_conta_pagar?: bool, vencimento?: 'YYYY-MM-DD'
 * }
 */
function confirmarImportacao(dados) {
  const db = getDb();

  if (!dados || !Array.isArray(dados.itens) || !dados.itens.length) {
    throw new AppError('Nenhum item para importar.');
  }
  if (dados.chave) {
    const ja = db.prepare('SELECT id FROM compras WHERE chave_nfe = ?').get(dados.chave);
    if (ja) throw new AppError('Esta NF-e ja foi importada anteriormente.', 409);
  }

  const itensPrec = []; // coletados p/ enviar a planilha de Precificacao

  const tx = db.transaction(() => {
    const fornecedor_id = resolverFornecedor(db, dados.fornecedor || {});

    const compraInfo = db.prepare(
      `INSERT INTO compras (fornecedor_id, numero_nf, chave_nfe, xml_path, data_emissao, valor_total, status)
       VALUES (?, ?, ?, ?, ?, ?, 'importada')`
    ).run(
      fornecedor_id,
      dados.numero_nf || null,
      dados.chave || null,
      dados.xml_path || null,
      dados.data_emissao || null,
      Number(dados.valor_total || 0)
    );
    const compra_id = compraInfo.lastInsertRowid;

    const insItem = db.prepare(
      `INSERT INTO compras_itens
        (compra_id, produto_id, codigo_fornec, descricao_nf, ncm, ean, quantidade, valor_unitario, valor_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    for (const item of dados.itens) {
      let produto_id = item.produto_id || null;

      if (!produto_id) {
        // Criar novo produto a partir do item (exige dados minimos do usuario).
        const novo = item.novo || {};
        const nome = (novo.nome || item.descricao || '').trim();
        if (!nome) throw new AppError('Informe o nome de todos os produtos novos antes de importar.');

        const custo = Number(item.valor_unitario || 0);
        let preco = novo.preco_venda != null && novo.preco_venda !== '' ? Number(novo.preco_venda) : null;
        if (preco == null) {
          const mk = markupEfetivo({ markupProduto: novo.markup, categoriaId: novo.categoria_id });
          preco = precoPorMarkup(custo, mk);
        }

        const pInfo = db.prepare(
          `INSERT INTO produtos
            (nome, codigo_barras, categoria_id, fornecedor_id, unidade, custo, markup, preco_venda, estoque_atual, estoque_minimo)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
        ).run(
          nome,
          item.ean || null,
          novo.categoria_id || null,
          fornecedor_id,
          item.unidade || 'UN',
          custo,
          novo.markup != null && novo.markup !== '' ? Number(novo.markup) : null,
          preco,
          Number(novo.estoque_minimo || 0)
        );
        produto_id = pInfo.lastInsertRowid;
      } else {
        // Produto existente: atualiza o custo com o valor da NF.
        db.prepare("UPDATE produtos SET custo = ?, atualizado_em = datetime('now','localtime') WHERE id = ?")
          .run(Number(item.valor_unitario || 0), produto_id);
      }

      // Entrada de estoque vinculada a compra.
      registrarMovimentacao(db, {
        produto_id,
        tipo: 'entrada',
        quantidade: Number(item.quantidade || 0),
        custo_unitario: Number(item.valor_unitario || 0),
        origem: 'compra',
        referencia_id: compra_id,
        observacao: `NF ${dados.numero_nf || ''}`.trim(),
      });

      insItem.run(
        compra_id,
        produto_id,
        item.codigo_fornec || null,
        item.descricao || null,
        item.ncm || null,
        item.ean || null,
        Number(item.quantidade || 0),
        Number(item.valor_unitario || 0),
        Number(item.valor_total || 0)
      );

      itensPrec.push({
        produto_id,
        referencia: item.ean || item.codigo_fornec || null,
        descricao: (item.novo && item.novo.nome) || item.descricao || 'Produto',
        quantidade: Number(item.quantidade || 0) || 1,
        valor_pedido: Number(item.valor_total || 0),
      });
    }

    // Conta a pagar (opcional).
    if (dados.gerar_conta_pagar) {
      db.prepare(
        `INSERT INTO contas_pagar (fornecedor_id, compra_id, descricao, valor, vencimento, status)
         VALUES (?, ?, ?, ?, ?, 'pendente')`
      ).run(
        fornecedor_id,
        compra_id,
        `NF ${dados.numero_nf || ''}`.trim() || 'Compra',
        Number(dados.valor_total || 0),
        dados.vencimento || null
      );
    }

    return compra_id;
  });

  const compra_id = tx();

  // Envia os itens da nota para a planilha de Precificacao (lote com data).
  let lotePrecificacao = null;
  if (itensPrec.length) {
    // eslint-disable-next-line global-require
    const prec = require('./precAvancadaService');
    const d = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    lotePrecificacao = `NF ${dados.numero_nf || 's/n'} — ${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`;
    prec.importarProdutos(itensPrec, lotePrecificacao);
  }

  const compra = obterCompra(compra_id);
  compra.lote_precificacao = lotePrecificacao;
  return compra;
}

function listarCompras() {
  const db = getDb();
  return db.prepare(`
    SELECT c.*, f.nome AS fornecedor_nome,
           (SELECT COUNT(*) FROM compras_itens ci WHERE ci.compra_id = c.id) AS total_itens
    FROM compras c
    LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
    ORDER BY c.id DESC
  `).all();
}

function obterCompra(id) {
  const db = getDb();
  const compra = db.prepare(`
    SELECT c.*, f.nome AS fornecedor_nome, f.cnpj AS fornecedor_cnpj
    FROM compras c LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
    WHERE c.id = ?
  `).get(id);
  if (!compra) throw new AppError('Compra nao encontrada.', 404);
  compra.itens = db.prepare(`
    SELECT ci.*, p.nome AS produto_nome
    FROM compras_itens ci LEFT JOIN produtos p ON p.id = ci.produto_id
    WHERE ci.compra_id = ? ORDER BY ci.id
  `).all(id);
  return compra;
}

module.exports = {
  montarPreview,
  confirmarImportacao,
  listarCompras,
  obterCompra,
};
