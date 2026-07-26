'use strict';

/**
 * Modulo fiscal: emissao de NFC-e/NF-e via um gateway externo (hoje, Focus
 * NFe). O sistema NAO guarda certificado digital nem fala direto com a
 * SEFAZ — isso fica a cargo do gateway, que e quem concentra essa
 * complexidade. Aqui a gente so guarda a configuracao (CNPJ, regime,
 * inscricoes, token do gateway) e monta/envia a requisicao de emissao.
 *
 * IMPORTANTE: o formato exato do payload (nomes de campo) deve ser
 * conferido com a documentacao atual do gateway antes do primeiro uso real
 * — APIs de terceiros mudam com o tempo e isso nao foi testado contra uma
 * conta real (o lojista ainda nao tinha certificado/token no momento em que
 * este modulo foi escrito). O restante do fluxo (config, persistencia,
 * tratamento de erro, UI) esta pronto e nao depende de ajustes.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

const CHAVES_FISCAIS = [
  'loja_cnpj', 'fiscal_regime_tributario', 'fiscal_inscricao_estadual',
  'fiscal_inscricao_municipal', 'fiscal_gateway', 'fiscal_ambiente', 'fiscal_token',
];

function obterConfig() {
  const db = getDb();
  const linhas = db.prepare(
    `SELECT chave, valor FROM config WHERE chave IN (${CHAVES_FISCAIS.map(() => '?').join(',')})`
  ).all(...CHAVES_FISCAIS);
  const cfg = {};
  linhas.forEach((l) => { cfg[l.chave] = l.valor; });
  return {
    cnpj: cfg.loja_cnpj || '',
    regime_tributario: cfg.fiscal_regime_tributario || '',
    inscricao_estadual: cfg.fiscal_inscricao_estadual || '',
    inscricao_municipal: cfg.fiscal_inscricao_municipal || '',
    gateway: cfg.fiscal_gateway || 'focusnfe',
    ambiente: cfg.fiscal_ambiente || 'homologacao',
    token: cfg.fiscal_token || '',
  };
}

function estaConfigurado() {
  const cfg = obterConfig();
  return !!(cfg.cnpj && cfg.token);
}

const BASE_URL_FOCUSNFE = {
  homologacao: 'https://homologacao.focusnfe.com.br',
  producao: 'https://api.focusnfe.com.br',
};

/**
 * Monta o payload de emissao de NFC-e no formato esperado pela API da Focus
 * NFe (v2). Funcao pura (nao acessa rede/banco) para poder ser testada
 * isoladamente. Confira contra https://focusnfe.com.br/doc/ antes do
 * primeiro envio real — os nomes de campo abaixo seguem a convencao
 * documentada da Focus NFe, mas nao foram validados contra uma conta ativa.
 */
function montarPayloadNFCe(venda, itensComProduto, config) {
  const itemsPayload = itensComProduto.map((item, i) => ({
    numero_item: String(i + 1),
    codigo_produto: String(item.produto_id || item.descricao || i + 1),
    descricao: item.descricao || item.nome,
    cfop: item.cfop,
    codigo_ncm: item.ncm,
    unidade_comercial: item.unidade || 'UN',
    quantidade_comercial: Number(item.quantidade).toFixed(4),
    valor_unitario_comercial: Number(item.preco_unitario).toFixed(2),
    valor_bruto: Number(item.valor_total).toFixed(2),
    unidade_tributavel: item.unidade || 'UN',
    quantidade_tributavel: Number(item.quantidade).toFixed(4),
    valor_unitario_tributacao: Number(item.preco_unitario).toFixed(2),
    icms_origem: String(item.origem_mercadoria ?? 0),
    icms_situacao_tributaria: item.cst_csosn,
  }));

  const formasPagamento = (venda.pagamentos || []).map((p) => ({
    forma_pagamento: mapaFormaPagamentoFocusNFe(p.forma_pagamento),
    valor_pagamento: Number(p.valor).toFixed(2),
  }));

  return {
    natureza_operacao: 'Venda ao consumidor',
    data_emissao: new Date().toISOString(),
    presenca_comprador: '1', // operacao presencial
    cnpj_emitente: (config.cnpj || '').replace(/\D/g, ''),
    valor_produtos: Number(venda.valor_bruto).toFixed(2),
    valor_desconto: Number(venda.desconto || 0).toFixed(2),
    valor_total: Number(venda.valor_total).toFixed(2),
    items: itemsPayload,
    formas_pagamento: formasPagamento,
  };
}

