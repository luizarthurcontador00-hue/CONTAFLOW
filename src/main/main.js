'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog, shell, ipcMain, Tray, Menu, nativeImage } = require('electron');
const { startServer } = require('../backend/server');

let mainWindow = null;
let backend = null;
let timerBackup = null;
let tray = null;
let appEncerrando = false; // true so quando o usuario escolhe "Sair" (ou o SO esta fechando de verdade)
let saindo = false; // evita rodar a limpeza de saida duas vezes (tray "Sair" + window-all-closed)
let avisoTrayMostrado = false;

const isDev = process.env.NODE_ENV === 'development';
// Quando o Windows abre o programa sozinho (inicializacao automatica), passa
// esse argumento pra nao aparecer a janela do nada assim que liga o PC — o
// programa ja sobe direto minimizado na bandeja.
const iniciadoOculto = process.argv.includes('--hidden');

// ------------------------- IPC (backup / pastas) -------------------------
ipcMain.handle('escolher-pasta', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolha a pasta para salvar o backup',
    properties: ['openDirectory', 'createDirectory'],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('abrir-pasta', async (_e, caminho) => {
  if (caminho) shell.openPath(caminho);
  return true;
});

// Seleciona um arquivo de backup (.db) para restauracao.
ipcMain.handle('escolher-arquivo-backup', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolha o arquivo de backup (.db) para restaurar',
    properties: ['openFile'],
    filters: [{ name: 'Backup do banco', extensions: ['db'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

// Recarrega a janela (usado apos restaurar um backup).
ipcMain.handle('recarregar-janela', async () => {
  if (mainWindow) mainWindow.webContents.reload();
  return true;
});

// ------------------------- Iniciar com o Windows / bandeja -------------------------
ipcMain.handle('obter-inicializacao-automatica', () => ({
  ativo: app.getLoginItemSettings().openAtLogin,
}));

ipcMain.handle('definir-inicializacao-automatica', (_e, ativar) => {
  app.setLoginItemSettings({
    openAtLogin: !!ativar,
    args: ativar ? ['--hidden'] : [],
  });
  return { ativo: app.getLoginItemSettings().openAtLogin };
});

/**
 * Gera um PDF de verdade (texto selecionavel) a partir de um HTML, usando o
 * motor de PDF nativo do Chromium (webContents.printToPDF) — diferente do
 * window.print() do renderer, que depende da impressora/driver escolhida
 * pelo usuario no Windows (algumas "impressoras PDF" de terceiros rasterizam
 * a pagina como imagem, o que deixa o texto sem poder ser selecionado).
 */
ipcMain.handle('gerar-pdf', async (_e, { html, nomeSugerido }) => {
  const janela = new BrowserWindow({ show: false });
  try {
    // baseURLForDataURL resolve imagens com caminho relativo (ex.: logo da
    // loja, fotos de produto em /uploads/...) contra o backend local —
    // sem isso elas nao carregariam dentro de uma data: URL solta.
    await janela.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html || ''), {
      baseURLForDataURL: backend ? backend.url + '/' : undefined,
    });
    const buffer = await janela.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });

    const resultado = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar PDF',
      defaultPath: nomeSugerido || 'documento.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (resultado.canceled || !resultado.filePath) return { cancelado: true };

    fs.writeFileSync(resultado.filePath, buffer);
    shell.openPath(resultado.filePath);
    return { ok: true, caminho: resultado.filePath };
  } finally {
    janela.destroy();
  }
});

/**
 * Encerra de verdade: desconecta o WhatsApp (soltando o lock do perfil do
 * Chrome direitinho), fecha o backend e sai. Chamado pelo "Sair" da bandeja
 * — o botao "X" da janela normal so minimiza (ver o "close" em criarJanela).
 */
async function sairDeVerdade() {
  if (saindo) return;
  saindo = true;
  appEncerrando = true;
  if (timerBackup) clearInterval(timerBackup);
  try {
    const whatsapp = require('../backend/services/whatsappService');
    await Promise.race([
      whatsapp.desconectar(),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[whatsapp] falha ao desconectar ao fechar o programa:', e && e.message);
  }
  if (backend && backend.server) backend.server.close();
  app.quit();
}

// Icone da bandeja: fica rodando mesmo com a janela fechada/minimizada, pra
// continuar recebendo mensagens do WhatsApp em segundo plano.
function criarTray() {
  try {
    const iconPath = path.join(__dirname, '..', '..', 'build', 'tray-icon.png');
    const icone = nativeImage.createFromPath(iconPath);
    tray = new Tray(icone.isEmpty() ? icone : icone.resize({ width: 16, height: 16 }));
    tray.setToolTip('Gestor de Vendas');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir Gestor de Vendas', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
      { type: 'separator' },
      { label: 'Sair', click: () => sairDeVerdade() },
    ]));
    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.focus();
      else mainWindow.show();
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[tray] nao foi possivel criar o icone da bandeja:', e && e.message);
  }
}

