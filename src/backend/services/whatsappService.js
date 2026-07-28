'use strict';

/**
 * Atendimento via WhatsApp Web (nao-oficial, biblioteca whatsapp-web.js).
 * Conecta via QR Code (sessao persistida em disco pelo LocalAuth), recebe
 * mensagens (texto, imagem, video, audio, documento, figurinha) e permite
 * responder por texto. Cada conversa tem um status (contato / aguardando /
 * atendimento) que a equipe controla manualmente, mas que tambem reage
 * automaticamente a novas mensagens, respostas e ao bot.
 *
 * Correcoes tecnicas incorporadas (aprendidas de uma integracao anterior
 * com a mesma biblioteca):
 * - Sempre usa o "chat_id" serializado bruto (msg.from) para responder, nunca
 *   reconstroi a partir do numero de telefone — evita erro em contas que se
 *   apresentam por LID em vez do numero (msg.from ja e o endereco correto).
 * - Dedupe por wa_message_id (indice unico) — evita mensagem duplicada.
 * - Download de midia com novas tentativas e espera crescente — fotos/videos
 *   grandes as vezes ainda estao sincronizando quando a mensagem chega.
 * - Acompanha confirmacao de entrega/leitura (✓✓) via evento message_ack.
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
/**
 * Eventos internos do protocolo do WhatsApp (nao sao mensagens reais de
 * alguem) que o whatsapp-web.js as vezes emite pelo mesmo evento "message":
 * notificacao de troca de chave de criptografia, metadados de chamada/grupo,
 * mensagem ainda nao decifrada, etc. Sem esse filtro, esses eventos criavam
 * uma "mensagem recebida" fantasma no sistema que nunca existiu de verdade
 * no WhatsApp do cliente.
 */
