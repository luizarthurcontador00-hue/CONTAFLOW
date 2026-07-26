'use strict';

/**
 * Lembretes soltos: titulo, data e um check de concluido. Vencidos/de hoje
 * aparecem destacados aqui e tambem viram um aviso no topo do sistema
 * (ver app.js / atualizarAvisoLembretes).
 */
window.PaginaLembretes = (function () {
  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce"></div>
        <button class="btn" id="lb-novo">+ Novo lembrete</button>
      </div>
      <div class="card"><div id="lb-lista">Carregando…</div></div>`;
    container.querySelector('#lb-novo').addEventListener('click', () => formLembrete());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('lb-lista');
    let itens;
    try { itens = await API.get('/api/lembretes?incluir_concluidos=1'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    if (!itens.length) { alvo.innerHTML = '<p class="muted">Nenhum lembrete cadastrado.</p>'; return; }

    const hoje = new Date().toISOString().slice(0, 10);
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th style="width:34px"></th><th>Título</th><th>Data</th><th>Situação</th><th></th></tr></thead>
      <tbody>${itens.map((l) => {
        const vencido = !l.concluido && l.data_lembrete < hoje;
        const hojeMesmo = !l.concluido && l.data_lembrete === hoje;
        return `<tr style="${l.concluido ? 'opacity:.55' : ''}">
        <td><input type="checkbox" data-toggle="${l.id}" ${l.concluido ? 'checked' : ''}></td>
        <td>${UI.escapar(l.titulo)}${l.descricao ? `<div class="dica">${UI.escapar(l.descricao)}</div>` : ''}</td>
        <td>${l.data_lembrete}</td>
        <td>${l.concluido ? '<span class="badge badge--ok">Concluído</span>' : (vencido ? '<span class="badge badge--erro">Vencido</span>' : (hojeMesmo ? '<span class="badge badge--alerta">Hoje</span>' : '<span class="badge badge--muted">Agendado</span>'))}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn--secundario" data-editar="${l.id}">Editar</button>
          <button class="btn btn--secundario" data-excluir="${l.id}">✕</button>
        </td>
      </tr>`;
      }).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-toggle]').forEach((chk) => chk.addEventListener('change', async () => {
      try { await API.put(`/api/lembretes/${chk.dataset.toggle}`, { concluido: chk.checked }); await listar(); if (window.__atualizarAvisoLembretes) window.__atualizarAvisoLembretes(); }
      catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
      formLembrete(itens.find((l) => l.id === Number(b.dataset.editar)));
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir este lembrete?', { titulo: 'Excluir lembrete', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/lembretes/${b.dataset.excluir}`); UI.sucesso('Lembrete excluído.'); await listar(); if (window.__atualizarAvisoLembretes) window.__atualizarAvisoLembretes(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formLembrete(l) {
    const ehEdicao = !!l;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar lembrete' : 'Novo lembrete', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Título *</label><input id="lb-titulo" value="${UI.escapar(l ? l.titulo : '')}" /></div>
        <div class="campo mt-16"><label>Data *</label><input id="lb-data" type="date" value="${l ? l.data_lembrete : new Date().toISOString().slice(0, 10)}" /></div>
        <div class="campo mt-16"><label>Descrição</label><textarea id="lb-desc">${UI.escapar(l && l.descricao ? l.descricao : '')}</textarea></div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const dados = {
          titulo: el.querySelector('#lb-titulo').value,
          data_lembrete: el.querySelector('#lb-data').value,
          descricao: el.querySelector('#lb-desc').value,
        };
        try {
          if (ehEdicao) await API.put(`/api/lembretes/${l.id}`, dados);
          else await API.post('/api/lembretes', dados);
          UI.sucesso(ehEdicao ? 'Lembrete atualizado.' : 'Lembrete criado.');
          await listar();
          if (window.__atualizarAvisoLembretes) window.__atualizarAvisoLembretes();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Lembretes', render };
})();
