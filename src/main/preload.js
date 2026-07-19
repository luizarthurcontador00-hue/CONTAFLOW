'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Ponte segura entre o processo principal (Electron) e o frontend.
 * Como o backend roda em 127.0.0.1 na mesma origem que a janela, o frontend
 * pode usar fetch('/api/...') diretamente. Ainda assim, expomos utilitarios.
 */
contextBridge.exposeInMainWorld('appDesktop', {
  aoReceberBackendUrl: (callback) => {
    ipcRenderer.on('backend-url', (_event, url) => callback(url));
  },
  plataforma: process.platform,
});
