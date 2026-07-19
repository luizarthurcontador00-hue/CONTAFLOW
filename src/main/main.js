'use strict';

const path = require('path');
const { app, BrowserWindow, dialog, shell } = require('electron');
const { startServer } = require('../backend/server');

let mainWindow = null;
let backend = null;

const isDev = process.env.NODE_ENV === 'development';

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
}

app.whenReady().then(criarJanela).catch((err) => {
  dialog.showErrorBox(
    'Erro ao iniciar',
    'Nao foi possivel iniciar o programa.\n\nDetalhes tecnicos: ' + (err && err.message ? err.message : err)
  );
  app.quit();
});

app.on('window-all-closed', () => {
  if (backend && backend.server) backend.server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) criarJanela();
});
