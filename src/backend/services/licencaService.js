'use strict';

/**
 * Licenciamento offline por maquina: o cliente ativa o sistema com uma
 * chave assinada (gerada por scripts/licenca/gerar-licenca.js) que so
 * funciona no computador para o qual foi emitida e ate a data de
 * validade nela contida. Nao depende de internet — tudo e' validado
 * localmente com a chave publica embutida no app.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const paths = require('../paths');
const { AppError } = require('../utils/errors');
const { machineId } = require('./machineId');
const CHAVE_PUBLICA = require('./licencaChavePublica');

const ARQUIVO_LICENCA = path.join(paths.baseDir, 'licenca.lic');

function base64urlDecode(s) {
  return Buffer.from(String(s || '').replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/** Decodifica e valida a assinatura de uma chave de licenca. Lanca AppError se invalida. */
function parseChave(chave) {
  const partes = String(chave || '').trim().split('.');
  if (partes.length !== 3 || partes[0] !== 'CF1') {
    throw new AppError('Chave de licença inválida (formato incorreto). Confira se copiou a chave inteira.');
  }
  const [, payloadB64, assinaturaB64] = partes;
  const payloadBuf = base64urlDecode(payloadB64);
  let payload;
  try { payload = JSON.parse(payloadBuf.toString('utf8')); }
  catch (_) { throw new AppError('Chave de licença inválida (dados corrompidos).'); }
  if (!payload.cliente || !payload.machineId || !payload.validade) {
    throw new AppError('Chave de licença inválida (dados incompletos).');
  }
  let assinaturaValida = false;
  try { assinaturaValida = crypto.verify(null, payloadBuf, CHAVE_PUBLICA, base64urlDecode(assinaturaB64)); }
  catch (_) { assinaturaValida = false; }
  if (!assinaturaValida) throw new AppError('Chave de licença inválida (assinatura não confere).');
  return payload;
}

function diasRestantes(validadeISO) {
  const hoje = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00');
  const alvo = new Date(validadeISO + 'T00:00:00');
  return Math.round((alvo - hoje) / 86400000);
}

/** Situação atual da licença deste computador (sempre local, sem rede). */
function status() {
  const machine_id = machineId();
  if (!fs.existsSync(ARQUIVO_LICENCA)) {
    return { ativo: false, motivo: 'nao_ativado', machine_id, cliente: null, validade: null, dias_restantes: null };
  }

  const chave = fs.readFileSync(ARQUIVO_LICENCA, 'utf8');
  let payload;
  try { payload = parseChave(chave); }
  catch (_) {
    return { ativo: false, motivo: 'chave_invalida', machine_id, cliente: null, validade: null, dias_restantes: null };
  }

  if (payload.machineId !== machine_id) {
    return { ativo: false, motivo: 'maquina_diferente', machine_id, cliente: payload.cliente, validade: payload.validade, dias_restantes: null };
  }

  const dias = diasRestantes(payload.validade);
  if (dias < 0) {
    return { ativo: false, motivo: 'expirada', machine_id, cliente: payload.cliente, validade: payload.validade, dias_restantes: dias };
  }
  return { ativo: true, motivo: null, machine_id, cliente: payload.cliente, validade: payload.validade, dias_restantes: dias };
}

/** Ativa (ou renova) a licença deste computador com uma nova chave. Lanca AppError se invalida. */
function ativar(chave) {
  const machine_id = machineId();
  const payload = parseChave(chave);
  if (payload.machineId !== machine_id) {
    throw new AppError('Esta chave foi emitida para outro computador. Copie o ID da máquina atual e peça uma nova chave.');
  }
  if (diasRestantes(payload.validade) < 0) {
    throw new AppError('Esta chave já está expirada. Peça uma nova chave de ativação.');
  }
  fs.mkdirSync(path.dirname(ARQUIVO_LICENCA), { recursive: true });
  fs.writeFileSync(ARQUIVO_LICENCA, String(chave).trim(), 'utf8');
  return status();
}

module.exports = { status, ativar };
