'use strict';

/**
 * Sincronizacao (somente envio) da Agenda do Contaflow para o Google Agenda
 * do usuario. Fluxo OAuth "loopback" (RFC 8252): abre o navegador padrao do
 * sistema para o usuario logar/autorizar no Google, e recebe o retorno num
 * servidor HTTP temporario em 127.0.0.1 numa porta livre — nenhuma porta
 * fixa precisa ser cadastrada no Google Cloud Console.
 *
 * As credenciais (Client ID/Secret) sao geradas por quem distribui o
 * sistema, no Google Cloud Console (APIs & Services > Credenciais > Criar
 * credenciais > ID do cliente OAuth > tipo "App para computador"). Elas
 * identificam o APLICATIVO perante o Google, nao dao acesso a nada sozinhas
 * — quem autoriza (ou revoga) o acesso a agenda e sempre o proprio usuario,
 * na tela de consentimento do Google.
 *
 * So sincroniza agendamentos -> Google (nunca traz eventos criados direto
 * no Google de volta para o sistema), para evitar conflito de edicao nos
 * dois lados. Falhas de sincronizacao nunca travam a Agenda local: ficam
 * so registradas em "google_ultimo_erro" para exibir em Configuracoes.
 */

const http = require('http');
const { URL } = require('url');
const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

const ESCOPOS = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const CHAVES = [
  'google_client_id', 'google_client_secret', 'google_refresh_token',
  'google_access_token', 'google_token_expira_em', 'google_email',
  'google_ativo', 'google_ultimo_erro',
];

function lerConfig() {
  const db = getDb();
  const linhas = db.prepare(`SELECT chave, valor FROM config WHERE chave IN (${CHAVES.map(() => '?').join(',')})`).all(...CHAVES);
  const obj = {};
  linhas.forEach((l) => { obj[l.chave] = l.valor; });
  return obj;
}

function salvar(chave, valor) {
  getDb().prepare(
    'INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor'
  ).run(chave, valor == null ? '' : String(valor));
}

function status() {
  const cfg = lerConfig();
  return {
    configurado: !!(cfg.google_client_id && cfg.google_client_secret),
    conectado: !!cfg.google_refresh_token,
    ativo: cfg.google_ativo === '1',
    email: cfg.google_email || null,
    ultimoErro: cfg.google_ultimo_erro || null,
  };
}

function salvarCredenciais({ client_id, client_secret }) {
  const id = (client_id || '').trim();
  const secret = (client_secret || '').trim();
  if (!id || !secret) throw new AppError('Informe o Client ID e o Client Secret do Google Cloud Console.');
  salvar('google_client_id', id);
  salvar('google_client_secret', secret);
  return status();
}

function desconectar() {
  salvar('google_refresh_token', '');
  salvar('google_access_token', '');
  salvar('google_token_expira_em', '');
  salvar('google_email', '');
  salvar('google_ativo', '0');
  salvar('google_ultimo_erro', '');
  return status();
}

function definirAtivo(ativo) {
  const cfg = lerConfig();
  if (ativo && !cfg.google_refresh_token) throw new AppError('Conecte uma conta Google antes de ativar a sincronização.');
  salvar('google_ativo', ativo ? '1' : '0');
  return status();
}

/** Abre a URL no navegador padrao do sistema (fora da janela do Electron). */
function abrirNavegador(url) {
  try {
    // eslint-disable-next-line global-require
    const { shell } = require('electron');
    shell.openExternal(url);
  } catch (_) {
    // Rodando so o backend (sem Electron, ex.: "npm run server") - nada a abrir.
  }
}

/**
 * Inicia o fluxo de autorizacao: sobe um servidor temporario em 127.0.0.1,
 * abre o navegador para o usuario logar/autorizar no Google, e resolve
 * assim que o Google redirecionar de volta com o codigo (ou rejeita apos
 * 5 minutos sem resposta, ou se o usuario cancelar/negar no Google).
 */
