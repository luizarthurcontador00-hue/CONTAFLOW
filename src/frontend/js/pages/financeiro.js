'use strict';

/**
 * Pagina Financeiro: contas a pagar (com parcelamento e contas fixas),
 * contas a receber, saldos das contas financeiras e fluxo de caixa.
 * As listas de contas mostram, por padrao, o mes corrente (com navegacao
 * de mes e opcao "todas").
 */
window.PaginaFinanceiro = (function () {
  let fornecedores = [];
  let contasFin = [];
  let categoriasDespesa = [];
  let abaAtual = 'pagar';
  const FORMAS = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', pix: 'PIX', prazo: 'A prazo', boleto: 'Boleto', transferencia: 'Transferência' };
  // Formas que alimentam um saldo (a prazo nao entra em conta na hora).
  const FORMAS_SALDO = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', transferencia: 'Transferência', boleto: 'Boleto' };
  const TIPOS_CONTA = { dinheiro: '💵 Dinheiro', banco: '🏦 Banco', cartao: '💳 Máquina de cartão', outro: '📦 Outro' };

  const filtroPagar = { mes: mesCorrente(), todos: false, status: '' };
  const filtroReceber = { mes: mesCorrente(), todos: false, status: '' };

  function mesCorrente() { return new Date().toISOString().slice(0, 7); }
  function periodoMes(anoMes) {
    const [a, m] = anoMes.split('-').map(Number);
    const ultimo = new Date(a, m, 0).getDate();
    return { inicio: `${anoMes}-01`, fim: `${anoMes}-${String(ultimo).padStart(2, '0')}` };
  }
  function mesLabel(anoMes) {
    const [a, m] = anoMes.split('-').map(Number);
    const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${nomes[m - 1]} de ${a}`;
  }
  function mudarMes(anoMes, delta) {
    const [a, m] = anoMes.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  async function render(container) {
    [fornecedores, categoriasDespesa] = await Promise.all([
      API.get('/api/fornecedores').catch(() => []),
      API.get('/api/financeiro/categorias-despesa').catch(() => []),
    ]);
    container.innerHTML = `
      <div id="fin-alertas" class="mb-16"></div>
      <div class="tabs">
        <div class="tab ativo" data-aba="pagar">A Pagar</div>
        <div class="tab" data-aba="fixas">Contas Fixas</div>
        <div class="tab" data-aba="receber">A Receber</div>
        <div class="tab" data-aba="fluxo">Fluxo de Caixa</div>
        <div class="tab" data-aba="dre">DRE</div>
      </div>
      <div id="fin-conteudo"></div>`;

    container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      abaAtual = t.dataset.aba;
      container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('ativo', x === t));
      trocarAba();
    }));

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
    else if (abaAtual === 'dre') renderDRE();
    else renderFluxo();
  }

  function situacao(c) {
    if (c.tipo === 'venda_vista') return '<span class="badge badge--ok">Recebida (venda)</span>';
    if (c.status === 'pago' || c.status === 'recebido') return '<span class="badge badge--ok">Quitada</span>';
    if (c.status === 'cancelada') return '<span class="badge badge--muted">Cancelada</span>';
    const hoje = new Date().toISOString().slice(0, 10);
    if (c.vencimento && c.vencimento < hoje) return '<span class="badge badge--erro">Vencida</span>';
    return '<span class="badge badge--alerta">Pendente</span>';
  }

  // Barra de navegacao de mes reutilizavel (A Pagar / A Receber).
  function barraMes(filtro, prefixo, statusOpcoes) {
    return `
      <div class="barra-ferramentas">
        <div class="flex gap-12" style="align-items:center">
          <button class="btn btn--secundario" id="${prefixo}-mes-ant" ${filtro.todos ? 'disabled' : ''}>◀</button>
          <strong style="min-width:150px;text-align:center">${filtro.todos ? 'Todos os períodos' : mesLabel(filtro.mes)}</strong>
          <button class="btn btn--secundario" id="${prefixo}-mes-prox" ${filtro.todos ? 'disabled' : ''}>▶</button>
          <label class="flex gap-12" style="align-items:center;font-size:13px;margin-left:8px">
            <input type="checkbox" id="${prefixo}-todos" ${filtro.todos ? 'checked' : ''}> Ver todos
          </label>
        </div>
        <select id="${prefixo}-status">${statusOpcoes}</select>
        <div class="cresce"></div>
        <button class="btn" id="${prefixo}-nova">+ Nova conta a ${prefixo === 'cp' ? 'pagar' : 'receber'}</button>
      </div>`;
  }

  function ligarBarraMes(alvo, filtro, prefixo, recarregar) {
    const rerender = () => (prefixo === 'cp' ? renderPagar() : renderReceber());
    alvo.querySelector(`#${prefixo}-mes-ant`).addEventListener('click', () => { filtro.mes = mudarMes(filtro.mes, -1); rerender(); });
    alvo.querySelector(`#${prefixo}-mes-prox`).addEventListener('click', () => { filtro.mes = mudarMes(filtro.mes, 1); rerender(); });
    alvo.querySelector(`#${prefixo}-todos`).addEventListener('change', (e) => { filtro.todos = e.target.checked; rerender(); });
    alvo.querySelector(`#${prefixo}-status`).addEventListener('change', (e) => { filtro.status = e.target.value; recarregar(); });
  }

  function queryPeriodo(filtro) {
    const params = new URLSearchParams();
    if (filtro.status) params.set('status', filtro.status);
    if (!filtro.todos) {
      const { inicio, fim } = periodoMes(filtro.mes);
      params.set('inicio', inicio); params.set('fim', fim);
    }
    return params.toString();
  }

  // ----------------------------- A Pagar -----------------------------
  async function renderPagar() {
    const alvo = document.getElementById('fin-conteudo');
    const statusOpcoes = ['<option value="">Todas</option>', '<option value="pendente">Pendentes</option>', '<option value="pago">Pagas</option>']
      .map((o) => o.replace(`value="${filtroPagar.status}"`, `value="${filtroPagar.status}" selected`)).join('');
    alvo.innerHTML = barraMes(filtroPagar, 'cp', statusOpcoes) + '<div class="card"><div id="cp-lista">Carregando…</div></div>';
    ligarBarraMes(alvo, filtroPagar, 'cp', listarPagar);
    alvo.querySelector('#cp-nova').addEventListener('click', formPagar);
    await listarPagar();
  }

  async function listarPagar() {
    const alvo = document.getElementById('cp-lista');
    let contas;
    try { contas = await API.get('/api/financeiro/contas-pagar?' + queryPeriodo(filtroPagar)); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta neste período.</p>'; return; }
    const total = contas.reduce((s, c) => s + Number(c.valor), 0);
    const pend = contas.filter((c) => c.status === 'pendente').reduce((s, c) => s + Number(c.valor), 0);
    alvo.innerHTML = tabelaContas(contas, 'pagar') +
      `<div class="flex flex--between mt-16" style="font-size:14px"><span class="muted">${contas.length} conta(s)</span>
        <span>Pendente: <strong style="color:var(--perigo)">${UI.moeda(pend)}</strong> · Total: <strong>${UI.moeda(total)}</strong></span></div>`;
    ligarAcoes(alvo, 'pagar');
  }

  function formPagar() {
    Modal.abrir({
      titulo: 'Nova conta a pagar', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Descrição *</label><input id="cp-desc" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Fornecedor</label><select id="cp-forn"><option value="">—</option>${fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Categoria (DRE)</label><select id="cp-cat"><option value="">— sem categoria —</option>${categoriasDespesa.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}${c.considera_dre ? '' : ' (fora do DRE)'}</option>`).join('')}</select></div>
        </div>
        <div class="campo mt-16"><label>Valor total (R$) *</label><input id="cp-valor" type="number" step="0.01" min="0" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Parcelas</label><input id="cp-parc" type="number" min="1" value="1" /></div>
          <div class="campo"><label>1º vencimento</label><input id="cp-venc" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        </div>
        <div class="dica mt-16">A categoria organiza a conta no DRE. Com mais de uma parcela, o valor é dividido e cada parcela vence a cada mês (uma conta por parcela).</div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        try {
          const r = await API.post('/api/financeiro/contas-pagar', {
            descricao: el.querySelector('#cp-desc').value, fornecedor_id: el.querySelector('#cp-forn').value || null,
            categoria_despesa_id: el.querySelector('#cp-cat').value || null,
            valor: el.querySelector('#cp-valor').value, parcelas: el.querySelector('#cp-parc').value,
            primeiro_vencimento: el.querySelector('#cp-venc').value || null,
          });
          UI.sucesso(r && r.criadas ? `${r.criadas} parcela(s) criada(s).` : 'Conta criada.');
          await listarPagar(); carregarAlertas();
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
    const statusOpcoes = ['<option value="">Todas</option>', '<option value="pendente">Pendentes</option>', '<option value="recebido">Recebidas</option>', '<option value="cancelada">Canceladas</option>']
      .map((o) => o.replace(`value="${filtroReceber.status}"`, `value="${filtroReceber.status}" selected`)).join('');
    alvo.innerHTML = barraMes(filtroReceber, 'cr', statusOpcoes) + '<div class="card"><div id="cr-lista">Carregando…</div></div>';
    ligarBarraMes(alvo, filtroReceber, 'cr', listarReceber);
    alvo.querySelector('#cr-nova').addEventListener('click', formReceber);
    await listarReceber();
  }

  async function listarReceber() {
    const alvo = document.getElementById('cr-lista');
    let contas;
    try { contas = await API.get('/api/financeiro/contas-receber?' + queryPeriodo(filtroReceber)); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta neste período.</p>'; return; }
    const receb = contas.filter((c) => c.status === 'recebido').reduce((s, c) => s + Number(c.valor), 0);
    const pend = contas.filter((c) => c.status === 'pendente').reduce((s, c) => s + Number(c.valor), 0);
    alvo.innerHTML = tabelaContas(contas, 'receber') +
      `<div class="flex flex--between mt-16" style="font-size:14px"><span class="muted">${contas.length} conta(s)</span>
        <span>A receber: <strong style="color:var(--alerta,#b45309)">${UI.moeda(pend)}</strong> · Recebido: <strong style="color:var(--sucesso)">${UI.moeda(receb)}</strong></span></div>`;
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
        const ehVista = c.tipo === 'venda_vista';
        return `<tr>
          <td>${UI.escapar(c.descricao)}${tipo === 'pagar' && c.conta_fixa_id ? ' <span class="badge badge--muted" title="Gerada automaticamente de uma conta fixa">🔁 fixa</span>' : ''}${tipo === 'pagar' && c.total_parcelas > 1 ? ` <span class="badge badge--muted">${c.parcela}/${c.total_parcelas}</span>` : ''}${tipo === 'pagar' && c.categoria_nome ? `<div class="dica">🏷️ ${UI.escapar(c.categoria_nome)}</div>` : ''}</td>
          ${tipo === 'pagar' ? `<td>${UI.escapar(c.fornecedor_nome || '—')}</td>` : ''}
          <td>${c.vencimento || '—'}</td>
          <td>${UI.moeda(c.valor)}</td>
          <td>${situacao(c)}</td>
          <td style="text-align:right;white-space:nowrap">
            ${!quitada && c.status !== 'cancelada' ? `<button class="btn" data-baixar="${c.id}">${tipo === 'pagar' ? 'Pagar' : 'Receber'}</button>` : ''}
            ${quitada && !ehVista ? `<button class="btn btn--secundario" data-reabrir="${c.id}">Reabrir</button>` : ''}
            ${ehVista ? '' : `<button class="btn btn--secundario" data-excluir="${c.id}">✕</button>`}
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

  async function baixar(tipo, id) {
    const ehPagar = tipo === 'pagar';
    contasFin = await API.get('/api/financeiro/contas-financeiras').catch(() => []);
    Modal.abrir({
      titulo: ehPagar ? 'Registrar pagamento' : 'Registrar recebimento', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Data ${ehPagar ? 'do pagamento' : 'do recebimento'}</label><input id="bx-data" type="date" value="${new Date().toISOString().slice(0, 10)}" /></div>
        <div class="campo mt-16"><label>Forma</label><select id="bx-forma">
          ${Object.entries(FORMAS).filter(([k]) => k !== 'prazo').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
        </select></div>
        <div class="campo mt-16"><label>${ehPagar ? 'Sai da conta' : 'Entra na conta'}</label><select id="bx-conta">
          <option value="">Automático (pela forma)</option>
          ${contasFin.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)} — ${UI.moeda(c.saldo_atual)}</option>`).join('')}
        </select><div class="dica">Deixe em "automático" para usar a conta ligada à forma de pagamento.</div></div>`,
      textoConfirmar: 'Confirmar',
      aoConfirmar: async (el) => {
        const conta = el.querySelector('#bx-conta').value || null;
        const campo = ehPagar
          ? { data_pagamento: el.querySelector('#bx-data').value, forma_pagamento: el.querySelector('#bx-forma').value, conta_financeira_id: conta }
          : { data_recebimento: el.querySelector('#bx-data').value, forma_recebimento: el.querySelector('#bx-forma').value, conta_financeira_id: conta };
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
      <div class="card mb-16">
        <div class="flex flex--between" style="align-items:center;flex-wrap:wrap;gap:8px">
          <h3 style="margin:0">💰 Saldos das contas</h3>
          <div class="flex gap-12">
            <button class="btn btn--secundario" id="fx-mapa">⚙️ Formas → contas</button>
            <button class="btn" id="fx-nova-conta">+ Nova conta</button>
          </div>
        </div>
        <div id="fx-contas" class="mt-16">Carregando…</div>
      </div>
      <div class="barra-ferramentas">
        <div class="campo"><label class="dica">De</label><input type="date" id="fx-inicio" value="${mesInicio}"></div>
        <div class="campo"><label class="dica">Até</label><input type="date" id="fx-fim" value="${hoje}"></div>
        <button class="btn btn--secundario" id="fx-aplicar" style="align-self:end">Atualizar</button>
      </div>
      <div id="fx-resultado"></div>`;
    alvo.querySelector('#fx-aplicar').addEventListener('click', carregarFluxo);
    alvo.querySelector('#fx-nova-conta').addEventListener('click', () => formContaFinanceira());
    alvo.querySelector('#fx-mapa').addEventListener('click', configMapa);
    await carregarFluxo();
  }

  async function carregarFluxo() {
    const alvo = document.getElementById('fx-resultado');
    const inicio = document.getElementById('fx-inicio').value;
    const fim = document.getElementById('fx-fim').value;
    let fx;
    try { fx = await API.get(`/api/financeiro/fluxo-caixa?inicio=${inicio}&fim=${fim}`); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    renderContasCards(fx.contas || [], fx.saldo_total_contas || 0);

    alvo.innerHTML = `
      <div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Entradas no período</span><span class="stat__value" style="color:var(--sucesso)">${UI.moeda(fx.entradas)}</span></div>
        <div class="card stat"><span class="stat__label">Saídas no período</span><span class="stat__value" style="color:var(--perigo)">${UI.moeda(fx.saidas)}</span></div>
        <div class="card stat"><span class="stat__label">Resultado do período</span><span class="stat__value" style="color:${fx.saldo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(fx.saldo)}</span></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Composição do período</h3>
        <table class="tabela">
          <tr><td>Vendas à vista (dinheiro, cartão, PIX)</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.vendas_a_vista)}</td></tr>
          <tr><td>Recebimentos de contas (a prazo/parcelas)</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.recebimentos)}</td></tr>
          <tr><td>Pagamentos de contas</td><td style="text-align:right;color:var(--perigo)">- ${UI.moeda(fx.detalhe.pagamentos)}</td></tr>
        </table>
      </div>`;
  }

  function renderContasCards(contas, saldoTotal) {
    const alvo = document.getElementById('fx-contas');
    if (!alvo) return;
    if (!contas.length) { alvo.innerHTML = '<p class="muted">Nenhuma conta cadastrada. Crie uma conta (banco, caixa, máquina de cartão) para controlar os saldos.</p>'; return; }
    alvo.innerHTML = `
      <div class="grid grid--cards">
        ${contas.map((c) => `
          <div class="card stat" style="gap:6px">
            <span class="stat__label">${(TIPOS_CONTA[c.tipo] || TIPOS_CONTA.outro)} · ${UI.escapar(c.nome)}</span>
            <span class="stat__value" style="color:${Number(c.saldo_atual) >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(c.saldo_atual)}</span>
            <div class="flex gap-12 mt-16" style="flex-wrap:wrap">
              <button class="btn btn--secundario" data-conta-ajustar="${c.id}">Ajustar saldo</button>
              <button class="btn btn--secundario" data-conta-extrato="${c.id}">Extrato</button>
              <button class="btn btn--secundario" data-conta-editar="${c.id}">Editar</button>
            </div>
          </div>`).join('')}
      </div>
      <div class="flex flex--between mt-16"><span class="muted">Saldo total das contas</span><strong style="font-size:18px;color:${saldoTotal >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(saldoTotal)}</strong></div>`;

    alvo.querySelectorAll('[data-conta-ajustar]').forEach((b) => b.addEventListener('click', () => ajustarSaldoConta(contas.find((c) => c.id === Number(b.dataset.contaAjustar)))));
    alvo.querySelectorAll('[data-conta-extrato]').forEach((b) => b.addEventListener('click', () => verExtrato(contas.find((c) => c.id === Number(b.dataset.contaExtrato)))));
    alvo.querySelectorAll('[data-conta-editar]').forEach((b) => b.addEventListener('click', () => formContaFinanceira(contas.find((c) => c.id === Number(b.dataset.contaEditar)))));
  }

  function formContaFinanceira(conta) {
    const ehEdicao = !!conta;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar conta' : 'Nova conta financeira', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Nome *</label><input id="fc-nome" value="${UI.escapar(conta ? conta.nome : '')}" placeholder="Ex.: Banco Itaú, Caixa, Máquina Cielo" /></div>
        <div class="campo mt-16"><label>Tipo</label><select id="fc-tipo">
          ${Object.entries(TIPOS_CONTA).map(([k, v]) => `<option value="${k}" ${conta && conta.tipo === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select></div>
        <div class="campo mt-16"><label>Saldo inicial (R$)</label><input id="fc-saldo" type="number" step="0.01" value="${conta ? conta.saldo_inicial : 0}" />
          <div class="dica">Saldo de abertura da conta (o "saldo de entrada"). Depois, use "Ajustar saldo" para correções.</div></div>
        ${ehEdicao ? `<div class="mt-16"><button type="button" class="btn btn--perigo" id="fc-excluir">Excluir conta</button></div>` : ''}`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        const btn = el.querySelector('#fc-excluir');
        if (btn) btn.addEventListener('click', async () => {
          const ok = await UI.confirmar('Excluir esta conta? Se já tiver movimentações, ela será apenas desativada.', { titulo: 'Excluir conta', textoConfirmar: 'Excluir' });
          if (!ok) return;
          try { const r = await API.del(`/api/financeiro/contas-financeiras/${conta.id}`); el.remove(); UI.sucesso(r.inativada ? 'Conta desativada (tinha movimentações).' : 'Conta excluída.'); await carregarFluxo(); }
          catch (e) { UI.erro(e.message); }
        });
      },
      aoConfirmar: async (el) => {
        const dados = { nome: el.querySelector('#fc-nome').value, tipo: el.querySelector('#fc-tipo').value, saldo_inicial: el.querySelector('#fc-saldo').value };
        try {
          if (ehEdicao) await API.put(`/api/financeiro/contas-financeiras/${conta.id}`, dados);
          else await API.post('/api/financeiro/contas-financeiras', dados);
          UI.sucesso(ehEdicao ? 'Conta atualizada.' : 'Conta criada.');
          await carregarFluxo();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function ajustarSaldoConta(conta) {
    Modal.abrir({
      titulo: `Ajustar saldo — ${conta.nome}`, tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Saldo atual</label><input value="${UI.moeda(conta.saldo_atual)}" disabled /></div>
        <div class="campo mt-16"><label>Novo saldo (R$) *</label><input id="aj-saldo" type="number" step="0.01" value="${conta.saldo_atual}" /></div>
        <div class="campo mt-16"><label>Motivo</label><input id="aj-motivo" placeholder="Ex.: conferência do extrato, sangria, aporte" /></div>
        <div class="dica mt-16">A diferença é registrada no extrato da conta como um ajuste.</div>`,
      textoConfirmar: 'Salvar ajuste',
      aoConfirmar: async (el) => {
        try {
          await API.post(`/api/financeiro/contas-financeiras/${conta.id}/ajustar-saldo`, { saldo: el.querySelector('#aj-saldo').value, motivo: el.querySelector('#aj-motivo').value });
          UI.sucesso('Saldo ajustado.'); await carregarFluxo();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function verExtrato(conta) {
    let ext;
    try { ext = await API.get(`/api/financeiro/contas-financeiras/${conta.id}/extrato`); }
    catch (e) { UI.erro(e.message); return; }
    const nomeOrigem = { venda: 'Venda', recebimento: 'Recebimento', pagamento: 'Pagamento', ajuste: 'Ajuste', abertura: 'Abertura' };
    const corpo = `
      <div class="flex flex--between mb-16"><strong>Saldo atual</strong><strong style="color:${ext.saldo_atual >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(ext.saldo_atual)}</strong></div>
      ${ext.movimentos.length ? `<table class="tabela">
        <thead><tr><th>Data</th><th>Origem</th><th>Descrição</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>${ext.movimentos.map((m) => `<tr>
          <td>${UI.dataHora(m.data)}</td>
          <td>${nomeOrigem[m.origem] || m.origem}</td>
          <td>${UI.escapar(m.descricao || '—')}</td>
          <td style="text-align:right;color:${m.tipo === 'entrada' ? 'var(--sucesso)' : 'var(--perigo)'}">${m.tipo === 'entrada' ? '+' : '-'} ${UI.moeda(m.valor)}</td>
        </tr>`).join('')}</tbody></table>` : '<p class="muted">Sem movimentações.</p>'}`;
    Modal.abrir({ titulo: `Extrato — ${conta.nome}`, tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false });
  }

  async function configMapa() {
    let mapa = {}; let contas = [];
    try { [mapa, contas] = await Promise.all([API.get('/api/financeiro/mapa-contas'), API.get('/api/financeiro/contas-financeiras')]); }
    catch (e) { UI.erro(e.message); return; }
    const opcoes = (sel) => '<option value="">— nenhuma —</option>' + contas.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('');
    const corpo = `
      <p class="dica" style="margin-top:0">Escolha em qual conta cada forma de pagamento entra (nas vendas do PDV) ou sai. Você pode sobrescrever na hora de pagar/receber.</p>
      ${Object.entries(FORMAS_SALDO).map(([k, v]) => `
        <div class="campo mt-16"><label>${v}</label><select data-mapa="${k}">${opcoes(mapa[k])}</select></div>`).join('')}`;
    Modal.abrir({
      titulo: 'Formas de pagamento → contas', tamanho: 'modal--pequeno', corpoHTML: corpo, textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const novo = {};
        el.querySelectorAll('[data-mapa]').forEach((s) => { novo[s.dataset.mapa] = s.value || null; });
        try { await API.put('/api/financeiro/mapa-contas', novo); UI.sucesso('Configuração salva.'); }
        catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ------------------------------- DRE -------------------------------
  const dreFiltro = { mes: mesCorrente() };

  async function renderDRE() {
    const alvo = document.getElementById('fin-conteudo');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="flex gap-12" style="align-items:center">
          <button class="btn btn--secundario" id="dre-ant">◀</button>
          <strong style="min-width:150px;text-align:center">${mesLabel(dreFiltro.mes)}</strong>
          <button class="btn btn--secundario" id="dre-prox">▶</button>
        </div>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="dre-categorias">🏷️ Categorias de despesa</button>
      </div>
      <div id="dre-resultado">Carregando…</div>`;
    alvo.querySelector('#dre-ant').addEventListener('click', () => { dreFiltro.mes = mudarMes(dreFiltro.mes, -1); renderDRE(); });
    alvo.querySelector('#dre-prox').addEventListener('click', () => { dreFiltro.mes = mudarMes(dreFiltro.mes, 1); renderDRE(); });
    alvo.querySelector('#dre-categorias').addEventListener('click', gerenciarCategorias);
    await carregarDRE();
  }

  async function carregarDRE() {
    const alvo = document.getElementById('dre-resultado');
    const { inicio, fim } = periodoMes(dreFiltro.mes);
    let d;
    try { d = await API.get(`/api/financeiro/dre?inicio=${inicio}&fim=${fim}`); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    const linha = (rotulo, valor, opts = {}) => `
      <tr class="${opts.forte ? 'dre-forte' : ''}">
        <td style="padding-left:${opts.recuo ? '24px' : '0'}">${opts.sinal || ''} ${UI.escapar(rotulo)}</td>
        <td style="text-align:right;color:${opts.cor || 'inherit'}">${UI.moeda(valor)}</td>
      </tr>`;

    const despesasHTML = d.despesas.length
      ? d.despesas.map((c) => linha(c.nome, c.total, { recuo: true, sinal: '−', cor: 'var(--perigo)' })).join('')
      : '<tr><td class="muted" style="padding-left:24px">Nenhuma despesa no período</td><td></td></tr>';

    alvo.innerHTML = `
      <div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Receita de vendas</span><span class="stat__value" style="color:var(--sucesso)">${UI.moeda(d.receita_bruta)}</span></div>
        <div class="card stat"><span class="stat__label">Lucro bruto <span class="dica">(margem ${d.margem_bruta_pct}%)</span></span><span class="stat__value">${UI.moeda(d.lucro_bruto)}</span></div>
        <div class="card stat"><span class="stat__label">Resultado do mês</span><span class="stat__value" style="color:${d.resultado_liquido >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(d.resultado_liquido)}</span></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Demonstração do Resultado — ${mesLabel(dreFiltro.mes)}</h3>
        <table class="tabela dre-tabela">
          <tbody>
            ${linha('Receita de vendas', d.receita_bruta, { sinal: '', cor: 'var(--sucesso)' })}
            ${linha('(−) CMV — custo da mercadoria vendida', d.cmv, { cor: 'var(--perigo)' })}
            ${linha('= Lucro bruto', d.lucro_bruto, { forte: true })}
            <tr><td colspan="2" style="padding-top:12px"><strong>Despesas operacionais</strong></td></tr>
            ${despesasHTML}
            ${linha('Total de despesas', d.total_despesas, { forte: true, cor: 'var(--perigo)' })}
            ${linha('= Resultado líquido do mês', d.resultado_liquido, { forte: true, cor: d.resultado_liquido >= 0 ? 'var(--sucesso)' : 'var(--perigo)' })}
          </tbody>
        </table>
        <p class="dica mt-16">A receita vem das vendas concluídas no mês; o CMV usa o custo dos itens vendidos; as despesas vêm das contas a pagar do mês, agrupadas por categoria. Compras de mercadoria não entram como despesa (elas viram CMV ao vender). Margem líquida: <strong>${d.margem_liquida_pct}%</strong>.</p>
      </div>`;
  }

  async function gerenciarCategorias() {
    const corpo = `
      <form id="cat-form" class="barra-ferramentas" style="margin-bottom:16px">
        <input id="cat-nome" class="cresce" placeholder="Nova categoria (ex.: Aluguel, Impostos)" required />
        <label class="flex gap-12" style="align-items:center;font-size:13px"><input type="checkbox" id="cat-dre" checked> Entra no DRE</label>
        <button class="btn" type="submit">Adicionar</button>
      </form>
      <div id="cat-lista"></div>`;
    Modal.abrir({
      titulo: 'Categorias de despesa', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const render = () => {
          el.querySelector('#cat-lista').innerHTML = categoriasDespesa.length ? `<table class="tabela">
            <thead><tr><th>Categoria</th><th>No DRE?</th><th></th></tr></thead>
            <tbody>${categoriasDespesa.map((c) => `<tr>
              <td>${UI.escapar(c.nome)}</td>
              <td>${c.considera_dre ? '<span class="badge badge--ok">Sim</span>' : '<span class="badge badge--muted">Não (compra/estoque)</span>'}</td>
              <td style="text-align:right"><button class="btn btn--secundario" data-cat-del="${c.id}">✕</button></td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma categoria.</p>';
          el.querySelectorAll('[data-cat-del]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir esta categoria? As contas já lançadas ficam sem categoria.', { titulo: 'Excluir categoria', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try { await API.del(`/api/financeiro/categorias-despesa/${b.dataset.catDel}`); categoriasDespesa = await API.get('/api/financeiro/categorias-despesa'); render(); UI.sucesso('Categoria excluída.'); }
            catch (e) { UI.erro(e.message); }
          }));
        };
        render();
        el.querySelector('#cat-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          try {
            await API.post('/api/financeiro/categorias-despesa', { nome: el.querySelector('#cat-nome').value, considera_dre: el.querySelector('#cat-dre').checked });
            categoriasDespesa = await API.get('/api/financeiro/categorias-despesa');
            el.querySelector('#cat-nome').value = ''; render(); UI.sucesso('Categoria adicionada.');
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }

  return { titulo: 'Financeiro', render };
})();
