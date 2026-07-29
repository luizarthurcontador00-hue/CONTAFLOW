'use strict';

/**
 * Gera o payload PIX "Copia e Cola" (BR Code, padrao EMV do Banco Central)
 * e o QR Code correspondente. Nao depende de banco/PSP: e um QR estatico
 * com valor fixo, montado a partir da chave PIX cadastrada em Configuracoes.
 */

const QRCode = require('qrcode');
const { AppError } = require('../utils/errors');

/** Remove acentos/caracteres fora do ASCII imprimivel e limita o tamanho (exigencia do padrao EMV). */
function sanitizar(s, max) {
  const semAcento = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return semAcento.replace(/[^\x20-\x7E]/g, '').slice(0, max).trim();
}

/** Campo TLV (Tag-Length-Value) do padrao EMV: ID (2 digitos) + tamanho (2 digitos) + valor. */
function campo(id, valor) {
  const v = String(valor);
  return `${id}${String(v.length).padStart(2, '0')}${v}`;
}

/** CRC16-CCITT (poly 0x1021, inicial 0xFFFF) exigido no campo final (63) do BR Code. */
function crc16(payload) {
  let crc = 0xFFFF;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Monta o payload PIX. dados = { chave, nome, cidade, valor?, descricao?, txid? }
 * Sem valor, o pagador digita o valor no app do banco; com valor, ja vem
 * preenchido (mas ainda editavel, dependendo do banco).
 */
function montarPayloadPix({ chave, nome, cidade, valor, descricao, txid }) {
  if (!chave) throw new AppError('Configure sua chave PIX em Configurações antes de gerar uma cobrança.');
  const nomeSanitizado = sanitizar(nome, 25) || 'RECEBEDOR';
  const cidadeSanitizada = sanitizar(cidade, 15) || 'BRASIL';
  const txidSanitizado = sanitizar(txid, 25).replace(/[^A-Za-z0-9]/g, '') || '***';

  const contaPix = campo('00', 'br.gov.bcb.pix') + campo('01', sanitizar(chave, 77))
    + (descricao ? campo('02', sanitizar(descricao, 40)) : '');

  let payload = campo('00', '01') + campo('26', contaPix) + campo('52', '0000') + campo('53', '986');
  if (Number(valor) > 0) payload += campo('54', Number(valor).toFixed(2));
  payload += campo('58', 'BR') + campo('59', nomeSanitizado) + campo('60', cidadeSanitizada) + campo('62', campo('05', txidSanitizado));

  payload += '6304';
  return payload + crc16(payload);
}

async function gerarQrCodeDataUrl(payload) {
  return QRCode.toDataURL(payload, { margin: 1, width: 300 });
}

module.exports = { montarPayloadPix, gerarQrCodeDataUrl };
