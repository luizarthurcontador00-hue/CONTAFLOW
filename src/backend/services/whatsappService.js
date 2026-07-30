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
let desconectandoManualmente = false; // true quando foi o proprio usuario que clicou em "Desconectar"
let timerReconexao = null;

/**
 * Ja existe uma sessao do WhatsApp salva em disco (LocalAuth) de uma conexao
 * anterior? Usado para decidir se vale a pena conectar sozinho ao ligar o
 * sistema (sem isso, todo mundo que nunca usou o WhatsApp veria uma tentativa
 * de conexao/QR do nada).
 */
function temSessaoSalva() {
  try {
    const itens = fs.readdirSync(paths.whatsappAuthDir);
    return itens.some((nome) => nome.startsWith('session'));
  } catch (_) {
    return false;
  }
}

/** Tenta reconectar sozinho apos uma queda inesperada (nao foi o usuario que desconectou). */
function agendarReconexao() {
  if (timerReconexao) return;
  timerReconexao = setTimeout(() => {
    timerReconexao = null;
    iniciar().catch((e) => console.error('[whatsapp] falha ao tentar reconectar automaticamente:', descreverErro(e)));
  }, 20000);
  if (timerReconexao.unref) timerReconexao.unref();
}

/**
 * Onde fica o Chromium baixado para o Puppeteer (whatsapp-web.js) usar.
 * O .puppeteerrc.cjs manda o Puppeteer BAIXAR em puppeteer-cache/ na hora do
 * "npm install" (pra dar pra empacotar junto no instalador via
 * asarUnpack), mas isso nao garante que o Puppeteer vai OLHAR nesse mesmo
 * lugar quando o app ja instalado roda no PC do cliente — sem isso, ele cai
 * no cache padrao do sistema (%USERPROFILE%\.cache\puppeteer), que nunca foi
 * baixado naquele computador, e da erro "Could not find Chrome".
 */
function resolverDiretorioCachePuppeteer() {
  try {
    // eslint-disable-next-line global-require
    const electron = require('electron');
    const app = electron.app || (electron.remote && electron.remote.app);
    if (app && app.isPackaged) {
      // No app empacotado, puppeteer-cache/ fica fora do asar (asarUnpack).
      return path.join(process.resourcesPath, 'app.asar.unpacked', 'puppeteer-cache');
    }
  } catch (_) {
    // Electron indisponivel (ex.: rodando so o backend com "npm run server").
  }
  return path.join(__dirname, '..', '..', '..', 'puppeteer-cache');
}

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

/**
 * Arquivos de "lock" que o Chrome cria dentro do perfil (userDataDir) pra
 * impedir dois Chromes usando a mesma pasta ao mesmo tempo. Se o programa
 * fechar sem chamar client.destroy() (queda de energia, "Finalizar tarefa"
 * no Gerenciador de Tarefas, crash), esse arquivo fica orfao e todo QUE
 * TENTAR CONECTAR DEPOIS esbarra em "The browser is already running for
 * ...\whatsapp-auth\session" mesmo com nenhum Chrome de verdade aberto.
 * Como so existe um Client por processo aqui, e seguro limpar antes de
 * cada tentativa de conexao nova.
 */
const ARQUIVOS_LOCK_CHROME = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
function limparLockDeSessaoAntiga() {
  const dirSessao = path.join(paths.whatsappAuthDir, 'session');
  ARQUIVOS_LOCK_CHROME.forEach((nome) => {
    try { fs.rmSync(path.join(dirSessao, nome), { force: true }); } catch (_) { /* nao existia - segue */ }
  });
}

/** Inicia a conexao (idempotente: se ja estiver iniciando/conectado, so retorna o status). */
async function iniciar() {
  if (client) return status();

  limparLockDeSessaoAntiga();

  if (!process.env.PUPPETEER_CACHE_DIR) {
    process.env.PUPPETEER_CACHE_DIR = resolverDiretorioCachePuppeteer();
  }

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
  novoClient.on('disconnected', () => {
    estado = 'desconectado'; qrDataUrl = null; client = null;
    if (!desconectandoManualmente) agendarReconexao();
    desconectandoManualmente = false;
  });
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
    if (!desconectandoManualmente) agendarReconexao();
    desconectandoManualmente = false;
  });

  return status();
}