// Tabela de formas de pagamento do SEFAZ (usada por NFC-e). Ajuste conforme
// necessario para as formas de pagamento existentes no PDV.
function mapaFormaPagamentoFocusNFe(forma) {
  const mapa = {
    dinheiro: '01', cartao_credito: '03', cartao_debito: '04',
    pix: '17', prazo: '99', boleto: '15', transferencia: '99',
  };
  return mapa[forma] || '99';
}

/**
 * Valida que todos os itens da venda tem os dados fiscais minimos
 * preenchidos (NCM, CFOP, CST/CSOSN) antes de tentar emitir.
 */
function validarItensFiscais(itensComProduto) {
  const faltando = itensComProduto.filter((i) => !i.ncm || !i.cfop || !i.cst_csosn);
  if (faltando.length) {
    const nomes = faltando.map((i) => i.descricao || i.nome).join(', ');
    throw new AppError(
      `Os seguintes itens estao sem dados fiscais (NCM/CFOP/CST-CSOSN) cadastrados: ${nomes}. ` +
      'Preencha em Produtos > editar > "Dados fiscais" antes de emitir a nota.'
    );
  }
}

/**
 * Emite a NFC-e de uma venda ja concluida. Guarda o resultado (mesmo em
 * caso de erro) em notas_fiscais, para historico e nova tentativa.
 */
async function emitirNFCe(vendaId) {
  const db = getDb();
  const venda = db.prepare('SELECT * FROM vendas WHERE id = ?').get(vendaId);
  if (!venda) throw new AppError('Venda nao encontrada.', 404);
  if (venda.status !== 'concluida') throw new AppError('Somente vendas concluidas podem ter nota fiscal emitida.');

  const jaTem = db.prepare("SELECT * FROM notas_fiscais WHERE venda_id = ? AND status IN ('processando','autorizada') ORDER BY id DESC LIMIT 1").get(vendaId);
  if (jaTem) throw new AppError('Esta venda ja tem uma nota fiscal emitida ou em processamento.');

  const config = obterConfig();
  if (!estaConfigurado()) {
    throw new AppError('Módulo fiscal não configurado. Configure o CNPJ e o token do gateway em Configurações → Módulo Fiscal.');
  }

  const itens = db.prepare(`
    SELECT vi.*, p.nome, p.unidade, p.ncm, p.cfop, p.cst_csosn, p.origem_mercadoria
    FROM vendas_itens vi LEFT JOIN produtos p ON p.id = vi.produto_id
    WHERE vi.venda_id = ?
  `).all(vendaId);
  const pagamentos = db.prepare('SELECT * FROM vendas_pagamentos WHERE venda_id = ?').all(vendaId);

  validarItensFiscais(itens);

  const payload = montarPayloadNFCe({ ...venda, pagamentos }, itens, config);
  const referencia = `venda-${vendaId}-${Date.now()}`;

  const info = db.prepare(
    `INSERT INTO notas_fiscais (venda_id, tipo, ambiente, referencia, status)
     VALUES (?, 'nfce', ?, ?, 'processando')`
  ).run(vendaId, config.ambiente, referencia);
  const notaId = info.lastInsertRowid;

  try {
    const resposta = await chamarGatewayFocusNFe(referencia, payload, config);
    atualizarNota(notaId, {
      status: mapearStatusResposta(resposta.status),
      numero: resposta.numero || null,
      serie: resposta.serie || null,
      chave_acesso: resposta.chave_nfe || resposta.chave_acesso || null,
      protocolo: resposta.protocolo || null,
      danfe_url: resposta.caminho_danfe || resposta.url_danfe || null,
      xml_url: resposta.caminho_xml_nota_fiscal || resposta.url_xml || null,
      mensagem_erro: resposta.mensagem_sefaz || resposta.erros ? JSON.stringify(resposta.erros || resposta.mensagem_sefaz) : null,
    });
  } catch (e) {
    atualizarNota(notaId, { status: 'erro', mensagem_erro: e.message });
    throw new AppError(`Falha ao emitir nota fiscal: ${e.message}`);
  }

  return db.prepare('SELECT * FROM notas_fiscais WHERE id = ?').get(notaId);
}

