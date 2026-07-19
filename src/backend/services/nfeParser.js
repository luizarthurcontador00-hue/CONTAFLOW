'use strict';

const { XMLParser } = require('fast-xml-parser');
const { AppError } = require('../utils/errors');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // manter numeros como string p/ preservar precisao
  trimValues: true,
});

function limparGTIN(valor) {
  if (!valor) return null;
  const v = String(valor).trim().toUpperCase();
  if (!v || v === 'SEM GTIN' || v === 'SEMGTIN') return null;
  return v;
}

function num(v) {
  if (v == null || v === '') return 0;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

function soDigitos(v) {
  return v ? String(v).replace(/\D/g, '') : null;
}

/**
 * Recebe o conteudo (string) de um XML de NF-e e retorna um objeto normalizado:
 * { chave, numero_nf, data_emissao, fornecedor:{nome,cnpj,...}, valor_total, itens:[...] }
 * Lanca AppError com mensagem clara quando o XML nao e uma NF-e valida.
 */
function parseNFe(xmlString) {
  if (!xmlString || !String(xmlString).trim()) {
    throw new AppError('O arquivo XML esta vazio.');
  }

  let doc;
  try {
    doc = parser.parse(xmlString);
  } catch (e) {
    throw new AppError('O arquivo nao e um XML valido.');
  }

  // A NFe pode estar em nfeProc>NFe, ou direto em NFe.
  const nfe = (doc.nfeProc && doc.nfeProc.NFe) || doc.NFe;
  const infNFe = nfe && nfe.infNFe;
  if (!infNFe) {
    throw new AppError('Este XML nao parece ser uma NF-e (elemento infNFe nao encontrado).');
  }

  // Chave de acesso (Id = "NFe" + 44 digitos)
  const idAttr = infNFe['@_Id'] || '';
  const chave = soDigitos(idAttr);

  const ide = infNFe.ide || {};
  const emit = infNFe.emit || {};
  const total = (infNFe.total && infNFe.total.ICMSTot) || {};

  const fornecedor = {
    nome: emit.xNome || emit.xFant || 'Fornecedor sem nome',
    cnpj: soDigitos(emit.CNPJ || emit.CPF),
    telefone: soDigitos((emit.enderEmit && emit.enderEmit.fone) || null),
    email: null,
  };

  // det pode ser objeto (1 item) ou array (varios).
  let dets = infNFe.det || [];
  if (!Array.isArray(dets)) dets = [dets];

  const itens = dets.map((det) => {
    const prod = det.prod || {};
    const ean = limparGTIN(prod.cEAN) || limparGTIN(prod.cEANTrib);
    return {
      numero_item: num(det['@_nItem']),
      codigo_fornec: prod.cProd != null ? String(prod.cProd) : null,
      ean,
      descricao: prod.xProd || '',
      ncm: prod.NCM ? String(prod.NCM) : null,
      unidade: prod.uCom ? String(prod.uCom).toUpperCase() : 'UN',
      quantidade: num(prod.qCom),
      valor_unitario: num(prod.vUnCom),
      valor_total: num(prod.vProd),
    };
  });

  if (!itens.length) {
    throw new AppError('A NF-e nao possui itens.');
  }

  return {
    chave,
    numero_nf: ide.nNF ? String(ide.nNF) : null,
    data_emissao: ide.dhEmi || ide.dEmi || null,
    valor_total: num(total.vNF) || itens.reduce((s, i) => s + i.valor_total, 0),
    fornecedor,
    itens,
  };
}

module.exports = { parseNFe };
