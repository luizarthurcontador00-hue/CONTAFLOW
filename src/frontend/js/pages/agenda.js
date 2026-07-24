'use strict';

/**
 * Agenda: agendamentos do dia por profissional, com status, faturamento
 * (gera a venda do serviço) e envio de confirmação por WhatsApp.
 * Cadastro da equipe (profissionais) no mesmo módulo.
 */
window.PaginaAgenda = (function () {
  let dia = new Date().toISOString().slice(0, 10);
  let profissionais = [];
  let clientes = [];
  let servicos = [];
  let filtroProf = '';

  const STATUS = {
    agendado: ['Agendado', 'alerta'], confirmado: ['Confirmado', 'muted'],
    atendido: ['Atendido', 'ok'], cancelado: ['Cancelado', 'muted'], faltou: ['Faltou', 'erro'],
  };
  const FORMAS = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', pix: 'PIX', prazo: 'A prazo' };

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

  async function render(container) {
    [profissionais, clientes, servicos] = await Promise.all([
      API.get('/api/agenda/profissionais').catch(() => []),
      API.get('/api/clientes').catch(() => []),
      API.get('/api/produtos?eh_servico=1').catch(() => []),
    ]);

    container.innerHTML = `
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
        <button class="btn" id="ag-novo">+ Novo agendamento</button>
      </div>
      <div id="ag-resumo"></div>
      <div id="ag-lista"><div class="card">Carregando…</div></div>`;

    container.querySelector('#ag-ant').addEventListener('click', () => { mudarDia(-1); render(container); });
    container.querySelector('#ag-prox').addEventListener('click', () => { mudarDia(1); render(container); });
    container.querySelector('#ag-hoje').addEventListener('click', () => { dia = new Date().toISOString().slice(0, 10); render(container); });
    container.querySelector('#ag-data').addEventListener('change', (e) => { dia = e.target.value || dia; render(container); });
    container.querySelector('#ag-prof-filtro').addEventListener('change', (e) => { filtroProf = e.target.value; listar(); });
    container.querySelector('#ag-equipe').addEventListener('click', gerenciarEquipe);
    container.querySelector('#ag-novo').addEventListener('click', () => abrirForm());

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
      <div class="card stat"><span class="stat__label">Agendamentos do dia</span><span class="stat__value">${resumo.total}</span></div>
      <div class="card stat"><span class="stat__label">Pendentes</span><span class="stat__value" style="color:var(--alerta)">${resumo.pendentes}</span></div>
      <div class="card stat"><span class="stat__label">Atendidos</span><span class="stat__value" style="color:var(--sucesso)">${resumo.atendidos}</span></div>
      <div class="card stat"><span class="stat__label">Previsto no dia</span><span class="stat__value">${UI.moeda(resumo.previsto)}</span></div>
    </div>`;

    if (!itens.length) {
      alvo.innerHTML = `<div class="card vazio">Nenhum agendamento neste dia.
        <div class="mt-16"><button class="btn" onclick="document.getElementById('ag-novo').click()">+ Novo agendamento</button></div></div>`;
      return;
    }

    alvo.innerHTML = `<div class="card"><div class="agenda-lista">
      ${itens.map((a) => {
        const nome = a.cliente_cadastro || a.cliente_nome || 'Sem cliente';
        const tel = a.cliente_telefone || a.telefone;
        return `<div class="agenda-item" style="border-left-color:${a.profissional_cor || 'var(--primaria)'}">
          <div class="agenda-item__hora">${UI.escapar(a.hora_inicio)}${a.hora_fim ? `<span class="dica">até ${UI.escapar(a.hora_fim)}</span>` : ''}</div>
          <div class="agenda-item__info">
            <strong>${UI.escapar(nome)}</strong> ${badge(a.status)}${a.venda_id ? ' <span class="badge badge--ok">faturado</span>' : ''}
            <div class="dica">${UI.escapar(a.servico_nome || 'Serviço')}${a.profissional_nome ? ' · ' + UI.escapar(a.profissional_nome) : ''}${tel ? ' · ' + UI.escapar(tel) : ''}</div>
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

  // --------------------------- Form de agendamento ---------------------------
  function abrirForm(ag) {
    const ehEdicao = !!ag;
    const a = ag || {};
    Modal.abrir({
      titulo: ehEdicao ? 'Editar agendamento' : 'Novo agendamento', tamanho: 'modal--grande',
      corpoHTML: `
        <form id="form-ag" class="form-grid">
          <div class="campo"><label>Data *</label><input name="data" type="date" value="${a.data || dia}" required /></div>
          <div class="campo"><label>Hora início *</label><input name="hora_inicio" type="time" value="${a.hora_inicio || '09:00'}" required /></div>
          <div class="campo"><label>Hora fim <span class="dica">(automático pela duração)</span></label><input name="hora_fim" type="time" value="${a.hora_fim || ''}" /></div>
          <div class="campo"><label>Profissional</label><select name="profissional_id">
            <option value="">—</option>${profissionais.map((p) => `<option value="${p.id}" ${String(a.profissional_id) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Serviço</label><select name="produto_id" id="ag-serv">
            <option value="">— selecione —</option>${servicos.map((s) => `<option value="${s.id}" data-preco="${s.preco_venda}" ${String(a.produto_id) === String(s.id) ? 'selected' : ''}>${UI.escapar(s.nome)}</option>`).join('')}
          </select><span class="dica">Necessário para faturar o atendimento.</span></div>
          <div class="campo"><label>Valor (R$)</label><input name="valor" id="ag-valor" type="number" step="0.01" min="0" value="${a.valor != null ? a.valor : ''}" /></div>
          <div class="campo"><label>Cliente (cadastrado)</label><select name="cliente_id" id="ag-cli">
            <option value="">— avulso —</option>${clientes.map((c) => `<option value="${c.id}" data-tel="${UI.escapar(c.telefone || '')}" ${String(a.cliente_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}
          </select></div>
          <div class="campo"><label>Ou nome do cliente</label><input name="cliente_nome" value="${UI.escapar(a.cliente_nome || '')}" placeholder="Cliente sem cadastro" /></div>
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
          UI.sucesso(ehEdicao ? 'Agendamento atualizado.' : 'Agendamento criado.');
          if (dados.data && dados.data !== dia) dia = dados.data;
          await render(document.getElementById('view'));
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------ Detalhe ------------------------------
  function abrirDetalhe(a) {
    const nome = a.cliente_cadastro || a.cliente_nome || 'Sem cliente';
    const tel = a.cliente_telefone || a.telefone;
    Modal.abrir({
      titulo: `${a.hora_inicio} — ${nome}`, tamanho: 'modal--pequeno', mostrarConfirmar: false,
      corpoHTML: `
        <table class="tabela">
          <tr><th>Status</th><td>${badge(a.status)}${a.venda_id ? ' <span class="badge badge--ok">faturado (venda #' + a.venda_id + ')</span>' : ''}</td></tr>
          <tr><th>Data</th><td>${diaLabel(a.data)}</td></tr>
          <tr><th>Horário</th><td>${UI.escapar(a.hora_inicio)}${a.hora_fim ? ' às ' + UI.escapar(a.hora_fim) : ''}</td></tr>
          <tr><th>Serviço</th><td>${UI.escapar(a.servico_nome || '—')}</td></tr>
          <tr><th>Profissional</th><td>${UI.escapar(a.profissional_nome || '—')}</td></tr>
          <tr><th>Telefone</th><td>${UI.escapar(tel || '—')}</td></tr>
          <tr><th>Valor</th><td><strong>${UI.moeda(a.valor)}</strong></td></tr>
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
            ${!a.venda_id ? '<button class="btn" id="d-faturar">💲 Faturar</button>' : ''}
          </div>`;
        foot.querySelector('#d-status').addEventListener('click', async () => {
          try { await API.post(`/api/agenda/${a.id}/status`, { status: el.querySelector('#det-status').value }); UI.sucesso('Status atualizado.'); el.remove(); await listar(); }
          catch (e) { UI.erro(e.message); }
        });
        const zap = foot.querySelector('#d-zap');
        if (zap) zap.addEventListener('click', () => enviarWhatsApp(a));
        const ed = foot.querySelector('#d-editar');
        if (ed) ed.addEventListener('click', () => { el.remove(); abrirForm(a); });
        const ex = foot.querySelector('#d-excluir');
        if (ex) ex.addEventListener('click', async () => {
          const ok = await UI.confirmar('Excluir este agendamento?', { titulo: 'Excluir', textoConfirmar: 'Excluir' });
          if (!ok) return;
          try { await API.del(`/api/agenda/${a.id}`); UI.sucesso('Agendamento excluído.'); el.remove(); await listar(); }
          catch (e) { UI.erro(e.message); }
        });
        const fat = foot.querySelector('#d-faturar');
        if (fat) fat.addEventListener('click', () => faturar(a, el));
      },
    });
  }

  function faturar(a, detalheEl) {
    Modal.abrir({
      titulo: 'Faturar atendimento', tamanho: 'modal--pequeno',
      corpoHTML: `
        <p class="dica" style="margin-top:0">Gera a venda do serviço de <strong>${UI.moeda(a.valor)}</strong> e marca o agendamento como atendido.</p>
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
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------ WhatsApp ------------------------------
  function soDigitos(t) { return String(t || '').replace(/\D/g, ''); }

  function enviarWhatsApp(a) {
    const tel = soDigitos(a.cliente_telefone || a.telefone);
    if (!tel) { UI.erro('Este agendamento não tem telefone.'); return; }
    const nome = a.cliente_cadastro || a.cliente_nome || 'cliente';
    const dataBR = new Date(a.data + 'T00:00:00').toLocaleDateString('pt-BR');
    const padrao = `Olá, ${nome}! Confirmando seu horário de ${a.servico_nome || 'atendimento'} em ${dataBR} às ${a.hora_inicio}. Até lá!`;
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
