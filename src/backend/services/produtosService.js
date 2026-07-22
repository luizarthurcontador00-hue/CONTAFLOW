'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const { registrarMovimentacao } = require('./estoqueService');
const { precoPorMarkup, markupEfetivo, arred } = require('./precificacaoService');
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

  // Se nao informaram preco:
  //  - em importacoes (_semPrecoAuto), fica 0: o preco sera definido na
  //    Precificacao (regra: produto importado passa pela precificacao primeiro);
  //  - caso contrario, calcula pelo markup (produto/categoria/global).
  if (preco_venda == null) {
    if (dados._semPrecoAuto) {
      preco_venda = 0;
    } else {
      const markup = markupEfetivo({ markupProduto: dados.markup, categoriaId: dados.categoria_id });
      preco_venda = precoPorMarkup(custo, markup);
    }
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
    // Aceita boolean real (lote) ou string vinda de formulario ('1'/'on'/'0'/'false').
    eh_kit: (dados.eh_kit === true || dados.eh_kit === '1' || dados.eh_kit === 'on') ? 1 : 0,
    grupo_variacao: dados.grupo_variacao ? String(dados.grupo_variacao).trim() || null : null,
    variacao: dados.variacao ? String(dados.variacao).trim() || null : null,
  };
}

function criar(dados) {
  const db = getDb();
  const d = normalizar(dados);
  if (!d.nome) throw new AppError('O nome do produto e obrigatorio.');

  // Kits nao tem estoque proprio: e sempre controlado pelos componentes.
  const estoqueInicial = d.eh_kit ? 0 : Number(dados.estoque_atual || 0);

  const tx = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO produtos
          (nome, descricao, codigo_barras, categoria_id, fornecedor_id, unidade,
           custo, markup, preco_venda, estoque_atual, estoque_minimo, foto_path,
           eh_kit, grupo_variacao, variacao)
         VALUES
          (@nome, @descricao, @codigo_barras, @categoria_id, @fornecedor_id, @unidade,
           @custo, @markup, @preco_venda, 0, @estoque_minimo, @foto_path,
           @eh_kit, @grupo_variacao, @variacao)`
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
       eh_kit=@eh_kit, grupo_variacao=@grupo_variacao, variacao=@variacao,
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
 * Conferencia de estoque (inventario) em lote: recebe uma lista de itens
 * contados fisicamente e ajusta o saldo de cada produto para a quantidade
 * informada, gerando a movimentacao de entrada/saida correspondente a
 * diferenca. Somente itens com contagem informada sao processados; produtos
 * sem divergencia nao geram movimentacao. Tudo numa unica transacao.
 *
 * @param {Array<{id:number, contagem:number}>} itens
 * @param {string} [observacao] rotulo aplicado as movimentacoes
 * @returns {object} resumo { total, ajustados, sem_divergencia, erros, rotulo, resultados }
 */
function conferenciaEstoque(itens, observacao) {
  if (!Array.isArray(itens) || !itens.length) {
    throw new AppError('Nenhum item para conferir.');
  }
  const db = getDb();
  const rotulo = (observacao && observacao.trim())
    ? observacao.trim()
    : `Conferência de estoque ${dataHoraRotulo()}`;

  // 1) Valida e calcula tudo fora da transacao (apenas leituras).
  const plano = [];
  for (const item of itens) {
    const id = Number(item.id);
    const prod = db.prepare('SELECT id, nome, custo, estoque_atual, eh_kit FROM produtos WHERE id = ?').get(id);
    if (!prod) { plano.push({ id, sucesso: false, erro: 'Produto não encontrado.' }); continue; }
    if (prod.eh_kit) { plano.push({ id, nome: prod.nome, sucesso: false, erro: 'Kit não controla estoque próprio.' }); continue; }
    const contagem = Number(item.contagem);
    if (Number.isNaN(contagem) || contagem < 0) { plano.push({ id, nome: prod.nome, sucesso: false, erro: 'Contagem inválida.' }); continue; }
    const anterior = Number(prod.estoque_atual);
    const diferenca = Number((contagem - anterior).toFixed(3));
    plano.push({ id, nome: prod.nome, custo: prod.custo, sucesso: true, anterior, contagem, diferenca });
  }

  // 2) Aplica os ajustes numa unica transacao (so os itens com divergencia).
  const aplicar = plano.filter((r) => r.sucesso && r.diferenca !== 0);
  const tx = db.transaction(() => {
    for (const r of aplicar) {
      registrarMovimentacao(db, {
        produto_id: r.id,
        tipo: r.diferenca > 0 ? 'entrada' : 'saida',
        quantidade: Math.abs(r.diferenca),
        custo_unitario: r.custo,
        origem: 'ajuste',
        observacao: rotulo,
      });
    }
  });
  tx();

  return {
    total: plano.length,
    ajustados: aplicar.length,
    sem_divergencia: plano.filter((r) => r.sucesso && r.diferenca === 0).length,
    erros: plano.filter((r) => !r.sucesso).length,
    rotulo,
    resultados: plano,
  };
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

/**
 * Exclui varios produtos de uma vez. Reaproveita excluir() por item, entao
 * cada produto respeita a mesma regra (inativa se tem historico, senao
 * remove de fato); um erro num item nao impede os demais.
 */
function excluirLote(ids) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new AppError('Selecione ao menos um produto.');
  }
  const resultados = ids.map((id) => {
    try {
      const r = excluir(id);
      return { id, sucesso: true, inativado: !!r.inativado };
    } catch (e) {
      return { id, sucesso: false, erro: (e && e.message) || 'Erro desconhecido.' };
    }
  });
  return {
    total: resultados.length,
    excluidos: resultados.filter((r) => r.sucesso && !r.inativado).length,
    inativados: resultados.filter((r) => r.sucesso && r.inativado).length,
    erros: resultados.filter((r) => !r.sucesso).length,
    resultados,
  };
}

/**
 * Atualiza um ou mais campos em varios produtos de uma vez. Somente os
 * campos presentes em `campos` sao alterados; os demais permanecem intactos.
 * Campos aceitos: categoria_id, fornecedor_id, unidade, estoque_minimo, ativo.
 */
function editarLote(ids, campos) {
  if (!Array.isArray(ids) || !ids.length) {
    throw new AppError('Selecione ao menos um produto.');
  }
  const db = getDb();
  const sets = [];
  const params = {};

  if (campos.categoria_id !== undefined) { sets.push('categoria_id=@categoria_id'); params.categoria_id = campos.categoria_id || null; }
  if (campos.fornecedor_id !== undefined) { sets.push('fornecedor_id=@fornecedor_id'); params.fornecedor_id = campos.fornecedor_id || null; }
  if (campos.unidade !== undefined && String(campos.unidade).trim() !== '') {
    sets.push('unidade=@unidade'); params.unidade = String(campos.unidade).trim().toUpperCase();
  }
  if (campos.estoque_minimo !== undefined && campos.estoque_minimo !== '') {
    sets.push('estoque_minimo=@estoque_minimo'); params.estoque_minimo = Number(campos.estoque_minimo);
  }
  if (campos.ativo !== undefined) { sets.push('ativo=@ativo'); params.ativo = campos.ativo ? 1 : 0; }

  if (!sets.length) throw new AppError('Selecione ao menos um campo para alterar.');

  const sql = `UPDATE produtos SET ${sets.join(', ')}, atualizado_em=datetime('now','localtime') WHERE id=@id`;
  const resultados = ids.map((id) => {
    try {
      obter(id); // garante existencia (lanca 404 amigavel se nao existir)
      db.prepare(sql).run({ ...params, id });
      return { id, sucesso: true };
    } catch (e) {
      return { id, sucesso: false, erro: (e && e.message) || 'Erro desconhecido.' };
    }
  });
  return {
    total: resultados.length,
    atualizados: resultados.filter((r) => r.sucesso).length,
    erros: resultados.filter((r) => !r.sucesso).length,
    resultados,
  };
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

// ----------------------------- Kits / composicao -----------------------------

/** Lista os itens que compoem um kit. */
function obterComposicao(kitId) {
  const db = getDb();
  obter(kitId); // garante existencia
  return db.prepare(`
    SELECT pc.id, pc.produto_componente_id, pc.quantidade,
           p.nome, p.custo, p.unidade
    FROM produtos_composicao pc
    JOIN produtos p ON p.id = pc.produto_componente_id
    WHERE pc.produto_kit_id = ?
    ORDER BY p.nome COLLATE NOCASE
  `).all(kitId);
}

/**
 * Substitui a lista de componentes de um kit e recalcula o custo do kit como
 * a soma (custo do componente x quantidade), mantendo o custo sempre coerente.
 */
function salvarComposicao(kitId, itens) {
  const db = getDb();
  obter(kitId);
  const lista = Array.isArray(itens) ? itens : [];
  if (!lista.length) throw new AppError('Adicione ao menos um produto para compor o kit.');

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM produtos_composicao WHERE produto_kit_id = ?').run(kitId);
    const ins = db.prepare(
      'INSERT INTO produtos_composicao (produto_kit_id, produto_componente_id, quantidade) VALUES (?, ?, ?)'
    );
    let custoTotal = 0;
    for (const item of lista) {
      const componenteId = Number(item.produto_componente_id);
      if (componenteId === Number(kitId)) {
        throw new AppError('Um kit nao pode conter a si mesmo como componente.');
      }
      const qtd = Number(item.quantidade);
      if (!(qtd > 0)) throw new AppError('A quantidade de cada item do kit deve ser maior que zero.');
      const componente = db.prepare('SELECT custo FROM produtos WHERE id = ?').get(componenteId);
      if (!componente) throw new AppError('Um dos produtos selecionados para o kit nao foi encontrado.');
      ins.run(kitId, componenteId, qtd);
      custoTotal += Number(componente.custo) * qtd;
    }
    db.prepare("UPDATE produtos SET eh_kit = 1, custo = ?, atualizado_em = datetime('now','localtime') WHERE id = ?")
      .run(arred(custoTotal), kitId);
  });
  tx();
  return obterComposicao(kitId);
}

// ----------------------------- Cadastro em lote -----------------------------

function acharOuCriarCategoria(db, nome) {
  const limpo = (nome || '').toString().trim();
  if (!limpo) return null;
  const existente = db.prepare('SELECT id FROM categorias WHERE nome = ? COLLATE NOCASE').get(limpo);
  if (existente) return existente.id;
  return db.prepare('INSERT INTO categorias (nome) VALUES (?)').run(limpo).lastInsertRowid;
}

function acharOuCriarFornecedor(db, nome) {
  const limpo = (nome || '').toString().trim();
  if (!limpo) return null;
  const existente = db.prepare('SELECT id FROM fornecedores WHERE nome = ? COLLATE NOCASE').get(limpo);
  if (existente) return existente.id;
  return db.prepare('INSERT INTO fornecedores (nome) VALUES (?)').run(limpo).lastInsertRowid;
}

/**
 * Cadastra varios produtos de uma vez (grade de cadastro em lote ou
 * importacao de planilha). Cada linha e processada de forma independente:
 * um erro numa linha nao impede as demais de serem salvas. Categoria e
 * fornecedor podem vir por nome (texto): sao localizados ou criados na hora.
 */
function criarLote(linhas) {
  if (!Array.isArray(linhas) || !linhas.length) {
    throw new AppError('Nenhum produto para cadastrar.');
  }
  const db = getDb();
  const resultados = linhas.map((linha, idx) => {
    try {
      if (!linha.nome || !String(linha.nome).trim()) {
        throw new AppError('Informe o nome do produto.');
      }
      // Importacao: se o usuario nao digitou um preco na grade, o produto fica
      // sem preco (0) e sera precificado na aba Precificacao.
      const dados = { ...linha, _semPrecoAuto: true };
      if (linha.categoria) dados.categoria_id = acharOuCriarCategoria(db, linha.categoria);
      if (linha.fornecedor) dados.fornecedor_id = acharOuCriarFornecedor(db, linha.fornecedor);
      const produto = criar(dados);
      return { linha: idx + 1, sucesso: true, produto };
    } catch (e) {
      return { linha: idx + 1, sucesso: false, nome: linha.nome || null, erro: (e && e.message) || 'Erro desconhecido.' };
    }
  });
  // Envia os produtos criados para a planilha de Precificacao, agrupados por
  // um lote com data/hora, para o usuario definir os precos por markup divisor.
  const criados = resultados.filter((r) => r.sucesso).map((r) => ({
    produto_id: r.produto.id,
    referencia: r.produto.codigo_barras,
    descricao: r.produto.nome,
    quantidade: 1,
    valor_pedido: Number(r.produto.custo || 0),
  }));
  let lotePrecificacao = null;
  if (criados.length) {
    // eslint-disable-next-line global-require
    const prec = require('./precAvancadaService');
    const rotulo = `Cadastro em lote ${dataHoraRotulo()}`;
    prec.importarProdutos(criados, rotulo);
    lotePrecificacao = rotulo;
  }

  return {
    total: resultados.length,
    criados: resultados.filter((r) => r.sucesso).length,
    erros: resultados.filter((r) => !r.sucesso).length,
    resultados,
    lote_precificacao: lotePrecificacao,
  };
}

/** Rotulo de lote no formato "DD/MM/AAAA HH:MM". */
function dataHoraRotulo() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

module.exports = {
  listar,
  obter,
  movimentacoes,
  criar,
  atualizar,
  ajustarEstoque,
  conferenciaEstoque,
  excluir,
  prepararEtiquetas,
  obterComposicao,
  salvarComposicao,
  criarLote,
  excluirLote,
  editarLote,
};
