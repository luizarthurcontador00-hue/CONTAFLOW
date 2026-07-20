'use strict';

const path = require('path');
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

  await mainWindow.loadURL(backend.url);

  if (isDev) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  agendarBackupAutomatico();
  verificarAtualizacoes();
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
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Atualização disponível',
        message: `Uma nova versão (${info.version}) foi baixada.`,
        detail: 'A atualização será instalada ao fechar o programa. Deseja reiniciar agora para atualizar?',
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
