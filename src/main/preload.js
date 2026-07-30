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
  escolherPasta: () => ipcRenderer.invoke('escolher-pasta'),
  abrirPasta: (caminho) => ipcRenderer.invoke('abrir-pasta', caminho),
  escolherArquivoBackup: () => ipcRenderer.invoke('escolher-arquivo-backup'),
  recarregarJanela: () => ipcRenderer.invoke('recarregar-janela'),
  gerarPdf: (html, nomeSugerido) => ipcRenderer.invoke('gerar-pdf', { html, nomeSugerido }),
  plataforma: process.platform,
});
