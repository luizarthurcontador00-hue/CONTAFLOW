'use strict';

/**
 * Agenda: agendamentos do dia por profissional, com status, faturamento
 * (gera a venda do serviço) e envio de confirmação por WhatsApp.
 * Cadastro da equipe (profissionais) no mesmo módulo.
 */
window.PaginaAgenda = (function () {
  let dia = new Date().toISOString().slice(0, 10);
  let mesAtual = dia.slice(0, 7); // 'YYYY-MM', usado na visão de calendário
  let vista = 'dia'; // 'dia' | 'mes' | 'recorrentes'
  let profissionais = [];
  let clientes = [];
  let servicos = [];
  let aulasRecorrentes = [];
  let filtroProf = '';

  const STATUS = {
    agendado: ['Agendado', 'alerta'], confirmado: ['Confirmado', 'muted'],
    atendido: ['Atendido', 'ok'], cancelado: ['Cancelado', 'muted'], faltou: ['Faltou', 'erro'],
  };
  const FORMAS = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', pix: 'PIX', prazo: 'A prazo' };
  const DIAS_SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  // Rotulos: para o ramo "professor" (aulas particulares), fala a lingua do dia a dia do professor.
  const ehProfessor = () => window.__ramoServico === 'professor';
  // Num instituto sem fins lucrativos a aula nao vira venda: nao ha o que
  // faturar, nem valor ou servico a cobrar do aluno.
  const ehInstituto = () => window.__ramoServico === 'instituto';
  const rCliente = (m) => (ehProfessor() ? (m ? 'Aluno' : 'aluno') : (m ? 'Cliente' : 'cliente'));
  const rServico = (m) => (ehProfessor() ? (m ? 'Matéria' : 'matéria') : (m ? 'Serviço' : 'serviço'));
  const rAula = (m) => (ehProfessor() ? (m ? 'Aula' : 'aula') : (m ? 'Agendamento' : 'agendamento'));

  function badge(s) { const [t, c] = STATUS[s] || [s, 'muted']; return `<span class="badge badge--${c}">${t}</span>`; }
  function mudarDia(delta) {
    const d = new Date(dia + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    dia = d.toISOString().slice(0, 10);
  }
  function diaLabel(iso) {
    const d = new Date(iso + 'T00:00:00');
    const semana = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
    return `${d.toLocaleDateString('pt-BR')} · ${semana[d.getDay()]}`;
  }
  function mesLabel(aaMm) {
    const [a, m] = aaMm.split('-').map(Number);
    const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${nomes[m - 1]} de ${a}`;
  }
  function mudarMes(aaMm, delta) {
    const [a, m] = aaMm.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  async function render(container) {
    [profissionais, clientes, servicos] = await Promise.all([
      API.get('/api/agenda/profissionais').catch(() => []),
      API.get('/api/clientes').catch(() => []),
      API.get('/api/produtos?eh_servico=1').catch(() => []),
    ]);
    await API.post('/api/agenda/aulas-recorrentes/gerar-pendentes', {}).catch(() => {});

    container.innerHTML = `
      <div class="subtabs">
        <button class="subtab ${vista === 'dia' ? 'subtab--ativa' : ''}" data-vista="dia">📋 Dia</button>
        <button class="subtab ${vista === 'mes' ? 'subtab--ativa' : ''}" data-vista="mes">📆 Mês</button>
        <button class="subtab ${vista === 'recorrentes' ? 'subtab--ativa' : ''}" data-vista="recorrentes">🔁 ${rAula(true)} fixa</button>
      </div>
      <div id="ag-corpo"></div>`;
    container.querySelectorAll('[data-vista]').forEach((b) => b.addEventListener('click', () => {
      if (vista === b.dataset.vista) return;
      vista = b.dataset.vista; render(container);
    }));

    if (vista === 'mes') await renderMes();
    else if (vista === 'recorrentes') await renderRecorrentes();
    else await renderDia();
  }

  // ------------------------------ Visão: Dia ------------------------------
  async function renderDia() {
    const alvo = document.getElementById('ag-corpo');
    if (!alvo) return;
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="flex gap-12" style="align-items:center">
          <button class="btn btn--secundario" id="ag-ant">◀</button>
          <strong style="min-width:230px;text-align:center">${diaLabel(dia)}</strong>
          <button class="btn btn--secundario" id="ag-prox">▶</button>
          <input type="date" id="ag-data" value="${dia}" />
          <button class="btn btn--secundario" id="ag-hoje">Hoje</button>
        </div>
        <select id="ag-prof-filtro">
          <option value="">Todos os profissionais</option>
          ${profissionais.map((p) => `<option value="${p.id}" ${String(filtroProf) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
        </select>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="ag-equipe">👥 Equipe</button>
        <button class="btn" id="ag-novo">+ Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()}</button>
      </div>
      <div id="ag-resumo"></div>
      <div id="ag-lista"><div class="card">Carregando…</div></div>`;

    alvo.querySelector('#ag-ant').addEventListener('click', () => { mudarDia(-1); renderDia(); });
    alvo.querySelector('#ag-prox').addEventListener('click', () => { mudarDia(1); renderDia(); });
    alvo.querySelector('#ag-hoje').addEventListener('click', () => { dia = new Date().toISOString().slice(0, 10); renderDia(); });
    alvo.querySelector('#ag-data').addEventListener('change', (e) => { dia = e.target.value || dia; renderDia(); });
    alvo.querySelector('#ag-prof-filtro').addEventListener('change', (e) => { filtroProf = e.target.value; listar(); });
    alvo.querySelector('#ag-equipe').addEventListener('click', gerenciarEquipe);
    alvo.querySelector('#ag-novo').addEventListener('click', () => abrirForm());

    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('ag-lista');
    if (!alvo) return;
    const params = new URLSearchParams({ data: dia });
    if (filtroProf) params.set('profissional_id', filtroProf);
    let itens; let resumo;
    try {
      [itens, resumo] = await Promise.all([
        API.get('/api/agenda?' + params.toString()),
        API.get('/api/agenda/resumo?data=' + dia),
      ]);
    } catch (e) { alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    const res = document.getElementById('ag-resumo');
    if (res) res.innerHTML = `<div class="grid grid--cards mb-16">
      <div class="card stat"><span class="stat__label">${rAula(true)}s do dia</span><span class="stat__value">${resumo.total}</span></div>
      <div class="card stat"><span class="stat__label">Pendentes</span><span class="stat__value" style="color:var(--alerta)">${resumo.pendentes}</span></div>
      <div class="card stat"><span class="stat__label">Atendidos</span><span class="stat__value" style="color:var(--sucesso)">${resumo.atendidos}</span></div>
      <div class="card stat"><span class="stat__label">Previsto no dia</span><span class="stat__value">${UI.moeda(resumo.previsto)}</span></div>
    </div>`;

    if (!itens.length) {
      alvo.innerHTML = `<div class="card vazio">Nenhum${rAula() === 'aula' ? 'a' : ''} ${rAula()} neste dia.
        <div class="mt-16"><button class="btn" onclick="document.getElementById('ag-novo').click()">+ Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()}</button></div></div>`;
      return;
    }

    alvo.innerHTML = `<div class="card"><div class="agenda-lista">
      ${itens.map((a) => {
        const nome = a.cliente_cadastro || a.cliente_nome || `Sem ${rCliente()}`;
        const tel = a.cliente_telefone || a.telefone;
        return `<div class="agenda-item" style="border-left-color:${a.profissional_cor || 'var(--primaria)'}">
          <div class="agenda-item__hora">${UI.escapar(a.hora_inicio)}${a.hora_fim ? `<span class="dica">até ${UI.escapar(a.hora_fim)}</span>` : ''}</div>
          <div class="agenda-item__info">
            <strong>${UI.escapar(nome)}</strong> ${badge(a.status)}${a.venda_id && !ehInstituto() ? ' <span class="badge badge--ok">faturado</span>' : ''}${a.aula_recorrente_id ? ` <span class="badge badge--muted" title="Gerado automaticamente de uma ${rAula()} fixa">🔁 fixa</span>` : ''}
            <div class="dica">${UI.escapar(a.servico_nome || rServico(true))}${a.profissional_nome ? ' · ' + UI.escapar(a.profissional_nome) : ''}${tel ? ' · ' + UI.escapar(tel) : ''}</div>
          </div>
          <div class="agenda-item__valor">${UI.moeda(a.valor)}</div>
          <div class="agenda-item__acoes">
            ${tel ? `<button class="btn btn--secundario" data-zap="${a.id}" title="Enviar confirmação por WhatsApp">💬</button>` : ''}
            <button class="btn btn--secundario" data-editar="${a.id}">Abrir</button>
          </div>
        </div>`;
      }).join('')}
    </div></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => {
      try { abrirDetalhe(await API.get('/api/agenda/' + b.dataset.editar)); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-zap]').forEach((b) => b.addEventListener('click', async () => {
      try { enviarWhatsApp(await API.get('/api/agenda/' + b.dataset.zap)); } catch (e) { UI.erro(e.message); }
    }));
  }

  // ------------------------------ Visão: Mês (calendário) ------------------------------
  async function renderMes() {
    const alvo = document.getElementById('ag-corpo');
    if (!alvo) return;
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="flex gap-12" style="align-items:center">
          <button class="btn btn--secundario" id="ag-mes-ant">◀</button>
          <strong style="min-width:170px;text-align:center">${mesLabel(mesAtual)}</strong>
          <button class="btn btn--secundario" id="ag-mes-prox">▶</button>
          <button class="btn btn--secundario" id="ag-mes-hoje">Hoje</button>
        </div>
        <select id="ag-prof-filtro-mes">
          <option value="">Todos os profissionais</option>
          ${profissionais.map((p) => `<option value="${p.id}" ${String(filtroProf) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
        </select>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="ag-equipe-mes">👥 Equipe</button>
        <button class="btn" id="ag-novo-mes">+ Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()}</button>
      </div>
      <div id="ag-calendario"><div class="card">Carregando…</div></div>`;

    alvo.querySelector('#ag-mes-ant').addEventListener('click', () => { mesAtual = mudarMes(mesAtual, -1); renderMes(); });
    alvo.querySelector('#ag-mes-prox').addEventListener('click', () => { mesAtual = mudarMes(mesAtual, 1); renderMes(); });
    alvo.querySelector('#ag-mes-hoje').addEventListener('click', () => { mesAtual = new Date().toISOString().slice(0, 7); renderMes(); });
    alvo.querySelector('#ag-prof-filtro-mes').addEventListener('change', (e) => { filtroProf = e.target.value; carregarCalendario(); });
    alvo.querySelector('#ag-equipe-mes').addEventListener('click', gerenciarEquipe);
    alvo.querySelector('#ag-novo-mes').addEventListener('click', () => abrirForm());

    await carregarCalendario();
  }

  async function carregarCalendario() {
    const cal = document.getElementById('ag-calendario');
    if (!cal) return;
    const [ano, mes] = mesAtual.split('-').map(Number);
    const ultimoDia = new Date(ano, mes, 0).getDate();
    const params = new URLSearchParams({ inicio: `${mesAtual}-01`, fim: `${mesAtual}-${String(ultimoDia).padStart(2, '0')}` });
    if (filtroProf) params.set('profissional_id', filtroProf);

    let itens;
    try { itens = await API.get('/api/agenda?' + params.toString()); }
    catch (e) { cal.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    const porDia = new Map();
    itens.forEach((a) => {
      if (a.status === 'atendido') return; // ja concluido: some do calendario do mes pra nao poluir (continua no dia e nos relatorios)
      if (!porDia.has(a.data)) porDia.set(a.data, []);
      porDia.get(a.data).push(a);
    });

    const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay(); // 0 = domingo
    const diasNomes = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const hojeISO = new Date().toISOString().slice(0, 10);

    const celulas = [];
    for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
    for (let d = 1; d <= ultimoDia; d++) celulas.push(`${mesAtual}-${String(d).padStart(2, '0')}`);
    while (celulas.length % 7 !== 0) celulas.push(null);

    const MOSTRAR = 3;
    cal.innerHTML = `<div class="cal-grade">
      ${diasNomes.map((n) => `<div class="cal-cabecalho">${n}</div>`).join('')}
      ${celulas.map((iso) => {
        if (!iso) return '<div class="cal-dia cal-dia--vazio"></div>';
        const evs = (porDia.get(iso) || []).slice().sort((a, b) => (a.hora_inicio || '').localeCompare(b.hora_inicio || ''));
        const extras = evs.length - MOSTRAR;
        return `<div class="cal-dia ${iso === hojeISO ? 'cal-dia--hoje' : ''}" data-dia="${iso}">
          <div class="cal-dia__numero">${Number(iso.slice(8, 10))}</div>
          <div class="cal-dia__eventos">
            ${evs.slice(0, MOSTRAR).map((a) => {
              const nome = a.cliente_cadastro || a.cliente_nome || `Sem ${rCliente()}`;
              return `<div class="cal-evento" data-evento="${a.id}" style="background:${a.profissional_cor || 'var(--primaria)'}" title="${UI.escapar(a.hora_inicio + ' — ' + nome)}">${UI.escapar(a.hora_inicio)} ${UI.escapar(nome)}</div>`;
            }).join('')}
            ${extras > 0 ? `<div class="cal-evento cal-evento--mais">+${extras} mais</div>` : ''}
          </div>
        </div>`;
      }).join('')}
    </div>`;

    cal.querySelectorAll('.cal-dia[data-dia]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.closest('[data-evento]')) return;
      dia = el.dataset.dia; vista = 'dia'; render(document.getElementById('view'));
    }));
    cal.querySelectorAll('[data-evento]').forEach((el) => el.addEventListener('click', async (e) => {
      e.stopPropagation();
      try { abrirDetalhe(await API.get('/api/agenda/' + el.dataset.evento)); } catch (err) { UI.erro(err.message); }
    }));
  }

  // ------------------------- Visão: Aulas fixas (recorrentes) -------------------------
  async function renderRecorrentes() {
    const alvo = document.getElementById('ag-corpo');
    if (!alvo) return;
    alvo.innerHTML = `
      <p class="dica mb-16">Cadastre um${rAula() === 'aula' ? 'a' : ''} ${rAula()} fixa que se repete toda semana (ex.: "${rServico(true)} com ${rCliente(true).toLowerCase() === 'aluno' ? 'o aluno' : 'o cliente'} X, toda terça às 15h"). O sistema gera automaticamente as próximas ocorrências na agenda — sem precisar recriar toda semana.</p>
      <div class="barra-ferramentas"><div class="cresce"></div><button class="btn" id="rec-nova">+ Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()} fixa</button></div>
      <div class="card"><div id="rec-lista">Carregando…</div></div>`;
    alvo.querySelector('#rec-nova').addEventListener('click', () => formRecorrente());
    await listarRecorrentes();
  }

  async function listarRecorrentes() {
    const alvo = document.getElementById('rec-lista');
    if (!alvo) return;
    try { aulasRecorrentes = await API.get('/api/agenda/aulas-recorrentes'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!aulasRecorrentes.length) { alvo.innerHTML = `<p class="muted">Nenhum${rAula() === 'aula' ? 'a' : ''} ${rAula()} fixa cadastrada.</p>`; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>${rCliente(true)}</th><th>${rServico(true)}</th><th>Dia/Horário</th><th>Valor</th><th>Status</th><th></th></tr></thead>
      <tbody>${aulasRecorrentes.map((r) => `<tr style="${r.ativa ? '' : 'opacity:.55'}">
        <td>${UI.escapar(r.aluno_cadastro_nome || r.aluno_nome || '—')}</td>
        <td>${UI.escapar(r.materia_nome || '—')}</td>
        <td>${DIAS_SEMANA[r.dia_semana]} · ${UI.escapar(r.hora_inicio)}${r.hora_fim ? ' às ' + UI.escapar(r.hora_fim) : ''}</td>
        <td>${UI.moeda(r.valor)}</td>
        <td>${r.ativa ? '<span class="badge badge--ok">Ativa</span>' : '<span class="badge badge--muted">Pausada</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn--secundario" data-rec-pausar="${r.id}" data-ativa="${r.ativa}">${r.ativa ? 'Pausar' : 'Reativar'}</button>
          <button class="btn btn--secundario" data-rec-editar="${r.id}">Editar</button>
          <button class="btn btn--secundario" data-rec-excluir="${r.id}">✕</button>
        </td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-rec-editar]').forEach((b) => b.addEventListener('click', () => {
      const r = aulasRecorrentes.find((x) => x.id === Number(b.dataset.recEditar));
      formRecorrente(r);
    }));
    alvo.querySelectorAll('[data-rec-pausar]').forEach((b) => b.addEventListener('click', async () => {
      const ativa = b.dataset.ativa === '1';
      try {
        await API.put(`/api/agenda/aulas-recorrentes/${b.dataset.recPausar}`, { ativa: !ativa });
        UI.sucesso(ativa ? `${rAula(true)} fixa pausada.` : `${rAula(true)} fixa reativada.`);
        await listarRecorrentes();
      } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-rec-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar(`Excluir est${rAula() === 'aula' ? 'a' : 'e'} ${rAula()} fixa? As ocorrências já lançadas na agenda não serão apagadas.`, { titulo: `Excluir ${rAula()} fixa`, textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/agenda/aulas-recorrentes/${b.dataset.recExcluir}`); UI.sucesso(`${rAula(true)} fixa excluída.`); await listarRecorrentes(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formRecorrente(r) {
    const ehEdicao = !!r;
    Modal.abrir({
      titulo: ehEdicao ? `Editar ${rAula()} fixa` : `Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()} fixa`, tamanho: 'modal--grande',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo"><label>${rCliente(true)} (cadastrado)</label><select id="rec-aluno">
            <option value="">— avulso —</option>${clientes.map((c) => `<option value="${c.id}" data-tel="${UI.escapar(c.telefone || '')}" ${r && String(r.aluno_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Ou nome do ${rCliente()}</label><input id="rec-aluno-nome" value="${UI.escapar(r ? r.aluno_nome || '' : '')}" placeholder="${rCliente(true)} sem cadastro" /></div>
        </div>
        <div class="form-grid mt-16">
          <div class="campo"><label>${rServico(true)}</label><select id="rec-materia">
            <option value="">— selecione —</option>${servicos.map((s) => `<option value="${s.id}" data-preco="${s.preco_venda}" ${r && String(r.produto_id) === String(s.id) ? 'selected' : ''}>${UI.escapar(s.nome)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Valor (R$)</label><input id="rec-valor" type="number" step="0.01" min="0" value="${r ? r.valor : ''}" /></div>
        </div>
        ${profissionais.length ? `<div class="campo mt-16"><label>Profissional</label><select id="rec-prof">
          <option value="">—</option>${profissionais.map((p) => `<option value="${p.id}" ${r && String(r.profissional_id) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
        </select></div>` : ''}
        <div class="form-grid mt-16">
          <div class="campo"><label>Dia da semana *</label><select id="rec-dia">
            ${DIAS_SEMANA.map((n, i) => `<option value="${i}" ${r ? (r.dia_semana === i ? 'selected' : '') : (i === 1 ? 'selected' : '')}>${n}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Hora início *</label><input id="rec-hora-ini" type="time" value="${r ? r.hora_inicio : '15:00'}" required /></div>
          <div class="campo"><label>Hora fim <span class="dica">(opcional)</span></label><input id="rec-hora-fim" type="time" value="${r && r.hora_fim ? r.hora_fim : ''}" /></div>
        </div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Começa em</label><input id="rec-inicio" type="date" value="${r ? r.data_inicio : new Date().toISOString().slice(0, 10)}" /></div>
          <div class="campo"><label>Até <span class="dica">(opcional — deixe em branco para repetir sem data final)</span></label><input id="rec-fim" type="date" value="${r && r.data_fim ? r.data_fim : ''}" /></div>
        </div>
        <div class="campo mt-16"><label>Telefone (WhatsApp)</label><input id="rec-tel" value="${UI.escapar(r ? r.telefone || '' : '')}" placeholder="Ex.: 11999998888" /></div>
        <div class="campo mt-16"><label>Observação</label><input id="rec-obs" value="${UI.escapar(r ? r.observacao || '' : '')}" /></div>
        <div class="dica mt-16">O sistema gera automaticamente as próximas 8-9 semanas na agenda. Editar aqui não altera ocorrências já lançadas — só as futuras que ainda serão geradas.</div>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        const materia = el.querySelector('#rec-materia');
        const valor = el.querySelector('#rec-valor');
        materia.addEventListener('change', () => {
          const opt = materia.selectedOptions[0];
          if (opt && opt.dataset.preco && !valor.value) valor.value = opt.dataset.preco;
        });
        const aluno = el.querySelector('#rec-aluno');
        aluno.addEventListener('change', () => {
          const opt = aluno.selectedOptions[0];
          const tel = el.querySelector('#rec-tel');
          if (opt && opt.dataset.tel && !tel.value) tel.value = opt.dataset.tel;
        });
      },
      aoConfirmar: async (el) => {
        const dados = {
          aluno_id: el.querySelector('#rec-aluno').value || null,
          aluno_nome: el.querySelector('#rec-aluno-nome').value,
          produto_id: el.querySelector('#rec-materia').value || null,
          valor: el.querySelector('#rec-valor').value,
          profissional_id: el.querySelector('#rec-prof') ? el.querySelector('#rec-prof').value || null : null,
          dia_semana: el.querySelector('#rec-dia').value,
          hora_inicio: el.querySelector('#rec-hora-ini').value,
          hora_fim: el.querySelector('#rec-hora-fim').value || null,
          data_inicio: el.querySelector('#rec-inicio').value || null,
          data_fim: el.querySelector('#rec-fim').value || null,
          telefone: el.querySelector('#rec-tel').value,
          observacao: el.querySelector('#rec-obs').value,
        };
        try {
          if (ehEdicao) await API.put(`/api/agenda/aulas-recorrentes/${r.id}`, dados);
          else await API.post('/api/agenda/aulas-recorrentes', dados);
          UI.sucesso(ehEdicao ? `${rAula(true)} fixa atualizada.` : `${rAula(true)} fixa cadastrada — as próximas ocorrências já foram lançadas na agenda.`);
          await listarRecorrentes();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // --------------------------- Form de agendamento ---------------------------
  function abrirForm(ag) {
    const ehEdicao = !!ag;
    const a = ag || {};
    Modal.abrir({
      titulo: ehEdicao ? `Editar ${rAula()}` : `Nov${rAula() === 'aula' ? 'a' : 'o'} ${rAula()}`, tamanho: 'modal--grande',
      corpoHTML: `
        <form id="form-ag" class="form-grid">
          <div class="campo"><label>Data *</label><input name="data" type="date" value="${a.data || dia}" required /></div>
          <div class="campo"><label>Hora início *</label><input name="hora_inicio" type="time" value="${a.hora_inicio || '09:00'}" required /></div>
          <div class="campo"><label>Hora fim <span class="dica">(automático pela duração)</span></label><input name="hora_fim" type="time" value="${a.hora_fim || ''}" /></div>
          <div class="campo"><label>Profissional</label><select name="profissional_id">
            <option value="">—</option>${profissionais.map((p) => `<option value="${p.id}" ${String(a.profissional_id) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>${rServico(true)}</label><select name="produto_id" id="ag-serv">
            <option value="">— selecione —</option>${servicos.map((s) => `<option value="${s.id}" data-preco="${s.preco_venda}" ${String(a.produto_id) === String(s.id) ? 'selected' : ''}>${UI.escapar(s.nome)}</option>`).join('')}
          </select><span class="dica">Necessário para faturar o atendimento.</span></div>
          <div class="campo"><label>Valor (R$)</label><input name="valor" id="ag-valor" type="number" step="0.01" min="0" value="${a.valor != null ? a.valor : ''}" /></div>
          <div class="campo"><label>${rCliente(true)} (cadastrado)</label><select name="cliente_id" id="ag-cli">
            <option value="">— avulso —</option>${clientes.map((c) => `<option value="${c.id}" data-tel="${UI.escapar(c.telefone || '')}" ${String(a.cliente_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Ou nome do ${rCliente()}</label><input name="cliente_nome" value="${UI.escapar(a.cliente_nome || '')}" placeholder="${rCliente(true)} sem cadastro" /></div>
          <div class="campo col-2"><label>Telefone (WhatsApp)</label><input name="telefone" id="ag-tel" value="${UI.escapar(a.telefone || '')}" placeholder="Ex.: 11999998888" /></div>
          <div class="campo col-2"><label>Observações</label><textarea name="observacao">${UI.escapar(a.observacao || '')}</textarea></div>
        </form>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        const serv = el.querySelector('#ag-serv');
        const valor = el.querySelector('#ag-valor');
        serv.addEventListener('change', () => {
          const opt = serv.selectedOptions[0];
          if (opt && opt.dataset.preco && !valor.value) valor.value = opt.dataset.preco;
        });
        const cli = el.querySelector('#ag-cli');
        cli.addEventListener('change', () => {
          const opt = cli.selectedOptions[0];
          const tel = el.querySelector('#ag-tel');
          if (opt && opt.dataset.tel && !tel.value) tel.value = opt.dataset.tel;
        });
      },
      aoConfirmar: async (el) => {
        const dados = Object.fromEntries(new FormData(el.querySelector('#form-ag')).entries());
        try {
          if (ehEdicao) await API.put(`/api/agenda/${a.id}`, dados);
          else await API.post('/api/agenda', dados);
          UI.sucesso(ehEdicao ? `${rAula(true)} atualizad${ehProfessor() ? 'a' : 'o'}.` : `${rAula(true)} criad${ehProfessor() ? 'a' : 'o'}.`);
          if (dados.data) { dia = dados.data; mesAtual = dados.data.slice(0, 7); }
          await render(document.getElementById('view'));
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------ Detalhe ------------------------------
  function abrirDetalhe(a) {
    const nome = a.cliente_cadastro || a.cliente_nome || `Sem ${rCliente()}`;
    const tel = a.cliente_telefone || a.telefone;
    Modal.abrir({
      titulo: `${a.hora_inicio} — ${nome}`, tamanho: 'modal--pequeno', mostrarConfirmar: false,
      corpoHTML: `
        <table class="tabela">
          <tr><th>Status</th><td>${badge(a.status)}${a.venda_id && !ehInstituto() ? ' <span class="badge badge--ok">faturado (venda #' + a.venda_id + ')</span>' : ''}${a.aula_recorrente_id ? ` <span class="badge badge--muted">🔁 ${rAula()} fixa</span>` : ''}</td></tr>
          <tr><th>Data</th><td>${diaLabel(a.data)}</td></tr>
          <tr><th>Horário</th><td>${UI.escapar(a.hora_inicio)}${a.hora_fim ? ' às ' + UI.escapar(a.hora_fim) : ''}</td></tr>
          ${ehInstituto() ? '' : `<tr><th>${rServico(true)}</th><td>${UI.escapar(a.servico_nome || '—')}</td></tr>`}
          <tr><th>${ehInstituto() ? 'Instrutor' : 'Profissional'}</th><td>${UI.escapar(a.profissional_nome || '—')}</td></tr>
          <tr><th>Telefone</th><td>${UI.escapar(tel || '—')}</td></tr>
          ${ehInstituto() ? '' : `<tr><th>Valor</th><td><strong>${UI.moeda(a.valor)}</strong></td></tr>`}
          ${a.observacao ? `<tr><th>Obs.</th><td>${UI.escapar(a.observacao)}</td></tr>` : ''}
        </table>
        <div class="campo mt-16"><label>Mudar status</label>
          <select id="det-status" ${a.venda_id ? 'disabled' : ''}>
            ${Object.keys(STATUS).map((s) => `<option value="${s}" ${a.status === s ? 'selected' : ''}>${STATUS[s][0]}</option>`).join('')}
          </select></div>`,
      aoAbrir: (el) => {
        const foot = el.querySelector('.modal__foot');
        foot.innerHTML = `
          <div class="flex gap-12" style="flex-wrap:wrap;width:100%">
            <button class="btn btn--secundario" id="d-status" ${a.venda_id ? 'disabled' : ''}>Atualizar status</button>
            ${tel ? '<button class="btn btn--secundario" id="d-zap">💬 WhatsApp</button>' : ''}
            <div class="cresce"></div>
            ${!a.venda_id ? '<button class="btn btn--secundario" id="d-editar">Editar</button>' : ''}
            ${!a.venda_id ? '<button class="btn btn--perigo" id="d-excluir">Excluir</button>' : ''}
            ${!a.venda_id && !ehInstituto() ? '<button class="btn" id="d-faturar">💲 Faturar</button>' : ''}
          </div>`;
        foot.querySelector('#d-status').addEventListener('click', async () => {
          try { await API.post(`/api/agenda/${a.id}/status`, { status: el.querySelector('#det-status').value }); UI.sucesso('Status atualizado.'); el.remove(); await atualizarVistaAtual(); }
          catch (e) { UI.erro(e.message); }
        });
        const zap = foot.querySelector('#d-zap');
        if (zap) zap.addEventListener('click', () => enviarWhatsApp(a));
        const ed = foot.querySelector('#d-editar');
        if (ed) ed.addEventListener('click', () => { el.remove(); abrirForm(a); });
        const ex = foot.querySelector('#d-excluir');
        if (ex) ex.addEventListener('click', async () => {
          const ok = await UI.confirmar(`Excluir est${ehProfessor() ? 'a' : 'e'} ${rAula()}?`, { titulo: 'Excluir', textoConfirmar: 'Excluir' });
          if (!ok) return;
          try { await API.del(`/api/agenda/${a.id}`); UI.sucesso(`${rAula(true)} excluíd${ehProfessor() ? 'a' : 'o'}.`); el.remove(); await atualizarVistaAtual(); }
          catch (e) { UI.erro(e.message); }
        });
        const fat = foot.querySelector('#d-faturar');
        if (fat) fat.addEventListener('click', () => faturar(a, el));
      },
    });
  }

  function faturar(a, detalheEl) {
    Modal.abrir({
      titulo: `Faturar ${rAula()}`, tamanho: 'modal--pequeno',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Gera a venda d${rServico() === 'matéria' ? 'a' : 'o'} ${rServico()} de <strong>${UI.moeda(a.valor)}</strong> e marca ${ehProfessor() ? 'a aula' : 'o agendamento'} como atendid${ehProfessor() ? 'a' : 'o'}.</p>
        <div class="campo"><label>Forma de pagamento</label><select id="f-forma">${Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="campo mt-16" id="f-venc-wrap" style="display:none"><label>Vencimento (a prazo)</label><input id="f-venc" type="date" /></div>`,
      textoConfirmar: 'Faturar',
      aoAbrir: (el) => {
        const forma = el.querySelector('#f-forma');
        forma.addEventListener('change', () => { el.querySelector('#f-venc-wrap').style.display = forma.value === 'prazo' ? '' : 'none'; });
      },
      aoConfirmar: async (el) => {
        try {
          await API.post(`/api/agenda/${a.id}/faturar`, { forma_pagamento: el.querySelector('#f-forma').value, vencimento_prazo: el.querySelector('#f-venc').value || null });
          UI.sucesso('Atendimento faturado!');
          if (detalheEl) detalheEl.remove();
          await atualizarVistaAtual();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  /** Atualiza a lista do dia ou o calendário do mês, conforme a visão atual. */
  async function atualizarVistaAtual() {
    if (vista === 'mes') await carregarCalendario();
    else await listar();
  }

  // ------------------------------ WhatsApp ------------------------------
  function soDigitos(t) { return String(t || '').replace(/\D/g, ''); }

  function enviarWhatsApp(a) {
    const tel = soDigitos(a.cliente_telefone || a.telefone);
    if (!tel) { UI.erro(`Est${ehProfessor() ? 'a' : 'e'} ${rAula()} não tem telefone.`); return; }
    const nome = a.cliente_cadastro || a.cliente_nome || rCliente();
    const dataBR = new Date(a.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const padrao = `Olá, ${nome}! Confirmando seu horário de ${a.servico_nome || rServico()} em ${dataBR} às ${a.hora_inicio}. Até lá!`;
    Modal.abrir({
      titulo: '💬 Enviar por WhatsApp', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Telefone</label><input id="wa-tel" value="${UI.escapar(tel)}" /></div>
        <div class="campo mt-16"><label>Mensagem</label><textarea id="wa-msg" rows="4">${UI.escapar(padrao)}</textarea></div>
        <div class="dica mt-16">Abre o WhatsApp (Web ou aplicativo) com a mensagem pronta para enviar.</div>`,
      textoConfirmar: 'Abrir WhatsApp',
      aoConfirmar: (el) => {
        const num = soDigitos(el.querySelector('#wa-tel').value);
        if (!num) { UI.erro('Informe o telefone.'); return false; }
        const completo = num.length <= 11 ? '55' + num : num; // DDI Brasil quando não informado
        const url = `https://wa.me/${completo}?text=${encodeURIComponent(el.querySelector('#wa-msg').value)}`;
        abrirExterno(url);
      },
    });
  }

  /** Abre um link externo (no Electron, cai para window.open que o main trata). */
  function abrirExterno(url) {
    try {
      const a = document.createElement('a');
      a.href = url; a.target = '_blank'; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
    } catch (_) { window.open(url, '_blank'); }
  }

  // ------------------------------ Equipe ------------------------------
  async function gerenciarEquipe() {
    profissionais = await API.get('/api/agenda/profissionais?incluir_inativos=1').catch(() => []);
    const corpo = `
      <form id="pf-form" class="form-grid" style="margin-bottom:16px">
        <div class="campo"><label>Nome *</label><input name="nome" required /></div>
        <div class="campo"><label>Telefone</label><input name="telefone" /></div>
        <div class="campo"><label>Comissão (%)</label><input name="comissao_pct" type="number" step="0.01" min="0" value="0" /></div>
        <div class="campo"><label>Cor na agenda</label><input name="cor" type="color" value="#2563eb" style="height:40px" /></div>
        <div class="campo col-2"><button class="btn" type="submit">Adicionar profissional</button></div>
      </form>
      <div id="pf-lista"></div>`;
    Modal.abrir({
      titulo: '👥 Equipe / profissionais', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const render = () => {
          el.querySelector('#pf-lista').innerHTML = profissionais.length ? `<table class="tabela">
            <thead><tr><th>Profissional</th><th>Telefone</th><th>Comissão</th><th>Status</th><th></th></tr></thead>
            <tbody>${profissionais.map((p) => `<tr style="${p.ativo ? '' : 'opacity:.55'}">
              <td><span class="agenda-cor" style="background:${p.cor}"></span> ${UI.escapar(p.nome)}</td>
              <td>${UI.escapar(p.telefone || '—')}</td>
              <td>${p.comissao_pct ? p.comissao_pct + '%' : '—'}</td>
              <td>${p.ativo ? '<span class="badge badge--ok">Ativo</span>' : '<span class="badge badge--muted">Inativo</span>'}</td>
              <td style="text-align:right"><button class="btn btn--secundario" data-del="${p.id}">✕</button></td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhum profissional cadastrado.</p>';
          el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir este profissional? Se já tiver agendamentos, será apenas inativado.', { titulo: 'Excluir', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/agenda/profissionais/${b.dataset.del}`); profissionais = await API.get('/api/agenda/profissionais?incluir_inativos=1'); render(); UI.sucesso('Pronto.'); }
            catch (e) { UI.erro(e.message); }
          }));
        };
        render();
        el.querySelector('#pf-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const dados = Object.fromEntries(new FormData(ev.target).entries());
          try {
            await API.post('/api/agenda/profissionais', dados);
            ev.target.reset();
            profissionais = await API.get('/api/agenda/profissionais?incluir_inativos=1');
            render(); UI.sucesso('Profissional adicionado.');
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }

  return { titulo: 'Agenda', render };
})();