async function desconectar() {
  if (timerReconexao) { clearTimeout(timerReconexao); timerReconexao = null; }
  if (client) {
    desconectandoManualmente = true;
    try { await client.destroy(); } catch (_) { /* segue mesmo se falhar */ }
    desconectandoManualmente = false; // client.destroy() nem sempre dispara o evento "disconnected" pra resetar sozinho
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
 *
 * A partir da 2a tentativa, RECARREGA a mensagem pelo id
 * (client.getMessageById) em vez de insistir no mesmo objeto: o
 * whatsapp-web.js so consegue baixar quando o "mediaStage" interno chega em
 * RESOLVED, e esse estado nao se atualiza no objeto antigo que ja estava em
 * maos — sem recarregar, as tentativas seguintes repetiam o mesmo estado
 * (FETCHING/REUPLOADING) e a midia nunca vinha.
 */
async function baixarMidiaComRetry(msg, tentativas = 6) {
  const espera = [1000, 2000, 3500, 5000, 8000];
  const wamid = msg && msg.id && msg.id._serialized;
  let atual = msg;

  for (let i = 1; i <= tentativas; i++) {
    try {
      const media = await atual.downloadMedia();
      if (media && media.data) return media;
      console.error(`[whatsapp] tentativa ${i}/${tentativas}: midia ainda nao disponivel (o WhatsApp ainda esta sincronizando ou expirou no celular).`);
    } catch (e) {
      console.error(`[whatsapp] tentativa ${i}/${tentativas} de baixar midia falhou:`, descreverErro(e));
    }

    if (i >= tentativas) break;
    await new Promise((r) => setTimeout(r, espera[i - 1] || 8000));

    if (wamid && client) {
      try {
        const recarregada = await client.getMessageById(wamid);
        if (recarregada) atual = recarregada;
      } catch (e) {
        console.error('[whatsapp] nao foi possivel recarregar a mensagem para baixar a midia:', descreverErro(e));
      }
    }
  }
  return null;
}

/**
 * Nova tentativa de baixar a midia de uma mensagem que ficou sem arquivo
 * (botao "tentar de novo" na conversa). Util quando a midia ainda estava
 * sincronizando no celular na hora que a mensagem chegou.
 */
async function rebaixarMidia(mensagemId) {
  if (!client || estado !== 'conectado') throw new AppError('WhatsApp não está conectado. Conecte em Atendimento antes de baixar a mídia.');
  const db = getDb();
  const msgRow = db.prepare('SELECT * FROM mensagens_whatsapp WHERE id = ?').get(mensagemId);
  if (!msgRow) throw new AppError('Mensagem nao encontrada.', 404);
  if (msgRow.arquivo) return obterConversa(msgRow.conversa_id); // ja tem o arquivo, nada a fazer
  if (!msgRow.wa_message_id) throw new AppError('Esta mensagem não tem identificador do WhatsApp, não dá para baixar de novo.');

  let original;
  try {
    original = await client.getMessageById(msgRow.wa_message_id);
  } catch (e) {
    throw new AppError('Não foi possível localizar a mensagem no WhatsApp: ' + descreverErro(e));
  }
  if (!original) throw new AppError('Essa mensagem não está mais disponível no WhatsApp (pode ter sido apagada ou expirado no celular).');

  const media = await baixarMidiaComRetry(original);
  if (!media) {
    throw new AppError('A mídia ainda não pôde ser baixada. Abra a conversa no celular para o WhatsApp sincronizar o arquivo e tente de novo.');
  }

  const arquivo = salvarMidia(media);
  db.prepare('UPDATE mensagens_whatsapp SET arquivo = ?, arquivo_nome_original = COALESCE(?, arquivo_nome_original) WHERE id = ?')
    .run(arquivo, media.filename || null, mensagemId);
  return obterConversa(msgRow.conversa_id);
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

/** Cria o lead no CRM a partir de uma conversa, sob demanda (botao "Criar lead no CRM"). */
function criarLeadDaConversa(conversaId) {
  const db = getDb();
  const conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(conversaId);
  if (!conversa) throw new AppError('Conversa nao encontrada.', 404);
  if (conversa.lead_id) throw new AppError('Esta conversa ja tem um lead vinculado.');
  // eslint-disable-next-line global-require
  const crmService = require('./crmService');
  const lead = crmService.criarLead({ nome: conversa.nome_contato || conversa.telefone, telefone: conversa.telefone, origem: 'whatsapp' });
  db.prepare('UPDATE conversas_whatsapp SET lead_id = ? WHERE id = ?').run(lead.id, conversaId);
  return obterConversa(conversaId);
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

// ============================== Mensagens agendadas ==============================

function listarAgendadas() {
  return getDb().prepare(`
    SELECT a.*, c.nome, c.telefone, c.wa_chat_id
    FROM mensagens_agendadas_whatsapp a JOIN contatos_whatsapp c ON c.id = a.contato_id
    ORDER BY (a.status = 'agendada') DESC, datetime(a.agendado_para) DESC
  `).all();
}

function criarAgendada({ contato_id, texto, agendado_para }) {
  const db = getDb();
  if (!contato_id) throw new AppError('Selecione um contato.');
  const textoLimpo = (texto || '').trim();
  if (!textoLimpo) throw new AppError('Informe a mensagem.');
  if (!agendado_para) throw new AppError('Informe a data e a hora do envio.');
  const info = db.prepare(
    'INSERT INTO mensagens_agendadas_whatsapp (contato_id, texto, agendado_para) VALUES (?, ?, ?)'
  ).run(Number(contato_id), textoLimpo, agendado_para);
  return db.prepare('SELECT * FROM mensagens_agendadas_whatsapp WHERE id = ?').get(info.lastInsertRowid);
}

function cancelarAgendada(id) {
  const db = getDb();
  const info = db.prepare("UPDATE mensagens_agendadas_whatsapp SET status = 'cancelada' WHERE id = ? AND status = 'agendada'").run(id);
  if (!info.changes) throw new AppError('Mensagem agendada não encontrada ou já processada.', 404);
  return { ok: true };
}

function listarRecorrentes() {
  return getDb().prepare(`
    SELECT r.*, c.nome, c.telefone, c.wa_chat_id
    FROM mensagens_recorrentes_whatsapp r JOIN contatos_whatsapp c ON c.id = r.contato_id
    ORDER BY r.dia_mes, r.hora
  `).all();
}

function criarRecorrente({ contato_id, texto, dia_mes, hora }) {
  const db = getDb();
  if (!contato_id) throw new AppError('Selecione um contato.');
  const textoLimpo = (texto || '').trim();
  if (!textoLimpo) throw new AppError('Informe a mensagem.');
  const dia = Number(dia_mes);
  if (!dia || dia < 1 || dia > 31) throw new AppError('Informe um dia do mês válido (1 a 31).');
  const info = db.prepare(
    'INSERT INTO mensagens_recorrentes_whatsapp (contato_id, texto, dia_mes, hora) VALUES (?, ?, ?, ?)'
  ).run(Number(contato_id), textoLimpo, dia, hora || '09:00');
  return db.prepare('SELECT * FROM mensagens_recorrentes_whatsapp WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarRecorrente(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM mensagens_recorrentes_whatsapp WHERE id = ?').get(id);
  if (!atual) throw new AppError('Mensagem recorrente não encontrada.', 404);
  db.prepare('UPDATE mensagens_recorrentes_whatsapp SET texto=?, dia_mes=?, hora=?, ativo=? WHERE id=?').run(
    dados.texto !== undefined ? (dados.texto || '').trim() : atual.texto,
    dados.dia_mes !== undefined ? Number(dados.dia_mes) : atual.dia_mes,
    dados.hora !== undefined ? dados.hora : atual.hora,
    dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo,
    id
  );
  return db.prepare('SELECT * FROM mensagens_recorrentes_whatsapp WHERE id = ?').get(id);
}

function excluirRecorrente(id) {
  getDb().prepare('DELETE FROM mensagens_recorrentes_whatsapp WHERE id = ?').run(id);
  return { ok: true };
}

/** Reaproveita/reabre a conversa do contato e manda a mensagem agendada por ela. */
async function enviarMensagemAgendada(contatoRow, texto) {
  const db = getDb();
  let conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE wa_chat_id = ?').get(contatoRow.wa_chat_id);
  if (!conversa) {
    const info = db.prepare(`
      INSERT INTO conversas_whatsapp (wa_chat_id, nome_contato, telefone, status, modo_atual, contato_id)
      VALUES (?, ?, ?, 'atendimento', 'humano', ?)
    `).run(contatoRow.wa_chat_id, contatoRow.nome, contatoRow.telefone, contatoRow.contato_id || contatoRow.id);
    conversa = db.prepare('SELECT * FROM conversas_whatsapp WHERE id = ?').get(info.lastInsertRowid);
  } else if (conversa.status === 'resolvida') {
    db.prepare(`
      UPDATE conversas_whatsapp SET status='atendimento', modo_atual='humano', comentario_resolucao=NULL, resolvida_em=NULL
      WHERE id=?
    `).run(conversa.id);
  }
  await enviarTexto(conversa.id, texto);
}

/** Roda a cada minuto: dispara mensagens unicas vencidas e recorrentes do dia. */
async function processarAgendadasDevidas() {
  if (!client || estado !== 'conectado') return;
  const db = getDb();
  const agora = new Date().toISOString().slice(0, 19).replace('T', ' ');

  const devidas = db.prepare(`
    SELECT a.*, c.wa_chat_id, c.nome, c.telefone FROM mensagens_agendadas_whatsapp a
    JOIN contatos_whatsapp c ON c.id = a.contato_id
    WHERE a.status = 'agendada' AND a.agendado_para <= ?
  `).all(agora);
  for (const m of devidas) {
    try {
      await enviarMensagemAgendada({ ...m, contato_id: m.contato_id }, m.texto);
      db.prepare("UPDATE mensagens_agendadas_whatsapp SET status='enviada', enviado_em=datetime('now','localtime') WHERE id=?").run(m.id);
    } catch (e) {
      db.prepare("UPDATE mensagens_agendadas_whatsapp SET status='erro', erro=? WHERE id=?").run(descreverErro(e), m.id);
    }
  }

  const hoje = new Date();
  const diaHoje = hoje.getDate();
  const horaHoje = String(hoje.getHours()).padStart(2, '0') + ':' + String(hoje.getMinutes()).padStart(2, '0');
  const dataHojeStr = hoje.toISOString().slice(0, 10);
  const recorrentes = db.prepare(`
    SELECT r.*, c.wa_chat_id, c.nome, c.telefone FROM mensagens_recorrentes_whatsapp r
    JOIN contatos_whatsapp c ON c.id = r.contato_id
    WHERE r.ativo = 1 AND r.dia_mes = ? AND r.hora <= ? AND (r.ultima_execucao IS NULL OR r.ultima_execucao != ?)
  `).all(diaHoje, horaHoje, dataHojeStr);
  for (const r of recorrentes) {
    try {
      await enviarMensagemAgendada({ ...r, contato_id: r.contato_id }, r.texto);
      db.prepare('UPDATE mensagens_recorrentes_whatsapp SET ultima_execucao = ? WHERE id = ?').run(dataHojeStr, r.id);
    } catch (e) {
      console.error('[whatsapp] erro ao enviar mensagem recorrente:', descreverErro(e));
    }
  }
}

let timerAgendador = null;
/** Liga o relogio do agendador (uma vez, no boot do backend). Nao envia nada se o WhatsApp estiver desconectado. */
function iniciarAgendador() {
  if (timerAgendador) return;
  timerAgendador = setInterval(() => {
    processarAgendadasDevidas().catch((e) => console.error('[whatsapp] erro no agendador de mensagens:', descreverErro(e)));
  }, 60000);
  if (timerAgendador.unref) timerAgendador.unref(); // nao mantem o processo vivo so por causa desse timer
}

// ------------------------- apenas para testes automatizados -------------------------
function _definirClienteParaTeste(fakeClient, fakeEstado) {
  client = fakeClient;
  estado = fakeEstado || 'conectado';
}

iniciarAgendador();

module.exports = {
  iniciar, desconectar, status, temSessaoSalva, rebaixarMidia,
  listarConversas, obterConversa, atualizarStatusConversa, atribuirAtendente, marcarLida, enviarTexto, iniciarConversa,
  iniciarAtendimento, alternarModoConversa, finalizarConversa, enviarMidia, enviarDigitando,
  listarContatos, obterContato, atualizarContato, criarLeadDaConversa,
  tratarMensagemRecebida,
  obterConfigBot, salvarConfigBot, listarRegrasBot, criarRegraBot, atualizarRegraBot, excluirRegraBot,
  listarRespostasRapidas, criarRespostaRapida, atualizarRespostaRapida, excluirRespostaRapida,
  listarAgendadas, criarAgendada, cancelarAgendada,
  listarRecorrentes, criarRecorrente, atualizarRecorrente, excluirRecorrente,
  _definirClienteParaTeste, _processarAgendadasAgora: processarAgendadasDevidas,
};