function conectar() {
  const cfg = lerConfig();
  if (!cfg.google_client_id || !cfg.google_client_secret) {
    throw new AppError('Cadastre o Client ID e o Client Secret do Google antes de conectar.');
  }

  return new Promise((resolve, reject) => {
    let finalizado = false;
    const servidor = http.createServer((req, res) => {
      const urlReq = new URL(req.url, 'http://127.0.0.1');
      if (urlReq.pathname !== '/callback') { res.writeHead(404); res.end(); return; }

      const code = urlReq.searchParams.get('code');
      const erro = urlReq.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(erro
        ? '<html><body style="font-family:sans-serif;padding:40px"><h2>Autorização cancelada.</h2><p>Pode fechar esta aba e voltar ao Contaflow.</p></body></html>'
        : '<html><body style="font-family:sans-serif;padding:40px"><h2>✅ Conta Google conectada!</h2><p>Pode fechar esta aba e voltar ao Contaflow.</p></body></html>');

      if (finalizado) return;
      finalizado = true;
      const portaServidor = servidor.address().port;
      servidor.close();

      if (erro || !code) { reject(new AppError('Autorização cancelada no Google.')); return; }

      trocarCodigoPorTokens(code, `http://127.0.0.1:${portaServidor}/callback`, cfg)
        .then(resolve)
        .catch(reject);
    });

    servidor.listen(0, '127.0.0.1', () => {
      const porta = servidor.address().port;
      const redirectUri = `http://127.0.0.1:${porta}/callback`;
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', cfg.google_client_id);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', ESCOPOS);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      abrirNavegador(authUrl.toString());
    });

    setTimeout(() => {
      if (finalizado) return;
      finalizado = true;
      try { servidor.close(); } catch (_) { /* ja fechado */ }
      reject(new AppError('Tempo esgotado esperando a autorização no navegador. Tente novamente.'));
    }, 5 * 60 * 1000);
  });
}

