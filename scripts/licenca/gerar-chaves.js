'use strict';

/**
 * Gera o par de chaves usado para assinar licencas do ContaFlow (rode
 * SOMENTE UMA VEZ, ao configurar o sistema de licenciamento pela primeira
 * vez — gerar de novo invalida todas as licencas ja emitidas).
 *
 * Uso:  node scripts/licenca/gerar-chaves.js
 *
 * Gera:
 *  - scripts/licenca/chave-privada.pem  (SECRETA — nunca compartilhe nem
 *    versione; e' o que permite emitir novas licencas. Faca backup seguro
 *    fora deste computador, ex.: gerenciador de senhas ou pendrive.)
 *  - src/backend/services/licencaChavePublica.js (publica — vai dentro do
 *    app, e' o que os clientes usam pra validar a chave que voce emitir)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
const ARQ_PRIVADA = path.join(DIR, 'chave-privada.pem');
const ARQ_PUBLICA_JS = path.join(DIR, '..', '..', 'src', 'backend', 'services', 'licencaChavePublica.js');

if (fs.existsSync(ARQ_PRIVADA)) {
  console.error('Ja existe uma chave privada em ' + ARQ_PRIVADA + '.');
  console.error('Gerar uma nova invalidaria TODAS as licencas ja emitidas com a atual.');
  console.error('Se tem certeza, apague o arquivo manualmente e rode este script de novo.');
  process.exit(1);
}

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');

const privadaPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const publicaPem = publicKey.export({ type: 'spki', format: 'pem' });

fs.writeFileSync(ARQ_PRIVADA, privadaPem, { mode: 0o600 });

const conteudoJs = `'use strict';

/**
 * Chave publica usada para validar as chaves de licenca (gerada por
 * scripts/licenca/gerar-chaves.js). Nao e' segredo — pode ficar no
 * repositorio e dentro do app instalado.
 */
module.exports = \`${publicaPem.trim()}\`;
`;
fs.writeFileSync(ARQ_PUBLICA_JS, conteudoJs);

console.log('Par de chaves gerado com sucesso.\n');
console.log('  Privada (SECRETA, NAO compartilhe):', ARQ_PRIVADA);
console.log('  Publica (vai no app, ja commitada):', ARQ_PUBLICA_JS);
console.log('\nIMPORTANTE: faca backup da chave privada em um lugar seguro fora deste');
console.log('computador (gerenciador de senhas, pendrive, etc.). Sem ela voce nao');
console.log('consegue emitir novas licencas nem renovar as dos clientes atuais.');
