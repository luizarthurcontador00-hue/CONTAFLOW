'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, dialog, shell, ipcMain } = require('electron');
const { startServer } = require('../backend/server');

let mainWindow = null;
let backend = null;
let timerBackup = null;

const isDev = process.env.NODE_ENV === 'development';

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

  mainWindow.once('ready-to-show', () => mainWindow.show());

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

app.whenReady().then(criarJanela).catch((err) => {
  dialog.showErrorBox(
    'Erro ao iniciar',
    'Nao foi possivel iniciar o programa.\n\nDetalhes tecnicos: ' + (err && err.message ? err.message : err)
  );
  app.quit();
});

app.on('window-all-closed', () => {
  if (timerBackup) clearInterval(timerBackup);
  if (backend && backend.server) backend.server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) criarJanela();
});