async function trocarCodigoPorTokens(code, redirectUri, cfg) {
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code, client_id: cfg.google_client_id, client_secret: cfg.google_client_secret,
      redirect_uri: redirectUri, grant_type: 'authorization_code',
    }),
  });
  const dados = await resp.json();
  if (!resp.ok) throw new AppError('Google recusou a autorização: ' + (dados.error_description || dados.error || resp.status));

  salvar('google_refresh_token', dados.refresh_token || '');
  salvar('google_access_token', dados.access_token || '');
  salvar('google_token_expira_em', String(Date.now() + (Number(dados.expires_in || 3600) * 1000)));
  salvar('google_ativo', '1');
  salvar('google_ultimo_erro', '');

  try {
    const infoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${dados.access_token}` },
    });
    const info = await infoResp.json();
    if (info && info.email) salvar('google_email', info.email);
  } catch (_) { /* nao essencial - so serve pra exibir qual conta esta conectada */ }

  return status();
}

/** Garante um access_token valido, renovando via refresh_token quando preciso. */
async function obterAccessTokenValido() {
  const cfg = lerConfig();
  if (!cfg.google_refresh_token) throw new AppError('Nenhuma conta Google conectada.');

  const expiraEm = Number(cfg.google_token_expira_em || 0);
  if (cfg.google_access_token && Date.now() < expiraEm - 60000) return cfg.google_access_token;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.google_client_id, client_secret: cfg.google_client_secret,
      refresh_token: cfg.google_refresh_token, grant_type: 'refresh_token',
    }),
  });
  const dados = await resp.json();
  if (!resp.ok) {
    // refresh_token revogado/expirado (ex.: usuario removeu o acesso no Google) - desliga a sincronizacao.
    salvar('google_ultimo_erro', 'A conexão com o Google expirou ou foi revogada. Reconecte em Configurações.');
    salvar('google_ativo', '0');
    throw new AppError('Conexão com o Google expirou. Reconecte em Configurações.');
  }
  salvar('google_access_token', dados.access_token);
  salvar('google_token_expira_em', String(Date.now() + (Number(dados.expires_in || 3600) * 1000)));
  return dados.access_token;
}

function somarMeiaHora(hora) {
  const [h, m] = String(hora).split(':').map(Number);
  const total = h * 60 + m + 30;
  return `${String(Math.floor((total % 1440) / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function corpoEvento(a) {
  return {
    summary: `${a.servico_nome || 'Atendimento'} - ${a.cliente_nome || a.cliente_cadastro || 'Cliente'}`,
    description: [
      a.observacao,
      a.telefone ? `Telefone: ${a.telefone}` : null,
      a.valor ? `Valor: R$ ${Number(a.valor).toFixed(2)}` : null,
    ].filter(Boolean).join('\n') || undefined,
    start: { dateTime: `${a.data}T${a.hora_inicio}:00` },
    end: { dateTime: `${a.data}T${a.hora_fim || somarMeiaHora(a.hora_inicio)}:00` },
  };
}

async function chamarApi(metodo, caminho, corpo) {
  const token = await obterAccessTokenValido();
  const resp = await fetch(`https://www.googleapis.com/calendar/v3${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  if (resp.status === 204 || resp.status === 404) return null; // DELETE ok, ou evento ja nao existia no Google
  const dados = await resp.json().catch(() => null);
  if (!resp.ok) throw new AppError((dados && dados.error && dados.error.message) || `Erro do Google Agenda (${resp.status})`);
  return dados;
}

function estaAtivo() {
  const cfg = lerConfig();
  return cfg.google_ativo === '1' && !!cfg.google_refresh_token;
}

/**
 * Cria/atualiza/remove o evento espelhado no Google a partir do estado
 * atual do agendamento no banco. Nunca lanca erro pra quem chamou (so
 * loga e guarda em "google_ultimo_erro") - uma falha do Google nunca pode
 * travar o cadastro/edicao de um agendamento local.
 */
async function sincronizar(agendamentoId) {
  if (!estaAtivo()) return;
  const db = getDb();
  try {
    const a = db.prepare(`
      SELECT ag.*, c.nome AS cliente_cadastro FROM agendamentos ag
      LEFT JOIN clientes c ON c.id = ag.cliente_id WHERE ag.id = ?
    `).get(agendamentoId);
    if (!a) return;

    if (a.status === 'cancelado') {
      if (a.google_event_id) {
        await chamarApi('DELETE', `/calendars/primary/events/${a.google_event_id}`);
        db.prepare('UPDATE agendamentos SET google_event_id = NULL WHERE id = ?').run(a.id);
      }
      return;
    }

    const corpo = corpoEvento(a);
    if (a.google_event_id) {
      await chamarApi('PATCH', `/calendars/primary/events/${a.google_event_id}`, corpo);
    } else {
      const criado = await chamarApi('POST', '/calendars/primary/events', corpo);
      if (criado && criado.id) db.prepare('UPDATE agendamentos SET google_event_id = ? WHERE id = ?').run(criado.id, a.id);
    }
    salvar('google_ultimo_erro', '');
  } catch (e) {
    console.error('[google-agenda] falha ao sincronizar agendamento', agendamentoId, ':', e.message);
    salvar('google_ultimo_erro', e.message);
  }
}

async function excluirEvento(agendamentoId, googleEventId) {
  if (!estaAtivo() || !googleEventId) return;
  try {
    await chamarApi('DELETE', `/calendars/primary/events/${googleEventId}`);
  } catch (e) {
    console.error('[google-agenda] falha ao excluir evento do agendamento', agendamentoId, ':', e.message);
  }
}

/** Dispara a sincronizacao sem bloquear quem chamou (fire-and-forget). */
function sincronizarAsync(agendamentoId) {
  if (!estaAtivo()) return;
  setImmediate(() => { sincronizar(agendamentoId).catch(() => {}); });
}

/** Usado quando o agendamento e excluido de verdade (o registro ja nao existe mais pra reler). */
function excluirEventoAsync(agendamentoId, googleEventId) {
  if (!estaAtivo() || !googleEventId) return;
  setImmediate(() => { excluirEvento(agendamentoId, googleEventId).catch(() => {}); });
}

module.exports = {
  status, salvarCredenciais, desconectar, definirAtivo, conectar,
  sincronizarAsync, excluirEventoAsync,
};