const TIPOS_SISTEMA = new Set([
  'e2e_notification', 'notification_template', 'notification', 'gp2',
  'group_notification', 'call_log', 'protocol', 'ciphertext', 'unknown', 'revoked',
]);
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
    tratarMensagemRecebida(msg).catch((e) => console.error('[whatsapp] erro ao tratar mensagem recebida:', descreverErro(e)));
  });
  novoClient.on('message_ack', (msg, ack) => {
    try { tratarConfirmacao(msg, ack); } catch (e) { console.error('[whatsapp] erro ao tratar confirmacao:', descreverErro(e)); }
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

/** Loga o erro completo (mensagens truncadas tipo "r" so aparecem inteiras assim). */
function descreverErro(e) {
  try { return JSON.stringify(e, Object.getOwnPropertyNames(e)); } catch (_) { return String(e && e.message); }
}

function salvarMidia(media) {
  const ext = EXT_POR_MIME[media.mimetype] || (media.mimetype || '').split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
  const nomeArquivo = `${crypto.randomBytes(8).toString('hex')}_${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(paths.whatsappMidiaDir, nomeArquivo), Buffer.from(media.data, 'base64'));
  return nomeArquivo;
}

/**
 * Baixa a midia com novas tentativas e espera crescente: fotos/videos
 * grandes as vezes ainda estao sincronizando quando o evento chega (audio
 * pequeno quase sempre funciona de primeira).
 */
async function baixarMidiaComRetry(msg, tentativas = 5) {
  const espera = [800, 1500, 2500, 4000];
  for (let i = 1; i <= tentativas; i++) {
    try {
      const media = await msg.downloadMedia();
      if (media && media.data) return media;
    } catch (e) {
      console.error(`[whatsapp] tentativa ${i}/${tentativas} de baixar midia falhou:`, descreverErro(e));
    }
    if (i < tentativas) await new Promise((r) => setTimeout(r, espera[i - 1] || 4000));
  }
  return null;
}

/** Extrai o id serializado do retorno de sendMessage (pode vir vazio em contas @lid). */
function serializarId(r) {
  const id = r && r.id;
  if (!id) return null;
  if (id._serialized) return id._serialized;
  const remote = id.remote && typeof id.remote === 'object' ? id.remote._serialized : id.remote;
  if (id.fromMe !== undefined && remote && id.id) return `${id.fromMe}_${remote}_${id.id}`;
  return null;
}

/** Fallback: se sendMessage nao retornou id utilizavel, busca a ultima mensagem enviada no chat. */
async function idAposEnviar(chatId, r) {
  const direto = serializarId(r);
  if (direto) return direto;
  try {
    const chat = await client.getChatById(chatId);
    const msgs = await chat.fetchMessages({ limit: 1 });
    const ultima = msgs[msgs.length - 1];
    if (ultima && ultima.fromMe && ultima.id && ultima.id._serialized) return ultima.id._serialized;
  } catch (e) {
    console.error('[whatsapp] nao foi possivel confirmar o id da mensagem enviada:', descreverErro(e));
  }
  return null;
}

function tratarConfirmacao(msg, ack) {
  const wamid = msg && msg.id && msg.id._serialized;
  if (!wamid) return;
  const novoStatus = ack >= 3 ? 'lida' : ack === 2 ? 'entregue' : ack === 1 ? 'enviada' : null;
  if (!novoStatus) return;
  getDb().prepare("UPDATE mensagens_whatsapp SET status = ? WHERE wa_message_id = ? AND direcao = 'enviada'").run(novoStatus, wamid);
}

/** Busca (ou cria) o contato pelo chat_id, atualizando o nome que o WhatsApp informa. */
function obterOuCriarContato(db, waChatId, telefone, pushName) {
  let contato = db.prepare('SELECT * FROM contatos_whatsapp WHERE wa_chat_id = ?').get(waChatId);
  if (!contato) {
    const info = db.prepare(`
      INSERT INTO contatos_whatsapp (wa_chat_id, telefone, nome, push_name, ultima_interacao)
      VALUES (?, ?, ?, ?, datetime('now','localtime'))
    `).run(waChatId, telefone, pushName || null, pushName || null);
    contato = db.prepare('SELECT * FROM contatos_whatsapp WHERE id = ?').get(info.lastInsertRowid);
  } else {
    db.prepare(`
      UPDATE contatos_whatsapp SET push_name = COALESCE(?, push_name), ultima_interacao = datetime('now','localtime')
      WHERE id = ?
    `).run(pushName || null, contato.id);
    if (!contato.nome && pushName) {
      db.prepare('UPDATE contatos_whatsapp SET nome = ? WHERE id = ?').run(pushName, contato.id);
    }
    contato = db.prepare('SELECT * FROM contatos_whatsapp WHERE id = ?').get(contato.id);
  }
  return contato;
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

// ============================== Bot configuravel ==============================

function normalizarTexto(s) {
  return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function obterConfigBot() {
  const db = getDb();
  const linhas = db.prepare("SELECT chave, valor FROM config WHERE chave IN ('bot_ativo','bot_saudacao','bot_menu_texto')").all();
  const cfg = {};
  linhas.forEach((l) => { cfg[l.chave] = l.valor; });
  return { ativo: cfg.bot_ativo === '1', saudacao: cfg.bot_saudacao || '', menuTexto: cfg.bot_menu_texto || '' };
}

function salvarConfigBot(dados) {
  const db = getDb();
  const upsert = db.prepare("INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor");
  upsert.run('bot_ativo', dados.ativo ? '1' : '0');
  upsert.run('bot_saudacao', dados.saudacao || '');
  upsert.run('bot_menu_texto', dados.menuTexto || '');
  return obterConfigBot();
}

function listarRegrasBot() {
  return getDb().prepare('SELECT * FROM bot_respostas_whatsapp ORDER BY ordem, id').all();
}

function criarRegraBot(dados) {
  const db = getDb();
  const gatilho = (dados.gatilho || '').trim();
  const resposta = (dados.resposta || '').trim();
  if (!gatilho) throw new AppError('Informe o gatilho (opção do menu ou palavras-chave).');
  if (!resposta) throw new AppError('Informe a resposta do bot.');
  const tipo = dados.gatilho_tipo === 'opcao_menu' ? 'opcao_menu' : 'palavra_chave';
  const ordem = db.prepare('SELECT COALESCE(MAX(ordem),-1)+1 o FROM bot_respostas_whatsapp').get().o;
  const info = db.prepare(
    'INSERT INTO bot_respostas_whatsapp (gatilho_tipo, gatilho, resposta, transfere_humano, ordem) VALUES (?, ?, ?, ?, ?)'
  ).run(tipo, gatilho, resposta, dados.transfere_humano ? 1 : 0, ordem);
  return db.prepare('SELECT * FROM bot_respostas_whatsapp WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarRegraBot(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM bot_respostas_whatsapp WHERE id = ?').get(id);
  if (!atual) throw new AppError('Regra nao encontrada.', 404);
  const gatilho = dados.gatilho !== undefined ? (dados.gatilho || '').trim() : atual.gatilho;
  const resposta = dados.resposta !== undefined ? (dados.resposta || '').trim() : atual.resposta;
  if (!gatilho) throw new AppError('Informe o gatilho.');
  if (!resposta) throw new AppError('Informe a resposta do bot.');
  db.prepare('UPDATE bot_respostas_whatsapp SET gatilho_tipo=?, gatilho=?, resposta=?, transfere_humano=?, ativo=? WHERE id=?').run(
    dados.gatilho_tipo === 'opcao_menu' ? 'opcao_menu' : 'palavra_chave',
    gatilho, resposta,
    dados.transfere_humano !== undefined ? (dados.transfere_humano ? 1 : 0) : atual.transfere_humano,
    dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo,
    id
  );
  return db.prepare('SELECT * FROM bot_respostas_whatsapp WHERE id = ?').get(id);
}

function excluirRegraBot(id) {
  getDb().prepare('DELETE FROM bot_respostas_whatsapp WHERE id = ?').run(id);
  return { ok: true };
}

function casarRegra(db, texto) {
  if (!texto) return null;
  const normalizado = normalizarTexto(texto);
  const regras = db.prepare('SELECT * FROM bot_respostas_whatsapp WHERE ativo = 1 ORDER BY ordem, id').all();
  for (const r of regras) {
    if (r.gatilho_tipo === 'opcao_menu') {
      if (normalizarTexto(r.gatilho) === normalizado) return r;
    } else {
      const termos = r.gatilho.split(',').map((t) => normalizarTexto(t)).filter(Boolean);
      if (termos.some((t) => normalizado.includes(t))) return r;
    }
  }
  return null;
}

/** Decide o que o bot responde para uma mensagem recebida. Sem I/O — so decide. */
function processarBot(db, conversa, texto, ehPrimeiraMensagem) {
  const cfgBot = obterConfigBot();
  if (!cfgBot.ativo) return null;

  const respostas = [];
  let transferir = false;

  if (ehPrimeiraMensagem) {
    if (cfgBot.saudacao) respostas.push(cfgBot.saudacao);
    if (cfgBot.menuTexto) respostas.push(cfgBot.menuTexto);
  }

  const regra = casarRegra(db, texto);
  if (regra) {
    respostas.push(regra.resposta);
    transferir = !!regra.transfere_humano;
  } else if (!ehPrimeiraMensagem) {
    if (cfgBot.menuTexto) respostas.push(cfgBot.menuTexto);
    else { respostas.push('Vou te transferir para um atendente, só um momento.'); transferir = true; }
  }

  return { respostas, transferir };
}

async function enviarRespostasBot(conversa, respostas) {
  for (const texto of respostas) {
    try {
      const enviada = await client.sendMessage(conversa.wa_chat_id, texto);
      const wamid = await idAposEnviar(conversa.wa_chat_id, enviada);
      getDb().prepare(`
        INSERT OR IGNORE INTO mensagens_whatsapp (conversa_id, wa_message_id, direcao, tipo, texto, status, remetente_tipo)
        VALUES (?, ?, 'enviada', 'texto', ?, 'enviada', 'bot')
      `).run(conversa.id, wamid, texto);
    } catch (e) {
      console.error('[whatsapp] erro ao enviar resposta do bot:', descreverErro(e));
    }
  }
}

// ============================== Mensagens ==============================

/** Processa uma mensagem recebida do whatsapp-web.js: persiste, baixa midia, atualiza a conversa. */
async function tratarMensagemRecebida(msg) {
  if (!msg.from || msg.from.endsWith('@g.us') || msg.from.endsWith('@newsletter') || msg.from === 'status@broadcast') return;
  if (TIPOS_SISTEMA.has(msg.type)) return; // notificacao interna do protocolo, nao e mensagem de verdade
  const db = getDb();

  const wamid = (msg.id && msg.id._serialized) || null;
  if (wamid) {
    const jaExiste = db.prepare('SELECT 1 FROM mensagens_whatsapp WHERE wa_message_id = ?').get(wamid);
    if (jaExiste) return; // dedupe: evento duplicado
  }

  let nome = msg.from.split('@')[0];
  try {
    const wacontato = await msg.getContact();
    if (wacontato && (wacontato.pushname || wacontato.name)) nome = wacontato.pushname || wacontato.name;
  } catch (_) { /* usa o numero como nome mesmo */ }
  const telefone = msg.from.split('@')[0];

  const contato = obterOuCriarContato(db, msg.from, telefone, nome);

  let conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE wa_chat_id = ?').get(msg.from);
  const novaConversa = !conversa;
  const reabrindo = !!conversa && conversa.status === 'resolvida';
  if (!conversa) {
    const modoInicial = obterConfigBot().ativo ? 'bot' : 'humano';
    const info = db.prepare(
      "INSERT INTO conversas_whatsapp (wa_chat_id, nome_contato, telefone, status, modo_atual, contato_id) VALUES (?, ?, ?, 'contato', ?, ?)"
    ).run(msg.from, contato.nome || nome, telefone, modoInicial, contato.id);
    conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(info.lastInsertRowid);
  } else if (reabrindo) {
    // Conversa ja tinha sido finalizada: chegar mensagem nova reabre do zero.
    const modoInicial = obterConfigBot().ativo ? 'bot' : 'humano';
    db.prepare(`
      UPDATE conversas_whatsapp SET status='contato', modo_atual=?, comentario_resolucao=NULL, resolvida_em=NULL
      WHERE id=?
    `).run(modoInicial, conversa.id);
    conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(conversa.id);
  }

  const tipo = MAPA_TIPOS[msg.type] || 'texto';
  let arquivo = null;
  let arquivoOriginal = null;
  let texto = msg.body || null;

  if (msg.hasMedia) {
    const media = await baixarMidiaComRetry(msg);
    if (media) {
      arquivo = salvarMidia(media);
      arquivoOriginal = media.filename || null;
    } else {
      console.error(`[whatsapp] midia do tipo "${msg.type}" nao pode ser baixada apos varias tentativas (conversa ${conversa.id})`);
    }
  }
  if (!MAPA_TIPOS[msg.type] && !texto) {
    texto = `[mensagem do tipo "${msg.type}" não suportada]`;
  }

  db.prepare(`
    INSERT OR IGNORE INTO mensagens_whatsapp (conversa_id, wa_message_id, direcao, tipo, texto, arquivo, arquivo_nome_original, status)
    VALUES (?, ?, 'recebida', ?, ?, ?, ?, 'recebida')
  `).run(conversa.id, wamid, tipo, texto, arquivo, arquivoOriginal);

  // Decide o bot ANTES de calcular o status final (pode transferir para humano).
  let resultadoBot = null;
  if (conversa.modo_atual === 'bot' && client) {
    const ehPrimeira = db.prepare("SELECT COUNT(*) c FROM mensagens_whatsapp WHERE conversa_id = ? AND direcao = 'recebida'").get(conversa.id).c === 1;
    resultadoBot = processarBot(db, conversa, texto, ehPrimeira);
  }

  const transferiuAgora = resultadoBot && resultadoBot.transferir;
  const novoModo = transferiuAgora ? 'humano' : conversa.modo_atual;
  const novoStatus = conversa.status === 'atendimento'
    ? 'atendimento'
    : (transferiuAgora ? 'aguardando' : (conversa.modo_atual === 'bot' ? 'contato' : 'aguardando'));

  db.prepare(`
    UPDATE conversas_whatsapp SET status=?, modo_atual=?, nao_lidas = nao_lidas + 1,
      ultima_mensagem_em = datetime('now','localtime'), nome_contato = ?
    WHERE id=?
  `).run(novoStatus, novoModo, contato.nome || nome, conversa.id);

  if (novaConversa) tentarCriarLeadAutomatico(db, conversa.id, nome, telefone);

  if (resultadoBot && resultadoBot.respostas.length) {
    const conversaAtualizada = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(conversa.id);
    await enviarRespostasBot(conversaAtualizada, resultadoBot.respostas);
  }
}

function listarConversas({ status: filtroStatus } = {}) {
  const db = getDb();
  const where = filtroStatus ? 'WHERE c.status = @status' : '';
  return db.prepare(`
    SELECT c.*,
      (SELECT tipo FROM mensagens_whatsapp m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_tipo,
      (SELECT texto FROM mensagens_whatsapp m WHERE m.conversa_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_texto
    FROM conversas_whatsapp c
    ${where}
    ORDER BY (c.ultima_mensagem_em IS NULL), datetime(c.ultima_mensagem_em) DESC
  `).all({ status: filtroStatus });
}

/** Inicia uma conversa nova (a equipe fala primeiro com um numero que ainda nao escreveu). */
async function iniciarConversa(telefone, texto, nome, atendenteId) {
  if (!client || estado !== 'conectado') throw new AppError('WhatsApp não está conectado. Conecte em Atendimento antes de iniciar uma conversa.');
  const numeroLimpo = String(telefone || '').replace(/\D/g, '');
  if (!numeroLimpo) throw new AppError('Informe um telefone válido.');
  const texto2 = (texto || '').trim();
  if (!texto2) throw new AppError('Mensagem vazia.');

  let numeroId;
  try { numeroId = await client.getNumberId(numeroLimpo); } catch (e) {
    throw new AppError('Não foi possível validar esse número no WhatsApp: ' + descreverErro(e));
  }
  if (!numeroId) throw new AppError('Esse número não está registrado no WhatsApp.');
  const chatId = numeroId._serialized;

  const db = getDb();
  const contato = obterOuCriarContato(db, chatId, numeroLimpo, null);
  const nomeLimpo = (nome || '').trim();
  if (nomeLimpo) {
    db.prepare('UPDATE contatos_whatsapp SET nome = ? WHERE id = ?').run(nomeLimpo, contato.id);
    contato.nome = nomeLimpo;
  }

  let conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE wa_chat_id = ?').get(chatId);
  if (!conversa) {
    const info = db.prepare(`
      INSERT INTO conversas_whatsapp (wa_chat_id, nome_contato, telefone, status, modo_atual, contato_id, atendente_id)
      VALUES (?, ?, ?, 'atendimento', 'humano', ?, ?)
    `).run(chatId, contato.nome, numeroLimpo, contato.id, atendenteId || null);
    conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(info.lastInsertRowid);
  } else if (conversa.status === 'resolvida') {
    db.prepare(`
      UPDATE conversas_whatsapp SET status='atendimento', modo_atual='humano', comentario_resolucao=NULL, resolvida_em=NULL, atendente_id=?
      WHERE id=?
    `).run(atendenteId || null, conversa.id);
  }

  return enviarTexto(conversa.id, texto2, atendenteId);
}

// ============================== Contatos ==============================

function listarContatos({ busca } = {}) {
  const db = getDb();
  const termo = busca ? `%${busca}%` : null;
  const where = termo ? 'WHERE c.nome LIKE @termo OR c.push_name LIKE @termo OR c.telefone LIKE @termo' : '';
  return db.prepare(`
    SELECT c.*,
      (SELECT v.id FROM conversas_whatsapp v WHERE v.contato_id = c.id ORDER BY v.id DESC LIMIT 1) AS conversa_id,
      (SELECT v.status FROM conversas_whatsapp v WHERE v.contato_id = c.id ORDER BY v.id DESC LIMIT 1) AS conversa_status,
      (SELECT v.nao_lidas FROM conversas_whatsapp v WHERE v.contato_id = c.id ORDER BY v.id DESC LIMIT 1) AS nao_lidas,
      (SELECT m.tipo FROM mensagens_whatsapp m JOIN conversas_whatsapp v2 ON v2.id = m.conversa_id
        WHERE v2.contato_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_tipo,
      (SELECT m.texto FROM mensagens_whatsapp m JOIN conversas_whatsapp v2 ON v2.id = m.conversa_id
        WHERE v2.contato_id = c.id ORDER BY m.id DESC LIMIT 1) AS ultima_mensagem_texto
    FROM contatos_whatsapp c
    ${where}
    ORDER BY (c.ultima_interacao IS NULL), datetime(c.ultima_interacao) DESC
  `).all({ termo });
}

function obterContato(id) {
  const contato = getDb().prepare('SELECT * FROM contatos_whatsapp WHERE id = ?').get(id);
  if (!contato) throw new AppError('Contato nao encontrado.', 404);
  return contato;
}

function atualizarContato(id, nome) {
  const db = getDb();
  const nomeLimpo = (nome || '').trim();
  if (!nomeLimpo) throw new AppError('Informe um nome.');
  const info = db.prepare('UPDATE contatos_whatsapp SET nome = ? WHERE id = ?').run(nomeLimpo, id);
  if (!info.changes) throw new AppError('Contato nao encontrado.', 404);
  db.prepare('UPDATE conversas_whatsapp SET nome_contato = ? WHERE contato_id = ?').run(nomeLimpo, id);
  return db.prepare('SELECT * FROM contatos_whatsapp WHERE id = ?').get(id);
}

function obterConversa(id) {
  const db = getDb();
  const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
  if (!conversa) throw new AppError('Conversa nao encontrada.', 404);
  conversa.mensagens = db.prepare('SELECT * FROM mensagens_whatsapp WHERE conversa_id = ? ORDER BY id').all(id);
  return conversa;
}

function atualizarStatusConversa(id, novoStatus) {
  if (!['contato', 'aguardando', 'atendimento', 'resolvida'].includes(novoStatus)) throw new AppError('Status invalido.');
  const db = getDb();
  const info = db.prepare('UPDATE conversas_whatsapp SET status = ?, nao_lidas = 0 WHERE id = ?').run(novoStatus, id);
  if (!info.changes) throw new AppError('Conversa nao encontrada.', 404);
  return db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
}

function atribuirAtendente(id, atendenteId) {
  const db = getDb();
  const info = db.prepare('UPDATE conversas_whatsapp SET atendente_id = ? WHERE id = ?').run(atendenteId || null, id);
  if (!info.changes) throw new AppError('Conversa nao encontrada.', 404);
  return db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
}

/** "Iniciar Atendimento": assume a conversa para um atendente, sem exigir que ja tenha dono. */
function iniciarAtendimento(id, atendenteId) {
  const db = getDb();
  const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
  if (!conversa) throw new AppError('Conversa nao encontrada.', 404);
  db.prepare(`
    UPDATE conversas_whatsapp SET status='atendimento', modo_atual='humano', atendente_id=?, nao_lidas=0
    WHERE id=?
  `).run(atendenteId || null, id);
  return obterConversa(id);
}

/** Liga/desliga o robo para uma conversa especifica (botao "Ativar/Desativar robô"). */
function alternarModoConversa(id) {
  const db = getDb();
  const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
  if (!conversa) throw new AppError('Conversa nao encontrada.', 404);
  const novoModo = conversa.modo_atual === 'bot' ? 'humano' : 'bot';
  db.prepare('UPDATE conversas_whatsapp SET modo_atual = ? WHERE id = ?').run(novoModo, id);
  return obterConversa(id);
}

/** "Finalizar Atendimento": encerra a conversa (some das abas ativas ate chegar mensagem nova). */
function finalizarConversa(id, comentario) {
  const db = getDb();
  const info = db.prepare(`
    UPDATE conversas_whatsapp SET status='resolvida', comentario_resolucao=?, resolvida_em=datetime('now','localtime')
    WHERE id=?
  `).run((comentario || '').trim() || null, id);
  if (!info.changes) throw new AppError('Conversa nao encontrada.', 404);
  return obterConversa(id);
}

function marcarLida(id) {
  const db = getDb();
  const info = db.prepare('UPDATE conversas_whatsapp SET nao_lidas = 0 WHERE id = ?').run(id);
  if (!info.changes) throw new AppError('Conversa nao encontrada.', 404);
  return db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(id);
}

async function enviarTexto(conversaId, texto, atendenteId) {
  if (!client || estado !== 'conectado') throw new AppError('WhatsApp não está conectado. Conecte em Atendimento antes de responder.');
  const db = getDb();
  const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(conversaId);
  if (!conversa) throw new AppError('Conversa nao encontrada.', 404);
  const texto2 = (texto || '').trim();
  if (!texto2) throw new AppError('Mensagem vazia.');

  const enviada = await client.sendMessage(conversa.wa_chat_id, texto2);
  const wamid = await idAposEnviar(conversa.wa_chat_id, enviada);
  db.prepare(`
    INSERT OR IGNORE INTO mensagens_whatsapp (conversa_id, wa_message_id, direcao, tipo, texto, status, remetente_tipo, remetente_id)
    VALUES (?, ?, 'enviada', 'texto', ?, 'enviada', 'atendente', ?)
  `).run(conversaId, wamid, texto2, atendenteId || null);
  db.prepare(`
    UPDATE conversas_whatsapp SET ultima_mensagem_em = datetime('now','localtime'),
      modo_atual = 'humano',
      status = CASE WHEN status != 'atendimento' THEN 'atendimento' ELSE status END
    WHERE id = ?
  `).run(conversaId);

  return obterConversa(conversaId);
}

/**
 * Envia um arquivo ja salvo em paths.whatsappMidiaDir (subido via multer) como
 * midia da conversa: imagem/video/documento, ou nota de voz se comoAudio=true.
 */
async function enviarMidia(conversaId, { arquivoSalvo, mimetype, nomeOriginal, legenda, comoAudio, atendenteId }) {
  if (!client || estado !== 'conectado') throw new AppError('WhatsApp não está conectado. Conecte em Atendimento antes de enviar.');
  const db = getDb();
  const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(conversaId);
  if (!conversa) throw new AppError('Conversa nao encontrada.', 404);

  // eslint-disable-next-line global-require
  const { MessageMedia } = require('whatsapp-web.js');
  const caminho = path.join(paths.whatsappMidiaDir, arquivoSalvo);
  const media = MessageMedia.fromFilePath(caminho);
  if (nomeOriginal) media.filename = nomeOriginal;

  const opcoes = {};
  if (legenda) opcoes.caption = legenda;
  if (comoAudio) opcoes.sendAudioAsVoice = true;

  const enviada = await client.sendMessage(conversa.wa_chat_id, media, opcoes);
  const wamid = await idAposEnviar(conversa.wa_chat_id, enviada);

  const mimeReal = media.mimetype || mimetype || '';
  const tipoMsg = comoAudio ? 'audio'
    : mimeReal.startsWith('image/') ? 'imagem'
      : mimeReal.startsWith('video/') ? 'video'
        : mimeReal.startsWith('audio/') ? 'audio' : 'documento';

  db.prepare(`
    INSERT OR IGNORE INTO mensagens_whatsapp (conversa_id, wa_message_id, direcao, tipo, texto, arquivo, arquivo_nome_original, status, remetente_tipo, remetente_id)
    VALUES (?, ?, 'enviada', ?, ?, ?, ?, 'enviada', 'atendente', ?)
  `).run(conversaId, wamid, tipoMsg, legenda || null, arquivoSalvo, nomeOriginal || null, atendenteId || null);

  db.prepare(`
    UPDATE conversas_whatsapp SET ultima_mensagem_em = datetime('now','localtime'), modo_atual = 'humano',
      status = CASE WHEN status != 'atendimento' THEN 'atendimento' ELSE status END
    WHERE id = ?
  `).run(conversaId);

  return obterConversa(conversaId);
}

/** Sinaliza "digitando…" pro contato (a equipe deve chamar isso no maximo a cada poucos segundos). */
async function enviarDigitando(conversaId) {
  if (!client || estado !== 'conectado') return { ok: false };
  const conversa = getDb().prepare('SELECT wa_chat_id FROM conversas_whatsapp WHERE id = ?').get(conversaId);
  if (!conversa) return { ok: false };
  try {
    const chat = await client.getChatById(conversa.wa_chat_id);
    await chat.sendStateTyping();
  } catch (e) {
    console.error('[whatsapp] erro ao enviar indicador de digitando:', descreverErro(e));
  }
  return { ok: true };
}

// ============================== Respostas rapidas ==============================

function listarRespostasRapidas() {
  return getDb().prepare('SELECT * FROM respostas_rapidas_whatsapp ORDER BY atalho').all();
}

function criarRespostaRapida(dados) {
  const db = getDb();
  const atalho = (dados.atalho || '').trim().toLowerCase().replace(/^\//, '');
  const conteudo = (dados.conteudo || '').trim();
  if (!atalho) throw new AppError('Informe o atalho.');
  if (!conteudo) throw new AppError('Informe o conteúdo da resposta.');
  try {
    const info = db.prepare('INSERT INTO respostas_rapidas_whatsapp (atalho, titulo, conteudo) VALUES (?, ?, ?)')
      .run(atalho, dados.titulo || null, conteudo);
    return db.prepare('SELECT * FROM respostas_rapidas_whatsapp WHERE id = ?').get(info.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new AppError('Já existe uma resposta rápida com esse atalho.');
    throw e;
  }
}

function atualizarRespostaRapida(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM respostas_rapidas_whatsapp WHERE id = ?').get(id);
  if (!atual) throw new AppError('Resposta rápida não encontrada.', 404);
  const atalho = dados.atalho !== undefined ? (dados.atalho || '').trim().toLowerCase().replace(/^\//, '') : atual.atalho;
  const conteudo = dados.conteudo !== undefined ? (dados.conteudo || '').trim() : atual.conteudo;
  if (!atalho) throw new AppError('Informe o atalho.');
  if (!conteudo) throw new AppError('Informe o conteúdo da resposta.');
  try {
    db.prepare('UPDATE respostas_rapidas_whatsapp SET atalho=?, titulo=?, conteudo=?, ativo=? WHERE id=?').run(
      atalho,
      dados.titulo !== undefined ? dados.titulo : atual.titulo,
      conteudo,
      dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo,
      id
    );
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new AppError('Já existe uma resposta rápida com esse atalho.');
    throw e;
  }
  return db.prepare('SELECT * FROM respostas_rapidas_whatsapp WHERE id = ?').get(id);
}

function excluirRespostaRapida(id) {
  getDb().prepare('DELETE FROM respostas_rapidas_whatsapp WHERE id = ?').run(id);
  return { ok: true };
}

// ------------------------- apenas para testes automatizados -------------------------
function _definirClienteParaTeste(fakeClient, fakeEstado) {
  client = fakeClient;
  estado = fakeEstado || 'conectado';
}

module.exports = {
  iniciar, desconectar, status,
  listarConversas, obterConversa, atualizarStatusConversa, atribuirAtendente, marcarLida, enviarTexto, iniciarConversa,
  iniciarAtendimento, alternarModoConversa, finalizarConversa, enviarMidia, enviarDigitando,
  listarContatos, obterContato, atualizarContato,
  tratarMensagemRecebida,
  obterConfigBot, salvarConfigBot, listarRegrasBot, criarRegraBot, atualizarRegraBot, excluirRegraBot,
  listarRespostasRapidas, criarRespostaRapida, atualizarRespostaRapida, excluirRespostaRapida,
  _definirClienteParaTeste,
};