function mapearStatusResposta(status) {
  if (status === 'autorizado') return 'autorizada';
  if (status === 'erro_autorizacao' || status === 'cancelado' || status === 'denegado') return 'erro';
  return 'processando';
}

function atualizarNota(id, campos) {
  const db = getDb();
  const sets = Object.keys(campos).map((k) => `${k}=@${k}`).join(', ');
  db.prepare(`UPDATE notas_fiscais SET ${sets}, atualizado_em=datetime('now','localtime') WHERE id=@id`)
    .run({ ...campos, id });
}

/**
 * Chamada HTTP real ao gateway. Usa fetch nativo do Node. O token do
 * gateway vai como usuario no Basic Auth (padrao Focus NFe), sem senha.
 */
async function chamarGatewayFocusNFe(referencia, payload, config) {
  const base = BASE_URL_FOCUSNFE[config.ambiente] || BASE_URL_FOCUSNFE.homologacao;
  const url = `${base}/v2/nfce?ref=${encodeURIComponent(referencia)}`;
  const auth = Buffer.from(`${config.token}:`).toString('base64');

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${auth}` },
    body: JSON.stringify(payload),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok && resp.status !== 202) {
    const msg = dados.mensagem || dados.erros ? JSON.stringify(dados.erros || dados.mensagem) : `HTTP ${resp.status}`;
    throw new Error(msg);
  }
  return dados;
}

function listarPorVenda(vendaId) {
  return getDb().prepare('SELECT * FROM notas_fiscais WHERE venda_id = ? ORDER BY id DESC').all(vendaId);
}

/** Consulta o status atual de uma nota (util quando ficou "processando"). */
async function consultarStatus(notaId) {
  const db = getDb();
  const nota = db.prepare('SELECT * FROM notas_fiscais WHERE id = ?').get(notaId);
  if (!nota) throw new AppError('Nota fiscal nao encontrada.', 404);
  const config = obterConfig();
  if (!estaConfigurado()) throw new AppError('Módulo fiscal não configurado.');

  const base = BASE_URL_FOCUSNFE[config.ambiente] || BASE_URL_FOCUSNFE.homologacao;
  const auth = Buffer.from(`${config.token}:`).toString('base64');
  const resp = await fetch(`${base}/v2/nfce/${encodeURIComponent(nota.referencia)}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const dados = await resp.json().catch(() => ({}));
  atualizarNota(notaId, {
    status: mapearStatusResposta(dados.status),
    numero: dados.numero || nota.numero,
    chave_acesso: dados.chave_nfe || nota.chave_acesso,
    danfe_url: dados.caminho_danfe || nota.danfe_url,
    xml_url: dados.caminho_xml_nota_fiscal || nota.xml_url,
    mensagem_erro: dados.mensagem_sefaz || null,
  });
  return db.prepare('SELECT * FROM notas_fiscais WHERE id = ?').get(notaId);
}

module.exports = {
  obterConfig, estaConfigurado, montarPayloadNFCe, validarItensFiscais,
  emitirNFCe, listarPorVenda, consultarStatus,
};
