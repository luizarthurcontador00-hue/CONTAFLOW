'use strict';

/**
 * Tarefas com acompanhamento de execucao: quadro Kanban pendente -> em
 * andamento -> concluida, com responsavel opcional (reaproveita o cadastro
 * de profissionais) e prazo.
 */
window.PaginaTarefas = (function () {
  let tarefas = [];
  let responsaveis = [];

  const COLUNAS = [
    { status: 'pendente', titulo: 'Pendente', proximo: 'andamento', rotuloAvancar: 'Iniciar →' },
    { status: 'andamento', titulo: 'Em andamento', proximo: 'concluida', rotuloAvancar: 'Concluir →' },
    { status: 'concluida', titulo: 'Concluída', proximo: null, rotuloAvancar: null },
  ];

  async function render(container) {
    responsaveis = await API.get('/api/agenda/profissionais').catch(() => []);
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce"></div>
        <button class="btn" id="tf-novo">+ Nova tarefa</button>
      </div>
      <div class="patio-kanban" id="tf-kanban"></div>`;
    container.querySelector('#tf-novo').addEventListener('click', () => formTarefa());
    await listar();
  }

  async function listar() {
    tarefas = await API.get('/api/tarefas').catch(() => []);
    renderKanban();
  }

  function renderKanban() {
    const alvo = document.getElementById('tf-kanban');
    if (!alvo) return;
    const hoje = new Date().toISOString().slice(0, 10);
    alvo.innerHTML = COLUNAS.map((col) => {
      const itens = tarefas.filter((t) => t.status === col.status);
      return `<div class="patio-coluna">
        <div class="patio-coluna__titulo">${col.titulo} <span class="badge badge--muted">${itens.length}</span></div>
        <div class="patio-coluna__cards">${itens.length ? itens.map((t) => cardTarefa(t, col, hoje)).join('') : '<div class="patio-vazio">Vazio</div>'}</div>
      </div>`;
    }).join('');

    alvo.querySelectorAll('[data-ver]').forEach((c) => c.addEventListener('click', () => formTarefa(tarefas.find((t) => t.id === Number(c.dataset.ver)))));
    alvo.querySelectorAll('[data-avancar]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { await API.put(`/api/tarefas/${b.dataset.avancar}`, { status: b.dataset.para }); await listar(); }
      catch (err) { UI.erro(err.message); }
    }));
  }

  function cardTarefa(t, col, hoje) {
    const atrasada = col.status !== 'concluida' && t.prazo && t.prazo < hoje;
    return `<div class="patio-card" data-ver="${t.id}">
      <div class="patio-card__num">#${t.id}${t.prazo ? ` · prazo ${t.prazo}${atrasada ? ' ⚠️' : ''}` : ''}</div>
      <div class="patio-card__cliente">${UI.escapar(t.titulo)}</div>
      ${t.responsavel_nome ? `<div class="patio-card__resp">${t.responsavel_cor ? `<span class="cm-cor" style="background:${t.responsavel_cor}"></span> ` : ''}${UI.escapar(t.responsavel_nome)}</div>` : ''}
      ${col.proximo ? `<div class="patio-card__acao"><button class="btn btn--secundario" data-avancar="${t.id}" data-para="${col.proximo}">${col.rotuloAvancar}</button></div>` : ''}
    </div>`;
  }

  function formTarefa(t) {
    const ehEdicao = !!t;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar tarefa' : 'Nova tarefa', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Título *</label><input id="tf-titulo" value="${UI.escapar(t ? t.titulo : '')}" /></div>
        <div class="campo mt-16"><label>Descrição</label><textarea id="tf-desc">${UI.escapar(t && t.descricao ? t.descricao : '')}</textarea></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Responsável</label><select id="tf-resp"><option value="">— sem responsável —</option>${responsaveis.map((r) => `<option value="${r.id}" ${t && String(t.responsavel_id) === String(r.id) ? 'selected' : ''}>${UI.escapar(r.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Prazo</label><input id="tf-prazo" type="date" value="${t && t.prazo ? t.prazo : ''}" /></div>
        </div>
        ${ehEdicao ? `<div class="campo mt-16"><label>Status</label>
          <select id="tf-status">${COLUNAS.map((c) => `<option value="${c.status}" ${t.status === c.status ? 'selected' : ''}>${c.titulo}</option>`).join('')}</select></div>` : ''}
        ${ehEdicao ? `<div class="mt-16"><button type="button" class="btn btn--perigo" id="tf-excluir">Excluir tarefa</button></div>` : ''}`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        const btn = el.querySelector('#tf-excluir');
        if (btn) btn.addEventListener('click', async () => {
          const ok = await UI.confirmar('Excluir esta tarefa?', { titulo: 'Excluir tarefa', textoConfirmar: 'Excluir' });
          if (!ok) return;
          try { await API.del(`/api/tarefas/${t.id}`); el.remove(); UI.sucesso('Tarefa excluída.'); await listar(); }
          catch (e) { UI.erro(e.message); }
        });
      },
      aoConfirmar: async (el) => {
        const dados = {
          titulo: el.querySelector('#tf-titulo').value,
          descricao: el.querySelector('#tf-desc').value,
          responsavel_id: el.querySelector('#tf-resp').value || null,
          prazo: el.querySelector('#tf-prazo').value || null,
        };
        const statusSel = el.querySelector('#tf-status');
        if (statusSel) dados.status = statusSel.value;
        try {
          if (ehEdicao) await API.put(`/api/tarefas/${t.id}`, dados);
          else await API.post('/api/tarefas', dados);
          UI.sucesso(ehEdicao ? 'Tarefa atualizada.' : 'Tarefa criada.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Tarefas', render };
})();
