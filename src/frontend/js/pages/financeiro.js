'use strict';

/**
 * Pagina Financeiro: contas a pagar, contas a receber e fluxo de caixa.
 * Alertas de vencidas/a vencer, baixas com data efetiva e parcelamento.
 */
window.PaginaFinanceiro = (function () {
  let fornecedores = [];
  let abaAtual = 'pagar';
  const FORMAS = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', pix: 'PIX', prazo: 'A prazo', boleto: 'Boleto', transferencia: 'Transferência' };

  async function render(container) {
    fornecedores = await API.get('/api/fornecedores').catch(() => []);
    container.innerHTML = `
      <div id="fin-alertas" class="mb-16"></div>
      <div class="tabs">
        <div class="tab ativo" data-aba="pagar">A Pagar</div>
        <div class="tab" data-aba="fixas">Contas Fixas</div>
        <div class="tab" data-aba="receber">A Receber</div>
        <div class="tab" data-aba="fluxo">Fluxo de Caixa</div>
      </div>
      <div id="fin-conteudo"></div>`;

    container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      abaAtual = t.dataset.aba;
      container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('ativo', x === t));
      trocarAba();
    }));

    // Garante que as contas fixas do mes ja tenham sido lancadas (idempotente;
    // cobre o caso de o mes ter virado com o programa aberto ha dias).
    await API.post('/api/financeiro/contas-fixas/gerar-pendentes', {}).catch(() => {});

    carregarAlertas();
    trocarAba();
  }

  async function carregarAlertas() {
    const alvo = document.getElementById('fin-alertas');
    let a;
    try { a = await API.get('/api/financeiro/alertas?dias=7'); } catch { return; }
    const blocos = [];
    if (a.pagar.vencidas.c > 0) blocos.push(`<span class="badge badge--erro">${a.pagar.vencidas.c} conta(s) a pagar vencida(s) — ${UI.moeda(a.pagar.vencidas.v)}</span>`);
    if (a.pagar.aVencer.c > 0) blocos.push(`<span class="badge badge--alerta">${a.pagar.aVencer.c} a pagar em 7 dias — ${UI.moeda(a.pagar.aVencer.v)}</span>`);
    if (a.receber.vencidas.c > 0) blocos.push(`<span class="badge badge--alerta">${a.receber.vencidas.c} a receber vencida(s) — ${UI.moeda(a.receber.vencidas.v)}</span>`);
    if (a.receber.aVencer.c > 0) blocos.push(`<span class="badge badge--muted">${a.receber.aVencer.c} a receber em 7 dias — ${UI.moeda(a.receber.aVencer.v)}</span>`);
    alvo.innerHTML = blocos.length ? `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap">${blocos.join(' ')}</div>` : '';
  }

  function trocarAba() {
    if (abaAtual === 'pagar') renderPagar();
    else if (abaAtual === 'fixas') renderContasFixas();
    else if (abaAtual === 'receber') renderReceber();
    else renderFluxo();
  }

  function situacao(c) {
    if (c.status === 'pago' || c.status === 'recebido') return '<span class="badge badge--ok">Quitada</span>';
    if (c.status === 'cancelada') return '<span class="badge badge--muted">Cancelada</span>';
    const hoje = new Date().toISOString().slice(0, 10);
    if (c.vencimento && c.vencimento < hoje) return '<span class="badge badge--erro">Vencida</span>';
    return '<span class="badge badge--alerta">Pendente</span>';
  }

  // ----------------------------- A Pagar -----------------------------
  async function renderPagar() {
    const alvo = document.getElementById('fin-conteudo');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <select id="cp-status"><option value="">Todas</option><option value="pendente">Pendentes</option><option value="pago">Pagas</option></select>
        <button class="btn btn--secundario" id="cp-filtrar">Filtrar</button>
        <div class="cresce"></div>
        <button class="btn" id="cp-nova">+ Nova conta a pagar</button>
      </div>
      <div class="card"><div id="cp-lista">Carregando…</div></div>`;
    alvo.querySelector('#cp-filtrar').addEventListener('click', listarPagar);
    alvo.querySelector('#cp-nova').addEventListener('click', formPagar);
    await listarPagar();
  }

  async function listarPagar() {
    const alvo = document.getElementById('cp-lista');
    const status = document.getElementById('cp-status').value;
    let contas;
    try { contas = await API.get('/api/financeiro/contas-pagar' + (status ? '?status=' + status : '')); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta.</p>'; return; }
    alvo.innerHTML = tabelaContas(contas, 'pagar');
    ligarAcoes(alvo, 'pagar');
  }

  function formPagar() {
    Modal.abrir({
      titulo: 'Nova conta a pagar', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Descrição *</label><input id="cp-desc" /></div>
        <div class="campo mt-16"><label>Fornecedor</label><select id="cp-forn"><option value="">—</option>${fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('')}</select></div>
        <div class="campo mt-16"><label>Valor (R$) *</label><input id="cp-valor" type="number" step="0.01" min="0" /></div>
        <div class="campo mt-16"><label>Vencimento</label><input id="cp-venc" type="date" /></div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        try {
          await API.post('/api/financeiro/contas-pagar', {
            descricao: el.querySelector('#cp-desc').value, fornecedor_id: el.querySelector('#cp-forn').value || null,
            valor: el.querySelector('#cp-valor').value, vencimento: el.querySelector('#cp-venc').value || null,
          });
          UI.sucesso('Conta criada.'); await listarPagar(); carregarAlertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // --------------------------- Contas Fixas ---------------------------
  async function renderContasFixas() {
    const alvo = document.getElementById('fin-conteudo');
    alvo.innerHTML = `
      <p class="dica mb-16">Cadastre contas que se repetem todo mês (aluguel, internet, água, luz…). Elas são lançadas automaticamente em "A Pagar" no início de cada mês.</p>
      <div class="barra-ferramentas"><div class="cresce"></div><button class="btn" id="cf-nova">+ Nova conta fixa</button></div>
      <div class="card"><div id="cf-lista">Carregando…</div></div>`;
    alvo.querySelector('#cf-nova').addEventListener('click', () => formContaFixa());
    await listarContasFixas();
  }

  async function listarContasFixas() {
    const alvo = document.getElementById('cf-lista');
    let contas;
    try { contas = await API.get('/api/financeiro/contas-fixas'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta fixa cadastrada.</p>'; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Descrição</th><th>Fornecedor</th><th>Dia venc.</th><th>Valor</th><th>Status</th><th></th></tr></thead>
      <tbody>${contas.map((c) => `<tr style="${c.ativa ? '' : 'opacity:.55'}">
        <td>${UI.escapar(c.descricao)}</td>
        <td>${UI.escapar(c.fornecedor_nome || '—')}</td>
        <td>Dia ${c.dia_vencimento}</td>
        <td>${UI.moeda(c.valor)}</td>
        <td>${c.ativa ? '<span class="badge badge--ok">Ativa</span>' : '<span class="badge badge--muted">Pausada</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn--secundario" data-cf-pausar="${c.id}" data-ativa="${c.ativa}">${c.ativa ? 'Pausar' : 'Reativar'}</button>
          <button class="btn btn--secundario" data-cf-editar="${c.id}">Editar</button>
          <button class="btn btn--secundario" data-cf-excluir="${c.id}">✕</button>
        </td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-cf-editar]').forEach((b) => b.addEventListener('click', () => {
      const c = contas.find((x) => x.id === Number(b.dataset.cfEditar));
      formContaFixa(c);
    }));
    alvo.querySelectorAll('[data-cf-pausar]').forEach((b) => b.addEventListener('click', async () => {
      const ativa = b.dataset.ativa === '1';
      try {
        await API.put(`/api/financeiro/contas-fixas/${b.dataset.cfPausar}`, { ativa: !ativa });
        UI.sucesso(ativa ? 'Conta fixa pausada.' : 'Conta fixa reativada.');
        await listarContasFixas();
      } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-cf-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta conta fixa? As contas já lançadas em meses anteriores não serão apagadas.', { titulo: 'Excluir conta fixa', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/financeiro/contas-fixas/${b.dataset.cfExcluir}`); UI.sucesso('Conta fixa excluída.'); await listarContasFixas(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formContaFixa(cf) {
    const ehEdicao = !!cf;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar conta fixa' : 'Nova conta fixa', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Descrição *</label><input id="cf-desc" value="${UI.escapar(cf ? cf.descricao : '')}" /></div>
        <div class="campo mt-16"><label>Fornecedor</label><select id="cf-forn"><option value="">—</option>${fornecedores.map((f) => `<option value="${f.id}" ${cf && String(cf.fornecedor_id) === String(f.id) ? 'selected' : ''}>${UI.escapar(f.nome)}</option>`).join('')}</select></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Valor (R$) *</label><input id="cf-valor" type="number" step="0.01" min="0" value="${cf ? cf.valor : ''}" /></div>
          <div class="campo"><label>Dia do vencimento *</label><input id="cf-dia" type="number" min="1" max="31" value="${cf ? cf.dia_vencimento : ''}" /></div>
        </div>
        <div class="dica mt-16">Todo mês, no dia informado (ajustado se o mês não tiver esse dia), uma conta a pagar é criada automaticamente.</div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const dados = {
          descricao: el.querySelector('#cf-desc').value,
          fornecedor_id: el.querySelector('#cf-forn').value || null,
          valor: el.querySelector('#cf-valor').value,
          dia_vencimento: el.querySelector('#cf-dia').value,
        };
        try {
          if (ehEdicao) await API.put(`/api/financeiro/contas-fixas/${cf.id}`, dados);
          else await API.post('/api/financeiro/contas-fixas', dados);
          UI.sucesso(ehEdicao ? 'Conta fixa atualizada.' : 'Conta fixa cadastrada.');
          await API.post('/api/financeiro/contas-fixas/gerar-pendentes', {}).catch(() => {});
          await listarContasFixas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ---------------------------- A Receber ----------------------------
  async function renderReceber() {
    const alvo = document.getElementById('fin-conteudo');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <select id="cr-status"><option value="">Todas</option><option value="pendente">Pendentes</option><option value="recebido">Recebidas</option><option value="cancelada">Canceladas</option></select>
        <button class="btn btn--secundario" id="cr-filtrar">Filtrar</button>
        <div class="cresce"></div>
        <button class="btn" id="cr-nova">+ Nova conta a receber</button>
      </div>
      <div class="card"><div id="cr-lista">Carregando…</div></div>`;
    alvo.querySelector('#cr-filtrar').addEventListener('click', listarReceber);
    alvo.querySelector('#cr-nova').addEventListener('click', formReceber);
    await listarReceber();
  }

  async function listarReceber() {
    const alvo = document.getElementById('cr-lista');
    const status = document.getElementById('cr-status').value;
    let contas;
    try { contas = await API.get('/api/financeiro/contas-receber' + (status ? '?status=' + status : '')); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta.</p>'; return; }
    alvo.innerHTML = tabelaContas(contas, 'receber');
    ligarAcoes(alvo, 'receber');
  }

  function formReceber() {
    Modal.abrir({
      titulo: 'Nova conta a receber', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Descrição *</label><input id="cr-desc" /></div>
        <div class="campo mt-16"><label>Valor total (R$) *</label><input id="cr-valor" type="number" step="0.01" min="0" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Parcelas</label><input id="cr-parc" type="number" min="1" value="1" /></div>
          <div class="campo"><label>1º vencimento</label><input id="cr-venc" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        </div>
        <div class="dica mt-16">Parcelas mensais são geradas automaticamente.</div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        try {
          const r = await API.post('/api/financeiro/contas-receber', {
            descricao: el.querySelector('#cr-desc').value, valor: el.querySelector('#cr-valor').value,
            parcelas: el.querySelector('#cr-parc').value, primeiro_vencimento: el.querySelector('#cr-venc').value || null,
          });
          UI.sucesso(`${r.criadas} parcela(s) criada(s).`); await listarReceber(); carregarAlertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------ Tabela e acoes ---------------------------
  function tabelaContas(contas, tipo) {
    return `<table class="tabela">
      <thead><tr><th>Descrição</th>${tipo === 'pagar' ? '<th>Fornecedor</th>' : ''}<th>Venc.</th><th>Valor</th><th>Situação</th><th></th></tr></thead>
      <tbody>${contas.map((c) => {
        const quitada = c.status === 'pago' || c.status === 'recebido';
        return `<tr>
          <td>${UI.escapar(c.descricao)}${tipo === 'pagar' && c.conta_fixa_id ? ' <span class="badge badge--muted" title="Gerada automaticamente de uma conta fixa">🔁 fixa</span>' : ''}</td>
          ${tipo === 'pagar' ? `<td>${UI.escapar(c.fornecedor_nome || '—')}</td>` : ''}
          <td>${c.vencimento || '—'}</td>
          <td>${UI.moeda(c.valor)}</td>
          <td>${situacao(c)}</td>
          <td style="text-align:right;white-space:nowrap">
            ${!quitada && c.status !== 'cancelada' ? `<button class="btn" data-baixar="${c.id}">${tipo === 'pagar' ? 'Pagar' : 'Receber'}</button>` : ''}
            ${quitada ? `<button class="btn btn--secundario" data-reabrir="${c.id}">Reabrir</button>` : ''}
            <button class="btn btn--secundario" data-excluir="${c.id}">✕</button>
          </td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  function ligarAcoes(alvo, tipo) {
    const base = '/api/financeiro/contas-' + tipo;
    const recarregar = tipo === 'pagar' ? listarPagar : listarReceber;
    alvo.querySelectorAll('[data-baixar]').forEach((b) => b.addEventListener('click', () => baixar(tipo, b.dataset.baixar)));
    alvo.querySelectorAll('[data-reabrir]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.post(`${base}/${b.dataset.reabrir}/reabrir`, {}); await recarregar(); carregarAlertas(); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta conta?', { titulo: 'Excluir conta', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`${base}/${b.dataset.excluir}`); await recarregar(); carregarAlertas(); UI.sucesso('Conta excluída.'); } catch (e) { UI.erro(e.message); }
    }));
  }

  function baixar(tipo, id) {
    const ehPagar = tipo === 'pagar';
    Modal.abrir({
      titulo: ehPagar ? 'Registrar pagamento' : 'Registrar recebimento', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Data ${ehPagar ? 'do pagamento' : 'do recebimento'}</label><input id="bx-data" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        <div class="campo mt-16"><label>Forma</label><select id="bx-forma">
          ${Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select></div>`,
      textoConfirmar: 'Confirmar',
      aoConfirmar: async (el) => {
        const campo = ehPagar ? { data_pagamento: el.querySelector('#bx-data').value, forma_pagamento: el.querySelector('#bx-forma').value }
          : { data_recebimento: el.querySelector('#bx-data').value, forma_recebimento: el.querySelector('#bx-forma').value };
        try {
          await API.post(`/api/financeiro/contas-${tipo}/${id}/baixar`, campo);
          UI.sucesso(ehPagar ? 'Pagamento registrado.' : 'Recebimento registrado.');
          (ehPagar ? listarPagar : listarReceber)(); carregarAlertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // --------------------------- Fluxo de caixa ------------------------
  async function renderFluxo() {
    const alvo = document.getElementById('fin-conteudo');
    const hoje = new Date().toISOString().slice(0, 10);
    const mesInicio = hoje.slice(0, 8) + '01';
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="campo"><label class="dica">De</label><input type="date" id="fx-inicio" value="${mesInicio}"></div>
        <div class="campo"><label class="dica">Até</label><input type="date" id="fx-fim" value="${hoje}"></div>
        <button class="btn btn--secundario" id="fx-aplicar" style="align-self:end">Atualizar</button>
      </div>
      <div id="fx-resultado"></div>`;
    alvo.querySelector('#fx-aplicar').addEventListener('click', carregarFluxo);
    await carregarFluxo();
  }

  async function carregarFluxo() {
    const alvo = document.getElementById('fx-resultado');
    const inicio = document.getElementById('fx-inicio').value;
    const fim = document.getElementById('fx-fim').value;
    let fx;
    try { fx = await API.get(`/api/financeiro/fluxo-caixa?inicio=${inicio}&fim=${fim}`); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    alvo.innerHTML = `
      <div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Entradas</span><span class="stat__value" style="color:var(--sucesso)">${UI.moeda(fx.entradas)}</span></div>
        <div class="card stat"><span class="stat__label">Saídas</span><span class="stat__value" style="color:var(--perigo)">${UI.moeda(fx.saidas)}</span></div>
        <div class="card stat"><span class="stat__label">Saldo do período</span><span class="stat__value" style="color:${fx.saldo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(fx.saldo)}</span></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Composição</h3>
        <table class="tabela">
          <tr><td>Vendas à vista (dinheiro, cartão, PIX)</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.vendas_a_vista)}</td></tr>
          <tr><td>Recebimentos de contas (a prazo/parcelas)</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.recebimentos)}</td></tr>
          <tr><td>Pagamentos de contas</td><td style="text-align:right;color:var(--perigo)">- ${UI.moeda(fx.detalhe.pagamentos)}</td></tr>
        </table>
      </div>`;
  }

  return { titulo: 'Financeiro', render };
})();
