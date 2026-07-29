'use strict';

/**
 * Emite uma chave de licenca assinada para um cliente/computador.
 *
 * Uso:
 *   node scripts/licenca/gerar-licenca.js --cliente "Nome do cliente" --maquina "XXXX-XXXX-XXXX-XXXX" --dias 365
 *   node scripts/licenca/gerar-licenca.js --cliente "Nome do cliente" --maquina "XXXX-XXXX-XXXX-XXXX" --validade 2027-07-29
 *
 * O "ID da maquina" e' o codigo que aparece na tela de ativacao do sistema
 * no computador do cliente — peca pra ele te mandar (por WhatsApp, etc.).
 *
 * A chave gerada so funciona:
 *  - naquele computador especifico (nao pode copiar pra outro);
 *  - ate a data de validade informada.
 * Para renovar, gere uma nova chave com uma validade maior.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ARQ_PRIVADA = path.join(__dirname, 'chave-privada.pem');
const ARQ_LOG = path.join(__dirname, 'licencas-emitidas.log');

function lerArgs() {
  const args = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const chave = argv[i].slice(2);
      const valor = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
      args[chave] = valor;
    }
  }
  return args;
}

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function main() {
  const args = lerArgs();
  const cliente = (args.cliente || '').trim();
  const maquina = (args.maquina || '').trim().toUpperCase();
  if (!cliente) { console.error('Informe --cliente "Nome do cliente".'); process.exit(1); }
  if (!maquina) { console.error('Informe --maquina "XXXX-XXXX-XXXX-XXXX" (o ID mostrado na tela de ativacao do cliente).'); process.exit(1); }
  if (!fs.existsSync(ARQ_PRIVADA)) {
    console.error('Chave privada nao encontrada em ' + ARQ_PRIVADA + '.');
    console.error('Rode primeiro: node scripts/licenca/gerar-chaves.js (ou restaure o backup da chave privada nesse caminho).');
    process.exit(1);
  }

  let validade;
  if (args.validade) {
    validade = String(args.validade);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(validade)) { console.error('--validade deve estar no formato AAAA-MM-DD.'); process.exit(1); }
  } else {
    const dias = Number(args.dias || 365);
    const d = new Date();
    d.setDate(d.getDate() + dias);
    validade = d.toISOString().slice(0, 10);
  }

  const privateKey = crypto.createPrivateKey(fs.readFileSync(ARQ_PRIVADA, 'utf8'));
  const payload = { cliente, machineId: maquina, validade, emitida: new Date().toISOString().slice(0, 10) };
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const assinatura = crypto.sign(null, payloadBuf, privateKey);
  const chave = `CF1.${base64url(payloadBuf)}.${base64url(assinatura)}`;

  console.log('\nChave de ativação (envie para o cliente):\n');
  console.log(chave);
  console.log('\nCliente:', cliente);
  console.log('Máquina:', maquina);
  console.log('Válida até:', validade);

  try {
    fs.appendFileSync(ARQ_LOG, `${new Date().toISOString()}\t${cliente}\t${maquina}\t${validade}\t${chave}\n`);
  } catch (_) { /* log e' so um registro auxiliar, nao trava se falhar */ }
}

main();
