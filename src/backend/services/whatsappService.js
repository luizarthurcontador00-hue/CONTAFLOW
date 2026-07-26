'use strict';

/**
 * Atendimento via WhatsApp Web (nao-oficial, biblioteca whatsapp-web.js).
 * Conecta via QR Code (sessao persistida em disco pelo LocalAuth), recebe
 * mensagens (texto, imagem, video, audio, documento, figurinha) e permite
 * responder por texto. Cada conversa tem um status (contato / aguardando /
 * atendimento) que a equipe controla manualmente, mas que tambem reage
 * automaticamente a novas mensagens e respostas.
 *
 * IMPORTANTE: e uma automacao de navegador sobre o WhatsApp Web, nao a API
 * oficial — existe risco de bloqueio do numero pelo WhatsApp em caso de uso
 * abusivo (envio em massa, muitos disparos automaticos). Uso recomendado:
 * atendimento humano assistido, nao disparo em massa.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const paths = require('../paths');
const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

let client = null;
let estado = 'desconectado'; // desconectado | gerando_qr | aguardando_leitura | conectado | erro
let qrDataUrl = null;
let ultimoErro = null;

const MAPA_TIPOS = {
  chat: 'texto', image: 'imagem', video: 'video',
  audio: 'audio', ptt: 'audio', document: 'documento', sticker: 'sticker',
};
const EXT_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3',
  'application/pdf': 'pdf',
};

function status() {
  return { estado, qr: qrDataUrl, erro: ultimoErro };
}

/** Inicia a conexao (idempotente: se ja estiver iniciando/conectado, so retorna o status). */
async function iniciar() {
  if (client) return status();

  // eslint-disable-next-line global-require
  const { Client, LocalAuth } = require('whatsapp-web.js');
  // eslint-disable-next-line global-require
  const QRCode = require('qrcode');

  estado = 'gerando_qr';
  ultimoErro = null;
  qrDataUrl = null;

  const novoClient = new Client({
    authStrategy: new LocalAuth({ dataPath: paths.whatsappAuthDir }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });

  novoClient.on('qr', async (qr) => {
    try { qrDataUrl = await QRCode.toDataURL(qr); } catch (_) { qrDataUrl = null; }
    estado = 'aguardando_leitura';
  });
  novoClient.on('ready', () => { estado = 'conectado'; qrDataUrl = null; ultimoErro = null; });
  novoClient.on('disconnected', () => { estado = 'desconectado'; qrDataUrl = null; client = null; });
  novoClient.on('auth_failure', (msg) => { estado = 'erro'; ultimoErro = String(msg); client = null; });
  novoClient.on('message', (msg) => {
    tratarMensagemRecebida(msg).catch((e) => console.error('[whatsapp] erro ao tratar mensagem recebida:', e.message));
  });

  client = novoClient;
  novoClient.initialize().catch((e) => {
    estado = 'erro';
    ultimoErro = e.message;
    client = null;
  });

  return status();
}

async function desconectar() {
  if (client) {
    try { await client.destroy(); } catch (_) { /* segue mesmo se falhar */ }
  }
  client = null;
  estado = 'desconectado';
  qrDataUrl = null;
  ultimoErro = null;
  return status();
}

function salvarMidia(media) {
  const ext = EXT_POR_MIME[media.mimetype] || (media.mimetype || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const nomeArquivo = `${crypto.randomBytes(8).toString('hex')}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(paths.whatsappMidiaDir, nomeArquivo), Buffer.from(media.data, 'base64'));
  return nomeArquivo;
}

/** Cria/atualiza um lead automatico no CRM quando o ramo e agencia de viagem. */
function tentarCriarLeadAutomatico(db, conversaId, nome, telefone) {
  try {
    const cfg = db.prepare("SELECT valor FROM config WHERE chave = 'ramo_servico'").get();
    if (!cfg || cfg.valor !== 'agencia_viagem') return;
    // eslint-disable-next-line global-require
    const crmService = require('./crmService');
    const lead = crmService.criarLead({ nome, telefone, origem: 'whatsapp' });
    db.prepare('UPDATE conversas_whatsapp SET lead_id = ? WHERE id = ?').run(lead.id, conversaId);
  } catch (e) {
    console.error('[whatsapp] erro ao criar lead automatico:', e.message);
  }
}

/** Processa uma mensagem recebida do whatsapp-web.js: persiste, baixa midia, atualiza a conversa. */
async function tratarMensagemRecebida(msg) {
  if (!msg.from || msg.from.endsWith('@g.us')) return; // ignora grupos por enquanto
  const db = getDb();

  let nome = msg.from.split('@')[0];
  try {
    const contato = await msg.getContact();
    if (contato && (contato.pushname || contato.name)) nome = contato.pushname || contato.name;
  } catch (_) { /* usa o numero como nome mesmo */ }
  const telefone = msg.from.split('@')[0];

  let conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE wa_chat_id = ?').get(msg.from);
  const novaConversa = !conversa;
  if (!conversa) {
    const info = db.prepare(
      "INSERT INTO conversas_whatsapp (wa_chat_id, nome_contato, telefone, status) VALUES (?, ?, ?, 'contato')"
    ).run(msg.from, nome, telefone);
    conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(info.lastInsertRowid);
  }

  const tipo = MAPA_TIPOS[msg.type] || 'texto';
  let arquivo = null;
  let arquivoOriginal = null;
  let texto = msg.body || null;

  if (msg.hasMedia) {
    try {
      const media = await msg.downloadMedia();
      if (media && media.data) {
        arquivo = salvarMidia(media);
        arquivoOriginal = media.filename || null;
      }
    } catch (e) { console.error('[whatsapp] erro ao baixar midia:', e.message); }
  }
  if (!MAPA_TIPOS[msg.type] && !texto) {
    texto = `[mensagem do tipo "${msg.type}" não suportada]`;
  }

  db.prepare(`
    INSERT INTO mensagens_whatsapp (conversa_id, wa_message_id, direcao, tipo, texto, arquivo, arquivo_nome_original)
    VALUES (?, ?, 'recebida', ?, ?, ?, ?)
  `).run(conversa.id, (msg.id && msg.id.id) || null, tipo, texto, arquivo, arquivoOriginal);

  const novoStatus = conversa.status === 'atendimento' ? 'atendimento' : (novaConversa ? 'contato' : 'aguardando');
  db.prepare(`
    UPDATE conversas_whatsapp SET status=?, nao_lidas = nao_lidas + 1,
      ultima_mensagem_em = datetime('now','localtime'), nome_contato = ?
    WHERE id=?
  `).run(novoStatus, nome, conversa.id);

  if (novaConversa) tentarCriarLeadAutomatico(db, conversa.id, nome, telefone);
}

function listarConversas({ status: filtroStatus } = {}) {
  const db = getDb();
  const where = filtroStatus ? 'WHERE status = @status' : '';
  return db.prepare(`SELECT * FROM conversas_whatsapp ${where} ORDER BY (ultima_mensagem_em IS NULL), datetime(ultima_mensagem_em) DESC`).all({ status: filtroStatus });
}

function obterConversa(id) {
  const db = getDb();
  const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
  if (!conversa) throw new AppError('Conversa nao encontrada.', 404);
  conversa.mensagens = db.prepare('SELECT * FROM mensagens_whatsapp WHERE conversa_id = ? ORDER BY id').all(id);
  return conversa;
}

function atualizarStatusConversa(id, novoStatus) {
  if (!['contato', 'aguardando', 'atendimento'].includes(novoStatus)) throw new AppError('Status invalido.');
  const db = getDb();
  const info = db.prepare('UPDATE conversas_whatsapp SET status = ?, nao_lidas = 0 WHERE id = ?').run(novoStatus, id);
  if (!info.changes) throw new AppError('Conversa nao encontrada.', 404);
  return db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
}

function marcarLida(id) {
  const db = getDb();
  const info = db.prepare('UPDATE conversas_whatsapp SET nao_lidas = 0 WHERE id = ?').run(id);
  if (!info.changes) throw new AppError('Conversa nao encontrada.', 404);
  return db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
}

async function enviarTexto(conversaId, texto) {
  if (!client || estado !== 'conectado') throw new AppError('WhatsApp não está conectado. Conecte em Atendimento antes de responder.');
  const db = getDb();
  const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(conversaId);
  if (!conversa) throw new AppError('Conversa nao encontrada.', 404);
  const texto2 = (texto || '').trim();
  if (!texto2) throw new AppError('Mensagem vazia.');

  const enviada = await client.sendMessage(conversa.wa_chat_id, texto2);
  db.prepare(`
    INSERT INTO mensagens_whatsapp (conversa_id, wa_message_id, direcao, tipo, texto) VALUES (?, ?, 'enviada', 'texto', ?)
  `).run(conversaId, (enviada && enviada.id && enviada.id.id) || null, texto2);
  db.prepare(`
    UPDATE conversas_whatsapp SET ultima_mensagem_em = datetime('now','localtime'),
      status = CASE WHEN status != 'atendimento' THEN 'atendimento' ELSE status END
    WHERE id = ?
  `).run(conversaId);

  return obterConversa(conversaId);
}

// ------------------------- apenas para testes automatizados -------------------------
function _definirClienteParaTeste(fakeClient, fakeEstado) {
  client = fakeClient;
  estado = fakeEstado || 'conectado';
}

module.exports = {
  iniciar, desconectar, status,
  listarConversas, obterConversa, atualizarStatusConversa, marcarLida, enviarTexto,
  tratarMensagemRecebida,
  _definirClienteParaTeste,
};
