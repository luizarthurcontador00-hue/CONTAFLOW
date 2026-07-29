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
    const s = String(iso);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      // Só data, sem hora (ex.: movimento com a data real do pagamento/extrato):
      // monta a data local direto, sem passar por Date() em UTC (evitaria trocar o dia).
      const [a, m, d] = s.split('-').map(Number);
      return new Date(a, m - 1, d).toLocaleDateString('pt-BR');
    }
    // aceita 'YYYY-MM-DD HH:MM:SS' (localtime do SQLite)
    const d2 = new Date(s.replace(' ', 'T'));
    if (isNaN(d2.getTime())) return iso;
    return d2.toLocaleString('pt-BR');
  }

  function escapar(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /**
   * Imprime um documento HTML completo usando um iframe oculto. Funciona no
   * app empacotado (Electron) e no navegador, sem depender de pop-ups
   * (window.open costuma ser bloqueado no Electron, o que gerava o erro
   * "Cannot read properties of null (reading 'document')").
   */
  function imprimir(html) {
    try {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('aria-hidden', 'true');
      iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
      document.body.appendChild(iframe);

      let feito = false;
      const acionarImpressao = () => {
        if (feito) return;
        feito = true;
        try {
          const win = iframe.contentWindow;
          win.focus();
          win.print();
        } catch (e) { erro('Não foi possível abrir a impressão.'); }
        setTimeout(() => { try { iframe.remove(); } catch (_) { /* ok */ } }, 1000);
      };

      const doc = iframe.contentWindow && iframe.contentWindow.document;
      if (!doc) { iframe.remove(); erro('Não foi possível preparar a impressão.'); return; }
      doc.open();
      doc.write(html);
      doc.close();

      // Aguarda o conteúdo (e imagens) carregarem antes de imprimir.
      if (iframe.contentWindow.document.readyState === 'complete') {
        setTimeout(acionarImpressao, 250);
      } else {
        iframe.contentWindow.addEventListener('load', () => setTimeout(acionarImpressao, 250));
        setTimeout(acionarImpressao, 800); // fallback
      }
    } catch (e) {
      erro('Falha ao imprimir: ' + (e && e.message ? e.message : 'erro desconhecido'));
    }
  }

  return { toast, sucesso, erro, confirmar, moeda, numero, dataHora, escapar, imprimir };
})();
