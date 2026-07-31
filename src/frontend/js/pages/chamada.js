'use strict';

/**
 * Chamada dos encontros das turmas. Abre no dia de hoje, que e como o
 * instrutor usa: chega, abre a aula do dia e marca quem veio.
 */
window.PaginaChamada = (function () {
  const hojeISO = () => new Date().toISOString().slice(0, 10);
  let filtro = { de: hojeISO(), ate: hojeISO(), turma_id: '' };
  let turmas = [];

  async function render(container) {
    // Reseta a cada visita: senao o filtro de turma fica preso na ultima
    // escolha (o select volta a mostrar "Todas" mas a lista continua
    // filtrada por dentro) e a data "de hoje" fica congelada na hora que o
    // app abriu, nao na hora que a tela foi aberta.
    filtro = { de: hojeISO(), ate: hojeISO(), turma_id: '' };
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="campo"><label>De</label><input type="date" id="ch-de" value="${filtro.de}" /></div>
        <div class="campo"><label>Até</label><input type="date" id="ch-ate" value="${filtro.ate}" /></div>
        <div class="campo"><label>Turma</label><select id="ch-turma"><option value="">Todas</option></select></div>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="ch-hoje">Hoje</button>
        <button class="btn btn--secundario" id="ch-risco">⚠️ Alunos em risco</button>
        <button class="btn" id="ch-imprimir">🖨️ Folha para imprimir</button>
      </div>
      <div class="card"><div id="ch-lista">Carregando…</div></div>`;

    try { turmas = await API.get('/api/turmas?status=aberta'); } catch (_) { turmas = []; }
    const sel = container.querySelector('#ch-turma');
    turmas.forEach((t) => sel.insertAdjacentHTML('beforeend', `<option value="${t.id}">${UI.escapar(t.nome)}</option>`));

    container.querySelector('#ch-de').addEventListener('change', (e) => { filtro.de = e.target.value; listar(); });
    container.querySelector('#ch-ate').addEventListener('change', (e) => { filtro.ate = e.target.value; listar(); });
    sel.addEventListener('change', (e) => { filtro.turma_id = e.target.value; listar(); });
    container.querySelector('#ch-hoje').addEventListener('click', () => {
      filtro.de = hojeISO(); filtro.ate = hojeISO();
      container.querySelector('#ch-de').value = filtro.de;
      container.querySelector('#ch-ate').value = filtro.ate;
      listar();
    });
    container.querySelector('#ch-risco').addEventListener('click', alunosEmRisco);
    container.querySelector('#ch-imprimir').addEventListener('click', folhaParaImprimir);

    listar();
  }

  /**
   * Gera a folha em branco do mês para o instrutor levar e preencher a mão.
   * Depois ele (ou a secretaria) digita a chamada aqui no computador.
   */
  function folhaParaImprimir() {
    if (!turmas.length) { UI.erro('Não há turma aberta para gerar a folha.'); return; }
    const mesAtual = new Date().toISOString().slice(0, 7);
    Modal.abrir({
      titulo: 'Folha de chamada para imprimir', tamanho: 'modal--pequeno', textoConfirmar: '🖨️ Gerar PDF',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Sai uma folha por turma, com os alunos nas linhas e as datas das aulas do mês nas colunas —
        para o instrutor levar impressa e marcar à mão. Depois é só digitar a chamada aqui.</p>
        <div class="campo"><label>Turma *</label>
          <select id="fi-turma">
            ${turmas.map((t) => `<option value="${t.id}" ${String(filtro.turma_id) === String(t.id) ? 'selected' : ''}>${UI.escapar(t.nome)}</option>`).join('')}
          </select></div>
        <div class="campo mt-16"><label>Mês *</label>
          <input type="month" id="fi-mes" value="${mesAtual}" /></div>`,
      aoConfirmar: async (el) => {
        const turmaId = el.querySelector('#fi-turma').value;
        const mes = el.querySelector('#fi-mes').value;
        if (!turmaId || !mes) { UI.erro('Escolha a turma e o mês.'); return false; }
        await Documentos.folhaDeChamada(turmaId, mes);
      },
    });
  }

  async function listar() {
    const alvo = document.getElementById('ch-lista');
    if (!alvo) return;
    let encontros = [];
    try {
      const q = new URLSearchParams();
      if (filtro.de) q.set('de', filtro.de);
      if (filtro.ate) q.set('ate', filtro.ate);
      if (filtro.turma_id) q.set('turma_id', filtro.turma_id);
      encontros = await API.get('/api/turmas/encontros?' + q.toString());
    } catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (!encontros.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Nenhuma aula neste período</h3>
        <p class="dica">Ajuste as datas ou verifique se há turmas abertas com horários cadastrados.</p></div>`;
      return;
    }

    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Data</th><th>Horário</th><th>Turma</th><th>Instrutor</th><th>Chamada</th><th></th></tr></thead>
        <tbody>
          ${encontros.map((e) => `
            <tr>
              <td>${UI.escapar(UI.data ? UI.data(e.data) : e.data)}</td>
              <td>${UI.escapar(e.hora_inicio)}${e.hora_fim ? '–' + UI.escapar(e.hora_fim) : ''}</td>
              <td>
                <strong>${UI.escapar(e.turma_nome)}</strong>
                <div class="dica">${UI.escapar(e.curso_nome)}</div>
              </td>
              <td class="dica">${UI.escapar(e.instrutor_nome || '—')}</td>
              <td>${e.chamada_registrada
                ? `<span class="badge badge--ok">${e.presentes} presente(s)</span>`
                : '<span class="badge badge--alerta">pendente</span>'}</td>
              <td style="text-align:right">
                <button class="btn ${e.chamada_registrada ? 'btn--secundario' : ''}" data-chamada="${e.id}">
                  ${e.chamada_registrada ? 'Revisar' : 'Fazer chamada'}
                </button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-chamada]').forEach((b) => b.addEventListener('click', () => abrirChamada(Number(b.dataset.chamada))));
  }

  async function abrirChamada(agendamentoId) {
    let folha;
    try { folha = await API.get(`/api/turmas/encontros/${agendamentoId}/chamada`); }
    catch (e) { UI.erro(e.message); return; }

    if (!folha.alunos.length) {
      UI.erro('Esta turma ainda não tem alunos matriculados.');
      return;
    }

    const marcado = {};
    folha.alunos.forEach((a) => { marcado[a.aluno_id] = a.situacao || 'presente'; });

    Modal.abrir({
      titulo: `Chamada — ${folha.turma_nome}`,
      tamanho: 'modal--grande',
      textoConfirmar: 'Salvar chamada',
      corpoHTML: `
        <p class="dica" style="margin-top:0">
          ${UI.escapar(folha.curso_nome)} · ${UI.escapar(folha.data)} às ${UI.escapar(folha.hora_inicio)}
          ${folha.sala ? ' · Sala ' + UI.escapar(folha.sala) : ''}
        </p>

        <div class="campo">
          <label>Quem deu a aula</label>
          <select id="ch-instrutor">
            <option value="">— não informado —</option>
            ${folha.instrutores.map((i) => `<option value="${i.id}" ${folha.profissional_id === i.id ? 'selected' : ''}>${UI.escapar(i.nome)} (${UI.escapar(i.papel)})</option>`).join('')}
          </select>
          <span class="dica">Nem sempre é o titular escalado — é isso que conta as horas de voluntariado.</span>
        </div>

        <div class="flex gap-12 mt-16">
          <button class="btn btn--secundario" type="button" id="ch-todos-presentes">Marcar todos como presentes</button>
        </div>

        <div id="ch-alunos" class="mt-16"></div>`,
      aoAbrir: (el) => {
        function desenhar() {
          el.querySelector('#ch-alunos').innerHTML = `
            <div class="rolagem"><table class="tabela">
              <thead><tr><th>Aluno</th><th style="width:320px">Situação</th></tr></thead>
              <tbody>
                ${folha.alunos.map((a) => `
                  <tr>
                    <td>${UI.escapar(a.aluno_nome)}</td>
                    <td>
                      <div class="flex gap-12" style="flex-wrap:wrap">
                        ${[['presente', 'Presente'], ['falta', 'Falta'], ['justificada', 'Justificada']].map(([v, rot]) => `
                          <label class="flex gap-12" style="align-items:center;cursor:pointer">
                            <input type="radio" name="pres-${a.aluno_id}" value="${v}" ${marcado[a.aluno_id] === v ? 'checked' : ''} />
                            <span>${rot}</span>
                          </label>`).join('')}
                      </div>
                    </td>
                  </tr>`).join('')}
              </tbody>
            </table></div>`;
        }
        desenhar();

        el.addEventListener('change', (ev) => {
          const m = /^pres-(\d+)$/.exec(ev.target.name || '');
          if (m) marcado[Number(m[1])] = ev.target.value;
        });

        el.querySelector('#ch-todos-presentes').addEventListener('click', () => {
          folha.alunos.forEach((a) => { marcado[a.aluno_id] = 'presente'; });
          desenhar();
        });
      },
      aoConfirmar: async (el) => {
        try {
          await API.post(`/api/turmas/encontros/${agendamentoId}/chamada`, {
            profissional_id: el.querySelector('#ch-instrutor').value || null,
            presencas: folha.alunos.map((a) => ({ aluno_id: a.aluno_id, situacao: marcado[a.aluno_id] })),
          });
          UI.sucesso('Chamada registrada.');
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function alunosEmRisco() {
    let lista;
    try { lista = await API.get('/api/turmas/alunos-em-risco?minimo=3'); }
    catch (e) { UI.erro(e.message); return; }

    Modal.abrir({
      titulo: 'Alunos em risco de evasão',
      tamanho: 'modal--grande',
      mostrarConfirmar: false,
      corpoHTML: !lista.length
        ? '<p class="dica">Nenhum aluno com 3 ou mais faltas seguidas. 👏</p>'
        : `<p class="dica" style="margin-top:0">Alunos que faltaram 3 vezes ou mais seguidas. Vale ligar para o responsável antes de perder o aluno.</p>
          <div class="rolagem"><table class="tabela">
            <thead><tr><th>Aluno</th><th>Turma</th><th>Faltas seguidas</th><th>Contato</th></tr></thead>
            <tbody>
              ${lista.map((a) => `
                <tr>
                  <td>${UI.escapar(a.aluno_nome)}</td>
                  <td>${UI.escapar(a.turma_nome)}<div class="dica">${UI.escapar(a.curso_nome)}</div></td>
                  <td><span class="badge badge--erro">${a.faltas_seguidas}</span></td>
                  <td class="dica">
                    ${UI.escapar(a.responsavel_telefone || a.telefone || '—')}
                    ${a.responsavel_nome ? `<div>Resp.: ${UI.escapar(a.responsavel_nome)}</div>` : ''}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table></div>`,
    });
  }

  return { titulo: 'Chamada', render };
})();
