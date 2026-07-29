'use strict';

/**
 * Ativacao/licenciamento do sistema: bloqueia o uso ate o computador ter
 * uma chave de licenca valida (emitida pelo dono do sistema para essa
 * maquina especifica). Tudo e' validado no backend local, sem precisar
 * de internet.
 */

const MOTIVO_TEXTO = {
  nao_ativado: 'Este computador ainda não está ativado.',
  chave_invalida: 'A chave de licença salva neste computador é inválida.',
  maquina_diferente: 'Esta licença foi emitida para outro computador.',
  expirada: 'A licença deste computador expirou.',
  erro: 'Não foi possível verificar a licença.',
};

function atualizarBadgeLicenca(st) {
  const badge = document.getElementById('licenca-badge');
  if (!badge || !st) return;
  badge.style.display = '';
  badge.onclick = () => window.__mostrarInfoLicenca();
  if (!st.ativo) {
    badge.textContent = '🔒 Licença inválida';
    badge.className = 'badge badge--erro';
    return;
  }
  if (st.dias_restantes !== null && st.dias_restantes !== undefined && st.dias_restantes <= 15) {
    badge.textContent = `⚠️ Licença vence em ${st.dias_restantes}d`;
    badge.className = 'badge badge--alerta';
  } else {
    badge.textContent = '✅ Licença ativa';
    badge.className = 'badge badge--ok';
  }
}

/** Bloqueia a inicialização do app até a licença deste computador estar ativa. */
window.__verificarLicenca = function () {
  return new Promise((resolve) => {
    function abrirAtivacao(st) {
      const corpo = `
        <p class="dica" style="margin-top:0">${MOTIVO_TEXTO[st.motivo] || 'Ative o sistema para continuar.'}</p>
        ${st.cliente ? `<p class="dica">Licença anterior: <strong>${UI.escapar(st.cliente)}</strong>${st.validade ? ' — válida até ' + st.validade : ''}</p>` : ''}
        <div class="campo">
          <label>ID deste computador</label>
          <div class="flex gap-12" style="align-items:center">
            <input id="lic-maquina" readonly value="${UI.escapar(st.machine_id)}" style="font-family:monospace;flex:1" />
            <button type="button" class="btn btn--secundario" id="lic-copiar">Copiar</button>
          </div>
          <p class="dica">Envie esse código para quem te vendeu o sistema e peça a chave de ativação.</p>
        </div>
        <div class="campo mt-16">
          <label>Chave de ativação</label>
          <textarea id="lic-chave" rows="4" placeholder="Cole aqui a chave que você recebeu"></textarea>
        </div>`;
      Modal.abrir({
        titulo: '🔒 Ativação necessária', tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Ativar',
        aoAbrir: (el) => {
          // Ativacao e' obrigatoria: sem botao de cancelar/fechar.
          const cancelar = el.querySelector('.modal__foot .btn--secundario');
          if (cancelar) cancelar.style.display = 'none';
          const fechar = el.querySelector('[data-fechar].modal__fechar');
          if (fechar) fechar.style.display = 'none';
          el.querySelector('#lic-copiar').addEventListener('click', () => {
            navigator.clipboard.writeText(st.machine_id).then(() => UI.sucesso('ID copiado.')).catch(() => {});
          });
        },
        aoConfirmar: async (el) => {
          const chave = el.querySelector('#lic-chave').value.trim();
          if (!chave) { UI.erro('Cole a chave de ativação.'); return false; }
          try {
            const novo = await API.post('/api/licenca/ativar', { chave });
            atualizarBadgeLicenca(novo);
            resolve(novo);
          } catch (e) { UI.erro(e.message); return false; }
        },
      });
    }

    async function checar() {
      let st;
      try { st = await API.get('/api/licenca/status'); }
      catch (_) { st = { ativo: false, motivo: 'erro', machine_id: '—' }; }
      if (st.ativo) { atualizarBadgeLicenca(st); resolve(st); return; }
      abrirAtivacao(st);
    }
    checar();
  });
};

/** Consulta/renova a licença (clique no badge, disponível mesmo já ativo). */
window.__mostrarInfoLicenca = async function () {
  let st;
  try { st = await API.get('/api/licenca/status'); } catch (e) { UI.erro(e.message); return; }
  const corpo = `
    <div class="campo"><label>Cliente</label><input readonly value="${UI.escapar(st.cliente || '—')}" /></div>
    <div class="form-grid mt-16">
      <div class="campo"><label>Válida até</label><input readonly value="${st.validade || '—'}" /></div>
      <div class="campo"><label>Dias restantes</label><input readonly value="${st.dias_restantes ?? '—'}" /></div>
    </div>
    <div class="campo mt-16">
      <label>ID deste computador</label>
      <div class="flex gap-12" style="align-items:center">
        <input id="lic2-maquina" readonly value="${UI.escapar(st.machine_id)}" style="font-family:monospace;flex:1" />
        <button type="button" class="btn btn--secundario" id="lic2-copiar">Copiar</button>
      </div>
    </div>
    <div class="campo mt-16">
      <label>Renovar / trocar chave</label>
      <textarea id="lic2-chave" rows="3" placeholder="Cole aqui uma nova chave de ativação, se tiver"></textarea>
    </div>`;
  Modal.abrir({
    titulo: 'Licença do sistema', tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Salvar nova chave',
    aoAbrir: (el) => {
      el.querySelector('#lic2-copiar').addEventListener('click', () => {
        navigator.clipboard.writeText(st.machine_id).then(() => UI.sucesso('ID copiado.')).catch(() => {});
      });
    },
    aoConfirmar: async (el) => {
      const chave = el.querySelector('#lic2-chave').value.trim();
      if (!chave) { UI.erro('Cole a nova chave de ativação (ou cancele se só queria consultar).'); return false; }
      try {
        const novo = await API.post('/api/licenca/ativar', { chave });
        atualizarBadgeLicenca(novo);
        UI.sucesso('Licença atualizada.');
      } catch (e) { UI.erro(e.message); return false; }
    },
  });
};
