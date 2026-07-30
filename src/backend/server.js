'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');

const paths = require('./paths');
const { runMigrations } = require('./db/migrations');
const { seed } = require('./db/seed');
const { getDb } = require('./db/connection');
const { errorHandler } = require('./utils/errors');

/**
 * Cria e configura a aplicacao Express (backend embutido).
 * Inicializa o banco (migrations + seed) e monta as rotas dos modulos.
 */
function createApp() {
  // Garante banco pronto antes de qualquer rota.
  paths.ensureDirs();
  const info = runMigrations();
  seed();
  // eslint-disable-next-line no-console
  console.log(`[db] schema pronto (v${info.para}) em ${paths.dbPath}`);

  // Gera as contas fixas (recorrentes) pendentes do mes, se houver. Nunca
  // deve impedir o app de subir.
  try {
    // eslint-disable-next-line global-require
    const { gerarContasFixasPendentes } = require('./services/financeiroService');
    const r = gerarContasFixasPendentes();
    if (r.geradas > 0) console.log(`[financeiro] ${r.geradas} conta(s) fixa(s) gerada(s) para o mes.`);
  } catch (e) {
    console.error('[financeiro] falha ao gerar contas fixas do mes:', e.message);
  }

  // Gera as proximas ocorrencias das aulas recorrentes (aula fixa semanal), se houver.
  try {
    // eslint-disable-next-line global-require
    const { gerarOcorrenciasPendentes } = require('./services/agendaService');
    const r = gerarOcorrenciasPendentes();
    if (r.geradas > 0) console.log(`[agenda] ${r.geradas} aula(s) recorrente(s) gerada(s).`);
  } catch (e) {
    console.error('[agenda] falha ao gerar aulas recorrentes:', e.message);
  }

  // Gera os encontros das turmas do instituto no calendario (mesmo espirito
  // das aulas recorrentes: cria so o que falta, sem duplicar).
  try {
    // eslint-disable-next-line global-require
    const { gerarEncontrosPendentes } = require('./services/turmasService');
    const r = gerarEncontrosPendentes();
    if (r.geradas > 0) console.log(`[turmas] ${r.geradas} encontro(s) de turma gerado(s).`);
  } catch (e) {
    console.error('[turmas] falha ao gerar encontros das turmas:', e.message);
  }

  // Reconecta o WhatsApp sozinho ao ligar o sistema, se ja tinha sido
  // conectado antes (sessao salva) — sem isso, o atendimento ficava sempre
  // desconectado ate alguem entrar em Atendimento e clicar em "Conectar".
  // So tenta quando ja existe uma sessao anterior, pra nao forcar QR Code em
  // quem nunca usou o WhatsApp.
  try {
    // eslint-disable-next-line global-require
    const whatsapp = require('./services/whatsappService');
    if (whatsapp.temSessaoSalva()) {
      whatsapp.iniciar().catch((e) => console.error('[whatsapp] falha ao conectar automaticamente:', e.message));
    }
  } catch (e) {
    console.error('[whatsapp] falha ao verificar sessao salva:', e.message);
  }

  const app = express();
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Servir arquivos enviados (fotos de produtos etc.)
  app.use('/uploads', express.static(paths.uploadsDir));

  // ------------------------- Rotas de sistema -------------------------
  app.get('/api/health', (req, res) => {
    res.json({ ok: true, versao: require('../../package.json').version });
  });

  app.get('/api/status', (req, res) => {
    const db = getDb();
    const contar = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
    res.json({
      ok: true,
      banco: paths.dbPath,
      totais: {
        produtos: contar('produtos'),
        categorias: contar('categorias'),
        fornecedores: contar('fornecedores'),
        vendas: contar('vendas'),
        compras: contar('compras'),
      },
    });
  });

  montarRota(app, '/api/licenca', './routes/licenca');

  // Bloqueia o resto da API enquanto a licenca deste computador nao estiver
  // ativa — o front mostra a tela de ativacao antes de deixar usar o resto
  // do sistema (ver /api/licenca/status e /api/licenca/ativar acima).
  app.use('/api', (req, res, next) => {
    if (req.path.startsWith('/licenca') || req.path === '/health') return next();
    // eslint-disable-next-line global-require
    const licenca = require('./services/licencaService');
    const st = licenca.status();
    if (!st.ativo) return res.status(403).json({ erro: 'Licença inválida ou expirada.', licenca: st });
    next();
  });

  // ------------------------- Rotas dos modulos ------------------------
  // (adicionadas por fase — cada arquivo exporta um express.Router)
  montarRota(app, '/api/categorias', './routes/categorias');
  montarRota(app, '/api/fornecedores', './routes/fornecedores');
  montarRota(app, '/api/clientes', './routes/clientes');
  montarRota(app, '/api/config', './routes/config');
  montarRota(app, '/api/produtos', './routes/produtos');
  montarRota(app, '/api/compras', './routes/compras');
  montarRota(app, '/api/pedidos-compra', './routes/pedidosCompra');
  montarRota(app, '/api/vendas', './routes/vendas');
  montarRota(app, '/api/devolucoes', './routes/devolucoes');
  montarRota(app, '/api/sacolas', './routes/sacolas');
  montarRota(app, '/api/caixa', './routes/caixa');
  montarRota(app, '/api/precificacao', './routes/precificacao');
  montarRota(app, '/api/precificacao-avancada', './routes/precAvancada');
  montarRota(app, '/api/financeiro', './routes/financeiro');
  montarRota(app, '/api/conciliacao', './routes/conciliacao');
  montarRota(app, '/api/comissoes', './routes/comissoes');
  montarRota(app, '/api/fiscal', './routes/fiscal');
  montarRota(app, '/api/crm', './routes/crm');
  montarRota(app, '/api/lembretes', './routes/lembretes');
  montarRota(app, '/api/tarefas', './routes/tarefas');
  montarRota(app, '/api/whatsapp', './routes/whatsapp');
  montarRota(app, '/api/ordens', './routes/ordens');
  montarRota(app, '/api/agenda', './routes/agenda');
  montarRota(app, '/api/google-agenda', './routes/googleAgenda');
  montarRota(app, '/api/cursos', './routes/cursos');
  montarRota(app, '/api/instrumentos', './routes/instrumentos');
  montarRota(app, '/api/turmas', './routes/turmas');
  montarRota(app, '/api/arrecadacao', './routes/arrecadacao');
  montarRota(app, '/api/membros', './routes/membros');
  montarRota(app, '/api/dashboard', './routes/dashboard');
  montarRota(app, '/api/relatorios', './routes/relatorios');
  montarRota(app, '/api/backup', './routes/backup');

  // ------------------------- Frontend estatico ------------------------
  const frontendDir = path.join(__dirname, '..', 'frontend');
  app.use(express.static(frontendDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    return res.sendFile(path.join(frontendDir, 'index.html'));
  });

  // Tratamento de erros (sempre por ultimo)
  app.use(errorHandler);

  return app;
}

/**
 * Monta uma rota de modulo se o arquivo existir. Isso permite construir o
 * sistema por fases sem quebrar o servidor quando um modulo ainda nao foi
 * implementado.
 */
function montarRota(app, prefixo, modulo) {
  const arquivo = path.join(__dirname, `${modulo}.js`);
  if (!fs.existsSync(arquivo)) {
    // Modulo ainda nao implementado nesta fase — ignora.
    return;
  }
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const router = require(modulo);
  app.use(prefixo, router);
}

/**
 * Sobe o servidor HTTP em uma porta (0 = porta livre automatica) e resolve
 * com { server, port, url }.
 */
function startServer(port = 0) {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, port: addr.port, url: `http://127.0.0.1:${addr.port}` });
    });
    server.on('error', reject);
  });
}

module.exports = { createApp, startServer };
