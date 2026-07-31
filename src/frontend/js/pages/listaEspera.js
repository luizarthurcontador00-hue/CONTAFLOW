'use strict';

/**
 * Lista de espera geral: quem procurou o instituto quando ainda não havia
 * turma aberta daquele curso.
 *
 * É captação de aluno praticamente de graça — a pessoa já demonstrou
 * interesse. Quando abre turma nova do curso, ela aparece aqui destacada,
 * pronta para ser chamada e matriculada em dois cliques.
 */
window.PaginaListaEspera = (function () {
  const STATUS = {
    aguardando: ['Aguardando', 'alerta'],
    contatado: ['Contatado', 'muted'],
    matriculado: ['Matriculado', 'ok'],
    desistiu: ['Desistiu', 'muted'],
  };
  let cursos = [];
  const filtro = { curso_id: '', status: 'aguardando' };

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Lista de espera</strong>
          <div class="dica">Quem procurou o instituto e ainda não tem vaga. Ao abrir turma nova, chame quem já estava esperando.</div>
        </div>
        <div class="campo"><label>Curso</label><select id="le-curso"><option value="">Todos</option></select></div>
        <div class="campo"><label>Situação</label>
          <select id="le-status">
            <option value="aguardando">Aguardando</option>
            <option value="">Todas</option>
            <option value="contatado">Contatado</option>
            <option value="matriculado">Matriculado</option>
            <option value="desistiu">Desistiu</option>
          </select></div>
        <button class="btn" id="le-novo">+ Registrar interesse</button>
      </div>
      <div id="le-resumo"></div>
      <div class="card"><div id="le-lista">Carregando…</div></div>`;

    try { cursos = await API.get('/api/cursos'); } catch (_) { cursos = []; }
    const sel = container.querySelector('#le-curso');
    cursos.forEach((c) => sel.insertAdjacentHTML('beforeend', `<option value="${c.id}">${UI.escapar(c.nome)}</option>`));

    sel.addEventListener('change', (e) => { filtro.curso_id = e.target.value; listar(); });
    container.querySelector('#le-status').addEventListener('change', (e) => { filtro.status = e.target.value; listar(); });
    container.querySelector('#le-novo').addEventListener('click', () => formulario(null));

    resumo();
    listar();
  }

  /** Destaca os cursos onde já existe turma aberta — é lá que dá para agir hoje. */
  async function resumo() {
    const alvo = document.getElementById('le-resumo');
    if (!alvo) return;
    let dados = [];
    try { dados = await API.get('/api/lista-espera/resumo'); } catch (_) { return; }
    if (!dados.length) { alvo.innerHTML = ''; return; }

    const comTurma = dados.filter((d) => d.turmas_abertas > 0);
    alvo.innerHTML = `
      <div class="flex gap-12 mb-16" style="flex-wrap:wrap">
        ${dados.map((d) => `
          <div class="card stat" style="min-width:190px;${d.turmas_abertas ? 'border-color:var(--sucesso)' : ''}">
            <span class="stat__label">${UI.escapar(d.curso_nome)}</span>
            <span class="stat__value" style="font-size:22px">${d.aguardando}</span>
            <span class="dica">${d.turmas_abertas
              ? `✅ ${d.turmas_abertas} turma(s) aberta(s) — dá para chamar`
              : 'sem turma aberta ainda'}</span>
          </div>`).join('')}
      </div>
      ${comTurma.length
        ? `<p class="dica mb-16">💡 Há turma aberta em ${comTurma.map((d) => UI.escapar(d.curso_nome)).join(', ')} — vale ligar para quem está na fila antes de divulgar para fora.</p>`
        : ''}`;
  }

  async function listar() {
    const alvo = document.getElementById('le-lista');
    if (!alvo) return;
    let itens = [];
    try {
      const q = new URLSearchParams();
      if (filtro.curso_id) q.set('curso_id', filtro.curso_id);
      if (filtro.status) q.set('status', filtro.status);
      itens = await API.get('/api/lista-espera?' + q.toString());
    } catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (!itens.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Ninguém na lista de espera</h3>
        <p class="dica">Quando alguém procurar um curso que não tem turma aberta, registre aqui em vez de perder o contato.</p></div>`;
      return;
    }

    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Pessoa</th><th>Curso</th><th>Preferência</th><th>Esperando há</th><th>Situação</th><th></th></tr></thead>
        <tbody>
          ${itens.map((i) => {
            const [rot, cor] = STATUS[i.status] || [i.status, 'muted'];
            return `<tr>
              <td><strong>${UI.escapar(i.pessoa_nome || '—')}</strong>
                ${!i.aluno_id ? ' <span class="badge badge--alerta">sem cadastro</span>' : ''}
                <div class="dica">${UI.escapar(i.responsavel_telefone || i.pessoa_telefone || '')}
                  ${i.pessoa_responsavel ? ` · Resp.: ${UI.escapar(i.pessoa_responsavel)}` : ''}</div></td>
              <td>${UI.escapar(i.curso_nome || '—')}</td>
              <td class="dica">${UI.escapar(i.preferencia || '—')}</td>
              <td class="dica">${i.dias_esperando != null ? `${i.dias_esperando} dia(s)` : '—'}</td>
              <td><span class="badge badge--${cor}">${rot}</span></td>
              <td style="text-align:right;white-space:nowrap">
                ${i.status === 'aguardando' || i.status === 'contatado'
                  ? `<button class="btn" data-matricular="${i.id}">Matricular</button>` : ''}
                <button class="btn btn--secundario" data-editar="${i.id}">Editar</button>
                <select data-status="${i.id}" style="max-width:140px">
                  ${Object.entries(STATUS).map(([v, [r]]) => `<option value="${v}" ${i.status === v ? 'selected' : ''}>${r}</option>`).join('')}
                </select>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
      formulario(itens.find((i) => i.id === Number(b.dataset.editar)));
    }));
    alvo.querySelectorAll('[data-matricular]').forEach((b) => b.addEventListener('click', () => {
      matricular(itens.find((i) => i.id === Number(b.dataset.matricular)));
    }));
    alvo.querySelectorAll('[data-status]').forEach((s) => s.addEventListener('change', async () => {
      try {
        await API.post(`/api/lista-espera/${s.dataset.status}/status`, { status: s.value });
        UI.sucesso('Situação atualizada.');
        resumo(); listar();
        if (window.Avisos) Avisos.atualizar();
      } catch (e) { UI.erro(e.message); }
    }));
  }

  /** Matricula direto na turma, sem redigitar nada. */
  async function matricular(item) {
    if (!item.aluno_id) {
      UI.erro('Esta pessoa ainda não tem cadastro. Cadastre-a em Pessoas e depois volte aqui.');
      return;
    }
    let turmas = [];
    try { turmas = await API.get(`/api/turmas?curso_id=${item.curso_id}&status=aberta`); }
    catch (e) { UI.erro(e.message); return; }

    if (!turmas.length) {
      UI.erro('Não há turma aberta deste curso. Crie a turma primeiro em Turmas.');
      return;
    }

    Modal.abrir({
      titulo: `Matricular ${item.pessoa_nome}`,
      textoConfirmar: 'Matricular',
      corpoHTML: `
        <div class="campo"><label>Turma</label>
          <select id="lem-turma">
            ${turmas.map((t) => `<option value="${t.id}">${UI.escapar(t.nome)} — ${t.matriculados}/${t.vagas} vagas</option>`).join('')}
          </select>
          <span class="dica">Se a turma estiver lotada, a pessoa entra na fila de espera daquela turma.</span></div>`,
      aoConfirmar: async (el) => {
        try {
          const r = await API.post(`/api/lista-espera/${item.id}/matricular`, {
            turma_id: el.querySelector('#lem-turma').value,
          });
          UI.sucesso(r.entrou_na_espera
            ? 'Turma lotada: a pessoa entrou na fila de espera da turma.'
            : 'Matriculado! Saiu da lista de espera.');
          resumo(); listar();
          if (window.Avisos) Avisos.atualizar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function formulario(item) {
    const ed = !!item;
    Modal.abrir({
      titulo: ed ? 'Editar interesse' : 'Registrar interesse',
      tamanho: 'modal--grande',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Pessoa já cadastrada</label>
            <input type="search" id="le-busca" placeholder="Buscar por nome (deixe vazio se ainda não tem cadastro)"
              value="${ed && item.aluno_id ? UI.escapar(item.pessoa_nome || '') : ''}" />
            <div id="le-resultados"></div>
            <input type="hidden" id="le-aluno" value="${ed && item.aluno_id ? item.aluno_id : ''}" />
          </div>
          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:12px">
            <label>Ou anote os dados de quem procurou</label>
            <span class="dica">Serve para não perder o contato de quem ainda não é aluno.</span></div>
          <div class="campo"><label>Nome</label>
            <input id="le-nome" value="${ed && !item.aluno_id ? UI.escapar(item.nome || '') : ''}" /></div>
          <div class="campo"><label>Telefone</label>
            <input id="le-tel" value="${ed ? UI.escapar(item.telefone || '') : ''}" /></div>
          <div class="campo"><label>Nome do responsável</label>
            <input id="le-resp" value="${ed ? UI.escapar(item.responsavel_nome || '') : ''}" />
            <span class="dica">Se for criança.</span></div>
          <div class="campo"><label>Curso de interesse *</label>
            <select id="le-curso-f">
              ${cursos.map((c) => `<option value="${c.id}" ${ed && item.curso_id === c.id ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}
            </select></div>
          <div class="campo"><label>Preferência de horário</label>
            <input id="le-pref" value="${ed ? UI.escapar(item.preferencia || '') : ''}" placeholder="Ex.: noite, sábado de manhã" /></div>
          <div class="campo col-2"><label>Observação</label>
            <textarea id="le-obs" rows="2">${ed ? UI.escapar(item.observacao || '') : ''}</textarea></div>
        </div>`,
      aoAbrir: (el) => {
        const busca = el.querySelector('#le-busca');
        let timer = null;
        busca.addEventListener('input', () => {
          el.querySelector('#le-aluno').value = '';
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const termo = busca.value.trim();
            const alvo = el.querySelector('#le-resultados');
            if (!termo) { alvo.innerHTML = ''; return; }
            let pessoas = [];
            try { pessoas = await API.get('/api/clientes?busca=' + encodeURIComponent(termo)); } catch (_) { return; }
            alvo.innerHTML = pessoas.slice(0, 8).map((p) => `
              <div class="dica" style="padding:4px 0;cursor:pointer" data-p="${p.id}" data-n="${UI.escapar(p.nome)}">👤 ${UI.escapar(p.nome)}</div>`).join('')
              || '<span class="dica">Ninguém encontrado — use os campos abaixo.</span>';
            alvo.querySelectorAll('[data-p]').forEach((d) => d.addEventListener('click', () => {
              el.querySelector('#le-aluno').value = d.dataset.p;
              busca.value = d.dataset.n;
              el.querySelector('#le-nome').value = '';
              alvo.innerHTML = '<span class="dica">✅ Pessoa selecionada.</span>';
            }));
          }, 300);
        });
      },
      aoConfirmar: async (el) => {
        const corpo = {
          aluno_id: el.querySelector('#le-aluno').value || null,
          nome: el.querySelector('#le-nome').value,
          telefone: el.querySelector('#le-tel').value,
          responsavel_nome: el.querySelector('#le-resp').value,
          curso_id: el.querySelector('#le-curso-f').value,
          preferencia: el.querySelector('#le-pref').value,
          observacao: el.querySelector('#le-obs').value,
        };
        try {
          if (ed) await API.put(`/api/lista-espera/${item.id}`, corpo);
          else await API.post('/api/lista-espera', corpo);
          UI.sucesso(ed ? 'Interesse atualizado.' : 'Interesse registrado.');
          resumo(); listar();
          if (window.Avisos) Avisos.atualizar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Lista de espera', render };
})();
