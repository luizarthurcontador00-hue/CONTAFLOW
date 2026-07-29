'use strict';

/**
 * Parser de extrato bancario no formato OFX. A maioria dos bancos
 * brasileiros ainda exporta OFX 1.x, que e SGML (tags "folha" nao sao
 * fechadas, ex.: <TRNAMT>150.00 sem </TRNAMT>) e nao um XML valido. Este
 * modulo normaliza o SGML para XML bem formado e reaproveita o
 * fast-xml-parser (ja usado para XML de NF-e) para extrair as transacoes.
 */

const { XMLParser } = require('fast-xml-parser');
const { AppError } = require('../utils/errors');

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true });

/** Decide o encoding pelo cabecalho OFX (a maioria dos bancos BR usa Latin-1/1252). */
function bufferParaTexto(buffer) {
  const previa = buffer.slice(0, 400).toString('ascii');
  const ehUtf8 = /CHARSET:\s*UTF-?8/i.test(previa) || /ENCODING:\s*UTF-?8/i.test(previa);
  return buffer.toString(ehUtf8 ? 'utf8' : 'latin1');
}

function escaparEntidades(v) {
  return String(v).replace(/&(?!(amp|lt|gt|quot|apos);)/g, '&amp;');
}

/** Converte o corpo OFX (SGML ou XML) em XML bem formado, linha a linha. */
function sgmlParaXml(texto) {
  const inicio = texto.indexOf('<OFX>');
  const corpo = inicio >= 0 ? texto.slice(inicio) : texto;
  const linhas = corpo.split(/\r?\n/);
  const saida = [];
  for (const linhaOriginal of linhas) {
    const linha = linhaOriginal.trim();
    if (!linha) continue;
    if (/^<\/?[A-Za-z0-9._]+>$/.test(linha)) { saida.push(linha); continue; } // tag pura (container)
    const fechada = linha.match(/^<([A-Za-z0-9._]+)>.*<\/\1>$/);
    if (fechada) { saida.push(linha); continue; } // ja fechada na propria linha
    const folha = linha.match(/^<([A-Za-z0-9._]+)>(.*)$/);
    if (folha) { saida.push(`<${folha[1]}>${escaparEntidades(folha[2])}</${folha[1]}>`); continue; }
    // Linha que nao parece uma tag (ex.: cabecalho SGML remanescente) - ignora.
  }
  return saida.join('\n');
}

function parseDataOfx(v) {
  const s = String(v || '').trim();
  if (s.length < 8) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function parseValorOfx(v) {
  const n = Number(String(v == null ? '0' : v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/** Acha a lista de STMTTRN tanto em extrato de conta corrente quanto de cartao de credito. */
function encontrarTransacoesBrutas(doc) {
  const ofx = doc && doc.OFX;
  if (!ofx) throw new AppError('Arquivo OFX inválido: tag <OFX> não encontrada.');
  const containers = [
    ofx.BANKMSGSRSV1 && ofx.BANKMSGSRSV1.STMTTRNRS && ofx.BANKMSGSRSV1.STMTTRNRS.STMTRS,
    ofx.CREDITCARDMSGSRSV1 && ofx.CREDITCARDMSGSRSV1.CCSTMTTRNRS && ofx.CREDITCARDMSGSRSV1.CCSTMTRS,
  ].filter(Boolean);
  for (const c of containers) {
    const lista = c.BANKTRANLIST && c.BANKTRANLIST.STMTTRN;
    if (lista) return Array.isArray(lista) ? lista : [lista];
  }
  return [];
}

/**
 * Recebe o Buffer do arquivo .ofx e retorna a lista de transacoes:
 * [{ fitid, data, valor, tipo: 'credito'|'debito', descricao }]
 */
function parseOFX(buffer) {
  const texto = bufferParaTexto(buffer);
  if (!texto || !texto.trim()) throw new AppError('O arquivo OFX está vazio.');
  const xml = sgmlParaXml(texto);
  let doc;
  try {
    doc = parser.parse(xml);
  } catch (e) {
    throw new AppError('Não foi possível ler este arquivo OFX.');
  }
  const brutas = encontrarTransacoesBrutas(doc);
  if (!brutas.length) throw new AppError('Nenhuma transação encontrada neste arquivo OFX.');

  return brutas.map((t, idx) => {
    const valorBruto = parseValorOfx(t.TRNAMT);
    const descricao = String(t.MEMO || t.NAME || (t.PAYEE && t.PAYEE.NAME) || '').trim() || 'Sem descrição';
    const data = parseDataOfx(t.DTPOSTED);
    const fitid = t.FITID ? String(t.FITID).trim() : `${data}|${valorBruto}|${idx}`;
    return {
      fitid,
      data,
      valor: Math.abs(valorBruto),
      tipo: valorBruto < 0 ? 'debito' : 'credito',
      descricao,
    };
  }).filter((t) => t.data);
}

module.exports = { parseOFX };
