'use strict';

/**
 * Identificador estavel deste computador, usado para travar a licenca a
 * uma unica maquina (para copiar a chave de ativacao para outro PC nao
 * funcionar). Usa um ID persistente do sistema operacional quando
 * disponivel (nao muda ao trocar de HD, RAM etc.), com um fallback baseado
 * em dados de hardware para plataformas sem esses IDs.
 */

const os = require('os');
const fs = require('fs');
const crypto = require('crypto');
const { execSync } = require('child_process');

function idBrutoDoSistema() {
  try {
    if (process.platform === 'win32') {
      const saida = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { windowsHide: true }).toString();
      const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/.exec(saida);
      if (m) return m[1];
    } else if (process.platform === 'darwin') {
      const saida = execSync('ioreg -rd1 -c IOPlatformExpertDevice').toString();
      const m = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(saida);
      if (m) return m[1];
    } else {
      for (const caminho of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
        if (fs.existsSync(caminho)) return fs.readFileSync(caminho, 'utf8').trim();
      }
    }
  } catch (_) {
    // Segue para o fallback abaixo (comando indisponivel, sem permissao, etc.).
  }
  const cpu = os.cpus();
  return ['fallback', os.hostname(), os.arch(), cpu && cpu[0] && cpu[0].model, os.totalmem()].join('|');
}

let cache = null;

/** ID legivel deste computador, ex.: "A1B2-C3D4-E5F6-0102". Sempre o mesmo nesta maquina. */
function machineId() {
  if (cache) return cache;
  const hash = crypto.createHash('sha256').update(idBrutoDoSistema()).digest('hex').toUpperCase().slice(0, 16);
  cache = hash.match(/.{1,4}/g).join('-');
  return cache;
}

module.exports = { machineId };
