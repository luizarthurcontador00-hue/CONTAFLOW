'use strict';

/**
 * Utilitarios de interface: toasts, confirmacoes e formatacao.
 */
const UI = (function () {
  let toastTimer = null;

  function toast(mensagem, tipo = 'info') {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = mensagem;
    el.className = 'toast show ' + tipo;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
  }

  function sucesso(m) { toast(m, 'sucesso'); }
  function erro(m) { toast(m, 'erro'); }

  /**
   * Confirmacao para acoes destrutivas. Retorna Promise<boolean>.
   * Usa o modal proprio quando disponivel; cai para confirm nativo se preciso.
   */
  function confirmar(mensagem, opcoes = {}) {
    if (window.Modal && Modal.confirmar) {
      return Modal.confirmar({ mensagem, ...opcoes });
    }
    return Promise.resolve(window.confirm(mensagem));
  }

  function moeda(valor) {
    const n = Number(valor || 0);
    return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function numero(valor) {
    return Number(valor || 0).toLocaleString('pt-BR');
  }

  function dataHora(iso) {
    if (!iso) return '';
    // aceita 'YYYY-MM-DD HH:MM:SS' (localtime do SQLite)
    const s = String(iso).replace(' ', 'T');
    const d = new Date(s);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR');
  }

  function escapar(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return { toast, sucesso, erro, confirmar, moeda, numero, dataHora, escapar };
})();