// Executa o backup automatico (se configurado) e agenda verificacoes periodicas.
function agendarBackupAutomatico() {
  const backup = require('../backend/services/backupService');
  const rodar = () => backup.backupAutomaticoSeNecessario(24).catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[backup] falha no backup automatico:', e.message);
  });
  rodar();
  timerBackup = setInterval(rodar, 6 * 60 * 60 * 1000); // verifica a cada 6h
}

async function criarJanela() {
  // Sobe o backend Express embutido em uma porta livre (127.0.0.1).
  backend = await startServer(0);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    title: 'Gestor de Vendas',
    backgroundColor: '#f4f6fb',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Injeta a URL do backend para o frontend saber a porta dinamica.
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('backend-url', backend.url);
  });

  mainWindow.once('ready-to-show', () => { if (!iniciadoOculto) mainWindow.show(); });

  // O "X" da janela so minimiza pra bandeja — o backend/WhatsApp continuam
  // rodando em segundo plano. So fecha de verdade via "Sair" na bandeja.
  mainWindow.on('close', (e) => {
    if (appEncerrando) return;
    // Janela ja escondida e mesmo assim chegou um pedido de fechamento? Nao
    // foi o usuario clicando no "X" (nao da pra clicar no X de uma janela
    // escondida) — foi o instalador, o atualizador ou o Windows desligando.
    // Nesse caso o certo e sair de verdade: senao o instalador nao consegue
    // substituir os arquivos e para em "Feche a janela e clique em Repetir".
    if (!mainWindow.isVisible()) {
      e.preventDefault();
      sairDeVerdade();
      return;
    }
    e.preventDefault();
    mainWindow.hide();
    if (!avisoTrayMostrado && tray && process.platform === 'win32') {
      avisoTrayMostrado = true;
      try {
        tray.displayBalloon({
          title: 'Gestor de Vendas continua rodando',
          content: 'O programa continua em segundo plano (recebendo mensagens do WhatsApp, por exemplo). Clique no ícone da bandeja pra abrir de novo.',
        });
      } catch (_) { /* balloon e so cosmetico */ }
    }
  });

  // Abrir links externos no navegador padrao, nao dentro do app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Links tipo mailto:/tel: (ex.: contato do contador na tela de licenca)
  // abrem no aplicativo padrao do sistema, em vez de tentar navegar a janela.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('mailto:') || url.startsWith('tel:')) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  await mainWindow.loadURL(backend.url);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  agendarBackupAutomatico();
  verificarAtualizacoes();
}

// Formata as notas de versao vindas do GitHub Release (info.releaseNotes do
// electron-updater) para texto simples, pronto pra caixa de dialogo nativa.
function formatarNotasVersao(releaseNotes) {
  if (!releaseNotes) return '';
  const limpar = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();
  if (Array.isArray(releaseNotes)) {
    return releaseNotes.map((r) => `v${r.version}:\n${limpar(r.note)}`).join('\n\n');
  }
  return limpar(releaseNotes);
}

// Verifica atualizacoes no GitHub Releases (apenas no app empacotado).
// Baixa em segundo plano e instala ao fechar o programa; avisa o usuario.
function verificarAtualizacoes() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.on('update-downloaded', (info) => {
      if (!mainWindow) return;
      const novidades = formatarNotasVersao(info.releaseNotes);
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Atualização disponível',
        message: `Uma nova versão (${info.version}) foi baixada.`,
        detail: (novidades ? `O que mudou nesta versão:\n${novidades}\n\n` : '')
          + 'A atualização será instalada ao fechar o programa. Deseja reiniciar agora para atualizar?',
        buttons: ['Reiniciar agora', 'Mais tarde'],
        defaultId: 0,
        cancelId: 1,
      }).then((r) => {
        if (r.response === 0) autoUpdater.quitAndInstall();
      });
    });
    autoUpdater.on('error', (e) => {
      // eslint-disable-next-line no-console
      console.error('[update] erro ao verificar atualizacoes:', e && e.message);
    });
    autoUpdater.checkForUpdates();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[update] indisponivel:', e && e.message);
  }
}

app.whenReady().then(async () => {
  criarTray();
  await criarJanela();
}).catch((err) => {
  dialog.showErrorBox(
    'Erro ao iniciar',
    'Nao foi possivel iniciar o programa.\n\nDetalhes tecnicos: ' + (err && err.message ? err.message : err)
  );
  app.quit();
});

// Garante que qualquer caminho de saida (Cmd+Q no mac, fechamento de sessao
// do Windows etc.) marca "encerrando de verdade" antes das janelas fecharem,
// pra nao ficar preso escondendo a janela em vez de deixar sair.
app.on('before-quit', () => { appEncerrando = true; });

// Windows desligando/reiniciando: nao adianta esconder pra bandeja, a sessao
// esta acabando de qualquer jeito.
app.on('session-end', () => { appEncerrando = true; sairDeVerdade(); });

// Com a janela so minimizando pra bandeja (ver "close" em criarJanela), isso
// so dispara mesmo num encerramento de verdade — serve de rede de seguranca
// pra garantir a limpeza (desconectar WhatsApp, fechar backend) mesmo se
// "Sair" da bandeja nao tiver sido o caminho usado.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') sairDeVerdade();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) criarJanela();
  else if (mainWindow) mainWindow.show();
});
