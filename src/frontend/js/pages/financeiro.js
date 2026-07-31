'use strict';

/**
 * Pagina Financeiro: contas a pagar (com parcelamento e contas fixas),
 * contas a receber, saldos das contas financeiras e fluxo de caixa.
 * As listas de contas mostram, por padrao, o mes corrente (com navegacao
 * de mes e opcao "todas").
 *
 * No ramo "instituto" esta e a UNICA tela de dinheiro: a arrecadacao
 * (ofertas, projetos, mantenedores, prestacao de contas) entra aqui como
 * abas, e nao numa tela separada. O motivo e simples — oferta, saldo e
 * conciliacao falam do mesmo dinheiro; separados, nunca fechavam entre si.
 */
window.PaginaFinanceiro = (function () {
  let fornecedores = [];
  let clientes = [];
  let contasFin = [];
  let categoriasDespesa = [];
  let projetos = [];
  let abaAtual = 'pagar';

  const ehInstituto = () => window.__ramoServico === 'instituto';

  // Abas do instituto: agrupadas em nivel 1 (o assunto) e nivel 2 (o detalhe),
  // para nao virar uma fileira de 11 abas soltas.
  const ABAS_INSTITUTO = [
    { id: 'fluxo', rotulo: '💰 Caixa e saldos' },
    {
      id: 'entradas',
      rotulo: '🤝 Entradas',
      subs: [
        { id: 'ofertas', rotulo: 'Ofertas' },
        { id: 'receber', rotulo: 'A receber' },
        { id: 'assinaturas', rotulo: 'Contribuição mensal' },
        { id: 'especie', rotulo: 'Doações em espécie' },
      ],
    },
    {
      id: 'saidas',
      rotulo: '💸 Saídas',
      subs: [
        { id: 'pagar', rotulo: 'Despesas' },
        { id: 'fixas', rotulo: 'Despesas fixas' },
      ],
    },
    { id: 'conciliacao', rotulo: '🏦 Conciliação' },
    {
      id: 'prestacao',
      rotulo: '📊 Prestação de contas',
      subs: [
        { id: 'contas', rotulo: 'Resumo do período' },
        { id: 'projetos', rotulo: 'Projetos' },
        { id: 'mantenedores', rotulo: 'Mantenedores' },
      ],
    },
  ];
  const subAtual = { entradas: 'ofertas', saidas: 'pagar', prestacao: 'contas' };

  const ABAS_PADRAO = [
    { id: 'pagar', rotulo: 'A Pagar' },
    { id: 'fixas', rotulo: 'Contas Fixas' },
    { id: 'receber', rotulo: 'A Receber' },
    { id: 'assinaturas', rotulo: 'Mensalidades' },
    { id: 'fluxo', rotulo: 'Fluxo de Caixa' },
    { id: 'dre', rotulo: 'DRE' },
    { id: 'conciliacao', rotulo: '🏦 Conciliação' },
  ];
  const FORMAS = { dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', pix: 'PIX', prazo: 'A prazo', boleto: 'Boleto', transferencia: 'Transferência' };
  // Formas que alimentam um saldo (a prazo nao entra em conta na hora).
  const FORMAS_SALDO = { dinheiro: 'Dinheiro', pix: 'PIX', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', transferencia: 'Transferência', boleto: 'Boleto' };
  const TIPOS_CONTA = { dinheiro: '💵 Dinheiro', banco: '🏦 Banco', cartao: '💳 Máquina de cartão', outro: '📦 Outro' };

  const filtroPagar = { mes: mesCorrente(), todos: false, status: '' };
  const filtroReceber = { mes: mesCorrente(), todos: false, status: '' };
  const filtroFluxo = { conta_financeira_id: '' };

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
    [fornecedores, clientes, categoriasDespesa] = await Promise.all([
      API.get('/api/fornecedores').catch(() => []),
      API.get('/api/clientes').catch(() => []),
      API.get('/api/financeiro/categorias-despesa').catch(() => []),
    ]);
    if (ehInstituto()) {
      projetos = await API.get('/api/arrecadacao/projetos').catch(() => []);
      if (window.SecoesArrecadacao) await SecoesArrecadacao.carregarProjetos();
    }

    const abas = ehInstituto() ? ABAS_INSTITUTO : ABAS_PADRAO;
    if (!abas.some((a) => a.id === abaAtual)) abaAtual = abas[0].id;

    container.innerHTML = `
      <div id="fin-alertas" class="mb-16"></div>
      <div class="tabs">
        ${abas.map((a) => `<div class="tab ${a.id === abaAtual ? 'ativo' : ''}" data-aba="${a.id}">${a.rotulo}</div>`).join('')}
      </div>
      <div id="fin-conteudo"></div>`;

    container.querySelectorAll('.tabs > .tab').forEach((t) => t.addEventListener('click', () => {
      abaAtual = t.dataset.aba;
      container.querySelectorAll('.tabs > .tab').forEach((x) => x.classList.toggle('ativo', x === t));
      trocarAba();
    }));

    await Promise.all([
      API.post('/api/financeiro/contas-fixas/gerar-pendentes', {}).catch(() => {}),
      API.post('/api/financeiro/assinaturas/gerar-pendentes', {}).catch(() => {}),
    ]);
    carregarAlertas();
    trocarAba();
  }

  /** Onde a aba atual deve desenhar: dentro da sub-aba, se houver. */
  function alvoConteudo() {
    return document.getElementById('fin-sub') || document.getElementById('fin-conteudo');
  }

  function secoes() { return window.SecoesArrecadacao; }

  const RENDERIZADORES = {
    pagar: () => renderPagar(),
    fixas: () => renderContasFixas(),
    receber: () => renderReceber(),
    assinaturas: () => renderAssinaturas(),
    fluxo: () => renderFluxo(),
    dre: () => renderDRE(),
    conciliacao: () => renderConciliacao(),
    ofertas: () => { secoes().montarEm('fin-sub'); return secoes().ofertas(); },
    especie: () => { secoes().montarEm('fin-sub'); return secoes().especie(); },
    mantenedores: () => { secoes().montarEm('fin-sub'); return secoes().mantenedores(); },
    projetos: () => { secoes().montarEm('fin-sub'); return secoes().projetosSecao(); },
    contas: () => { secoes().montarEm('fin-sub'); return secoes().prestacaoDeContas(); },
  };

  async function carregarAlertas() {
    const alvo = document.getElementById('fin-alertas');
    let a;
    try { a = await API.get('/api/financeiro/alertas?dias=7'); } catch { return; }
    const blocos = [];
    const rotuloPagar = ehInstituto() ? 'despesa(s)' : 'conta(s) a pagar';
    if (a.pagar.vencidas.c > 0) blocos.push(`<span class="badge badge--erro">${a.pagar.vencidas.c} ${rotuloPagar} vencida(s) — ${UI.moeda(a.pagar.vencidas.v)}</span>`);
    if (a.pagar.aVencer.c > 0) blocos.push(`<span class="badge badge--alerta">${a.pagar.aVencer.c} a pagar em 7 dias — ${UI.moeda(a.pagar.aVencer.v)}</span>`);
    if (a.receber.vencidas.c > 0) blocos.push(`<span class="badge badge--alerta">${a.receber.vencidas.c} a receber vencida(s) — ${UI.moeda(a.receber.vencidas.v)}</span>`);
    if (a.receber.aVencer.c > 0) blocos.push(`<span class="badge badge--muted">${a.receber.aVencer.c} a receber em 7 dias — ${UI.moeda(a.receber.aVencer.v)}</span>`);
    alvo.innerHTML = blocos.length ? `<div class="card" style="display:flex;gap:8px;flex-wrap:wrap">${blocos.join(' ')}</div>` : '';
  }

  function trocarAba() {
    const conteudo = document.getElementById('fin-conteudo');
    if (!conteudo) return;
    // Limpa antes de trocar: sem isso, um #fin-sub que sobrou da aba anterior
    // faria a proxima aba desenhar dentro da barra de sub-abas antiga.
    conteudo.innerHTML = '';

    if (!ehInstituto()) { (RENDERIZADORES[abaAtual] || RENDERIZADORES.fluxo)(); return; }

    const def = ABAS_INSTITUTO.find((a) => a.id === abaAtual) || ABAS_INSTITUTO[0];
    if (!def.subs) { (RENDERIZADORES[def.id] || RENDERIZADORES.fluxo)(); return; }

    conteudo.innerHTML = `
      <div class="tabs tabs--sub">
        ${def.subs.map((s) => `<div class="tab ${s.id === subAtual[def.id] ? 'ativo' : ''}" data-sub="${s.id}">${s.rotulo}</div>`).join('')}
      </div>
      <div id="fin-sub"></div>`;
    conteudo.querySelectorAll('[data-sub]').forEach((t) => t.addEventListener('click', () => {
      subAtual[def.id] = t.dataset.sub;
      conteudo.querySelectorAll('[data-sub]').forEach((x) => x.classList.toggle('ativo', x === t));
      document.getElementById('fin-sub').innerHTML = '';
      RENDERIZADORES[subAtual[def.id]]();
    }));
    RENDERIZADORES[subAtual[def.id]]();
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
        <button class="btn" id="${prefixo}-nova">+ ${rotuloNovaConta(prefixo)}</button>
      </div>`;
  }

  function rotuloNovaConta(prefixo) {
    if (ehInstituto()) return prefixo === 'cp' ? 'Nova despesa' : 'Nova cobrança a receber';
    return prefixo === 'cp' ? 'Nova conta a pagar' : 'Nova conta a receber';
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
    const alvo = alvoConteudo();
    const statusOpcoes = ['<option value="">Todas</option>', '<option value="pendente">Pendentes</option>', '<option value="pago">Pagas</option>']
      .map((o) => o.replace(`value="${filtroPagar.status}"`, `value="${filtroPagar.status}" selected`)).join('');
    alvo.innerHTML = barraMes(filtroPagar, 'cp', statusOpcoes) + '<div class="card"><div id="cp-lista">Carregando…</div></div>';
    ligarBarraMes(alvo, filtroPagar, 'cp', listarPagar);
    // Sem a arrow, o evento de clique chegaria como se fosse a conta e o
    // formulario abriria em modo de edicao de um registro inexistente.
    alvo.querySelector('#cp-nova').addEventListener('click', () => formPagar());
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
    ligarAcoes(alvo, 'pagar', contas);
  }

  async function formPagar(cp) {
    const ehEdicao = !!cp;
    const inst = ehInstituto();
    // Projeto recem-criado na aba ao lado precisa aparecer aqui na hora.
    if (inst) projetos = await API.get('/api/arrecadacao/projetos').catch(() => projetos);
    Modal.abrir({
      titulo: ehEdicao ? (inst ? 'Editar despesa' : 'Editar conta a pagar') : (inst ? 'Nova despesa' : 'Nova conta a pagar'), tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Descrição *</label><input id="cp-desc" value="${UI.escapar(cp ? cp.descricao : '')}" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Fornecedor</label><select id="cp-forn"><option value="">—</option>${fornecedores.map((f) => `<option value="${f.id}" ${cp && String(cp.fornecedor_id) === String(f.id) ? 'selected' : ''}>${UI.escapar(f.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Categoria${inst ? '' : ' (DRE)'}</label><select id="cp-cat"><option value="">— sem categoria —</option>${categoriasDespesa.map((c) => `<option value="${c.id}" ${cp && String(cp.categoria_despesa_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}${c.considera_dre ? '' : ' (fora do DRE)'}</option>`).join('')}</select></div>
        </div>
        ${inst ? `
        <div class="campo mt-16"><label>Projeto</label>
          <select id="cp-projeto"><option value="">Nenhum (custeio geral)</option>${projetos.map((p) => `<option value="${p.id}" ${cp && String(cp.projeto_id) === String(p.id) ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}</select>
          <div class="dica">Marcando o projeto, esta despesa entra no "gasto" dele na prestação de contas.</div>
        </div>` : ''}
        ${!ehEdicao ? `
        <div class="campo mt-16"><label>Como vai informar o valor?</label>
          <div class="flex gap-12" style="align-items:center;flex-wrap:wrap">
            <label class="flex gap-12" style="align-items:center"><input type="radio" name="cp-modo" value="unico" checked> Valor único (divide pelas parcelas)</label>
            <label class="flex gap-12" style="align-items:center"><input type="radio" name="cp-modo" value="parcela"> Valor de cada parcela</label>
          </div>
        </div>` : ''}
        <div class="campo mt-16"><label id="cp-valor-label">${ehEdicao ? 'Valor (R$) *' : 'Valor total (R$) *'}</label><input id="cp-valor" type="number" step="0.01" min="0" value="${cp ? cp.valor : ''}" /></div>
        ${!ehEdicao ? `
        <div class="form-grid mt-16">
          <div class="campo"><label>Parcelas</label><input id="cp-parc" type="number" min="1" value="1" /></div>
          <div class="campo" id="cp-parcini-wrap" style="display:none"><label>Começa na parcela nº</label><input id="cp-parcini" type="number" min="1" value="1" /></div>
        </div>` : ''}
        <div class="campo mt-16"><label>${ehEdicao ? 'Vencimento' : '1º vencimento'}</label><input id="cp-venc" type="date" value="${cp ? (cp.vencimento || '') : new Date().toISOString().slice(0, 10)}" /></div>
        <div class="dica mt-16">${ehEdicao ? 'Editando apenas este lançamento.' : 'A categoria organiza a conta no DRE. Com mais de uma parcela, cada parcela vence a cada mês (uma conta por parcela).'}</div>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        if (ehEdicao) return;
        const parc = el.querySelector('#cp-parc');
        const parciniWrap = el.querySelector('#cp-parcini-wrap');
        const label = el.querySelector('#cp-valor-label');
        parc.addEventListener('input', () => {
          parciniWrap.style.display = Number(parc.value) > 1 ? '' : 'none';
        });
        el.querySelectorAll('input[name="cp-modo"]').forEach((r) => r.addEventListener('change', () => {
          const modo = el.querySelector('input[name="cp-modo"]:checked').value;
          label.textContent = modo === 'parcela' ? 'Valor de cada parcela (R$) *' : 'Valor total (R$) *';
        }));
      },
      aoConfirmar: async (el) => {
        try {
          const projetoSel = el.querySelector('#cp-projeto');
          const projetoId = projetoSel ? (projetoSel.value || null) : undefined;
          if (ehEdicao) {
            await API.put(`/api/financeiro/contas-pagar/${cp.id}`, {
              descricao: el.querySelector('#cp-desc').value, fornecedor_id: el.querySelector('#cp-forn').value || null,
              categoria_despesa_id: el.querySelector('#cp-cat').value || null,
              projeto_id: projetoId,
              valor: el.querySelector('#cp-valor').value, vencimento: el.querySelector('#cp-venc').value || null,
            });
            UI.sucesso(inst ? 'Despesa atualizada.' : 'Conta atualizada.');
          } else {
            const modo = el.querySelector('input[name="cp-modo"]:checked').value;
            const r = await API.post('/api/financeiro/contas-pagar', {
              descricao: el.querySelector('#cp-desc').value, fornecedor_id: el.querySelector('#cp-forn').value || null,
              categoria_despesa_id: el.querySelector('#cp-cat').value || null,
              projeto_id: projetoId,
              valor: el.querySelector('#cp-valor').value, valor_modo: modo,
              parcelas: el.querySelector('#cp-parc').value, parcela_inicial: el.querySelector('#cp-parcini').value,
              primeiro_vencimento: el.querySelector('#cp-venc').value || null,
            });
            UI.sucesso(r && r.criadas ? `${r.criadas} parcela(s) criada(s).` : (inst ? 'Despesa lançada.' : 'Conta criada.'));
          }
          await listarPagar(); carregarAlertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // --------------------------- Contas Fixas ---------------------------
  async function renderContasFixas() {
    const alvo = alvoConteudo();
    alvo.innerHTML = `
      <p class="dica mb-16">Cadastre contas que se repetem todo mês (aluguel, internet, água, luz…). Elas são lançadas automaticamente em "${ehInstituto() ? 'Despesas' : 'A Pagar'}" no início de cada mês.</p>
      <div class="barra-ferramentas"><div class="cresce"></div><button class="btn" id="cf-nova">+ ${ehInstituto() ? 'Nova despesa fixa' : 'Nova conta fixa'}</button></div>
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

  // -------------------------- Mensalidades ----------------------------
  async function renderAssinaturas() {
    const alvo = alvoConteudo();
    alvo.innerHTML = `
      <p class="dica mb-16">${ehInstituto()
        ? 'Cadastre a contribuição mensal de cada mantenedor. Todo mês, no dia combinado, a cobrança é lançada automaticamente em "A receber" — quando o dinheiro cair, registre a entrada em Ofertas para ela ir ao caixa e ao recibo.'
        : 'Cadastre mensalidades de clientes (academia, escola, plano de serviço…). Todo mês, a cobrança é lançada automaticamente em "A Receber", no dia de vencimento escolhido.'}</p>
      <div class="barra-ferramentas"><div class="cresce"></div><button class="btn" id="as-nova">+ ${ehInstituto() ? 'Nova contribuição mensal' : 'Nova mensalidade'}</button></div>
      <div class="card"><div id="as-lista">Carregando…</div></div>`;
    alvo.querySelector('#as-nova').addEventListener('click', () => formAssinatura());
    await listarAssinaturas();
  }

  async function listarAssinaturas() {
    const alvo = document.getElementById('as-lista');
    let assinaturas;
    try { assinaturas = await API.get('/api/financeiro/assinaturas'); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!assinaturas.length) { alvo.innerHTML = '<p class="muted">Nenhuma mensalidade cadastrada.</p>'; return; }
    const hoje = new Date().toISOString().slice(0, 10);
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Cliente</th><th>Descrição</th><th>Dia venc.</th><th>Valor</th><th>Vigência</th><th>Status</th><th></th></tr></thead>
      <tbody>${assinaturas.map((a) => {
        const encerrada = a.data_fim && a.data_fim < hoje;
        return `<tr style="${a.ativa && !encerrada ? '' : 'opacity:.55'}">
        <td>${UI.escapar(a.cliente_nome)}</td>
        <td>${UI.escapar(a.descricao)}</td>
        <td>Dia ${a.dia_vencimento}</td>
        <td>${UI.moeda(a.valor)}</td>
        <td>${a.data_inicio || '—'} até ${a.data_fim || 'indeterminado'}</td>
        <td>${encerrada ? '<span class="badge badge--muted">Encerrada</span>' : (a.ativa ? '<span class="badge badge--ok">Ativa</span>' : '<span class="badge badge--muted">Pausada</span>')}</td>
        <td style="text-align:right;white-space:nowrap">
          <button class="btn btn--secundario" data-as-pausar="${a.id}" data-ativa="${a.ativa}">${a.ativa ? 'Pausar' : 'Reativar'}</button>
          <button class="btn btn--secundario" data-as-editar="${a.id}">Editar</button>
          <button class="btn btn--secundario" data-as-excluir="${a.id}">✕</button>
        </td>
      </tr>`;
      }).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-as-editar]').forEach((b) => b.addEventListener('click', () => {
      const a = assinaturas.find((x) => x.id === Number(b.dataset.asEditar));
      formAssinatura(a);
    }));
    alvo.querySelectorAll('[data-as-pausar]').forEach((b) => b.addEventListener('click', async () => {
      const ativa = b.dataset.ativa === '1';
      try {
        await API.put(`/api/financeiro/assinaturas/${b.dataset.asPausar}`, { ativa: !ativa });
        UI.sucesso(ativa ? 'Mensalidade pausada.' : 'Mensalidade reativada.');
        await listarAssinaturas();
      } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-as-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta mensalidade? As cobranças já lançadas em meses anteriores não serão apagadas.', { titulo: 'Excluir mensalidade', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/financeiro/assinaturas/${b.dataset.asExcluir}`); UI.sucesso('Mensalidade excluída.'); await listarAssinaturas(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formAssinatura(a) {
    const ehEdicao = !!a;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar mensalidade' : 'Nova mensalidade', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Cliente *</label><select id="as-cliente" ${ehEdicao ? 'disabled' : ''}>
          <option value="">— selecione —</option>${clientes.map((c) => `<option value="${c.id}" ${a && String(a.cliente_id) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('')}
        </select></div>
        <div class="campo mt-16"><label>Descrição *</label><input id="as-desc" value="${UI.escapar(a ? a.descricao : '')}" placeholder="Ex.: Mensalidade academia, Plano manutenção" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Valor (R$) *</label><input id="as-valor" type="number" step="0.01" min="0" value="${a ? a.valor : ''}" /></div>
          <div class="campo"><label>Dia do vencimento *</label><input id="as-dia" type="number" min="1" max="31" value="${a ? a.dia_vencimento : ''}" /></div>
        </div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Início</label><input id="as-inicio" type="date" value="${a ? a.data_inicio : new Date().toISOString().slice(0, 10)}" /></div>
          <div class="campo"><label>Encerramento <span class="dica">(opcional)</span></label><input id="as-fim" type="date" value="${a && a.data_fim ? a.data_fim : ''}" /></div>
        </div>
        <div class="campo mt-16"><label>Observação</label><input id="as-obs" value="${UI.escapar(a && a.observacao ? a.observacao : '')}" /></div>
        <div class="dica mt-16">Todo mês, no dia informado (ajustado se o mês não tiver esse dia), uma conta a receber é criada automaticamente para o cliente, dentro do período de vigência.</div>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const dados = {
          cliente_id: el.querySelector('#as-cliente').value || null,
          descricao: el.querySelector('#as-desc').value,
          valor: el.querySelector('#as-valor').value,
          dia_vencimento: el.querySelector('#as-dia').value,
          data_inicio: el.querySelector('#as-inicio').value || null,
          data_fim: el.querySelector('#as-fim').value || null,
          observacao: el.querySelector('#as-obs').value,
        };
        try {
          if (ehEdicao) await API.put(`/api/financeiro/assinaturas/${a.id}`, dados);
          else await API.post('/api/financeiro/assinaturas', dados);
          UI.sucesso(ehEdicao ? 'Mensalidade atualizada.' : 'Mensalidade cadastrada.');
          await API.post('/api/financeiro/assinaturas/gerar-pendentes', {}).catch(() => {});
          await listarAssinaturas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ---------------------------- A Receber ----------------------------
  async function renderReceber() {
    const alvo = alvoConteudo();
    const statusOpcoes = ['<option value="">Todas</option>', '<option value="pendente">Pendentes</option>', '<option value="recebido">Recebidas</option>', '<option value="cancelada">Canceladas</option>']
      .map((o) => o.replace(`value="${filtroReceber.status}"`, `value="${filtroReceber.status}" selected`)).join('');
    alvo.innerHTML = barraMes(filtroReceber, 'cr', statusOpcoes) + '<div class="card"><div id="cr-lista">Carregando…</div></div>';
    ligarBarraMes(alvo, filtroReceber, 'cr', listarReceber);
    alvo.querySelector('#cr-nova').addEventListener('click', () => formReceber());
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
    ligarAcoes(alvo, 'receber', contas);
  }

  function formReceber(cr) {
    const ehEdicao = !!cr;
    Modal.abrir({
      titulo: ehEdicao ? 'Editar conta a receber' : 'Nova conta a receber', tamanho: 'modal--pequeno',
      corpoHTML: `
        <div class="campo"><label>Descrição *</label><input id="cr-desc" value="${UI.escapar(cr ? cr.descricao : '')}" /></div>
        ${!ehEdicao ? `
        <div class="campo mt-16"><label>Como vai informar o valor?</label>
          <div class="flex gap-12" style="align-items:center;flex-wrap:wrap">
            <label class="flex gap-12" style="align-items:center"><input type="radio" name="cr-modo" value="unico" checked> Valor único (divide pelas parcelas)</label>
            <label class="flex gap-12" style="align-items:center"><input type="radio" name="cr-modo" value="parcela"> Valor de cada parcela</label>
          </div>
        </div>` : ''}
        <div class="campo mt-16"><label id="cr-valor-label">${ehEdicao ? 'Valor (R$) *' : 'Valor total (R$) *'}</label><input id="cr-valor" type="number" step="0.01" min="0" value="${cr ? cr.valor : ''}" /></div>
        ${!ehEdicao ? `
        <div class="form-grid mt-16">
          <div class="campo"><label>Parcelas</label><input id="cr-parc" type="number" min="1" value="1" /></div>
          <div class="campo" id="cr-parcini-wrap" style="display:none"><label>Começa na parcela nº</label><input id="cr-parcini" type="number" min="1" value="1" /></div>
        </div>` : ''}
        <div class="campo mt-16"><label>${ehEdicao ? 'Vencimento' : '1º vencimento'}</label><input id="cr-venc" type="date" value="${cr ? (cr.vencimento || '') : new Date().toISOString().slice(0, 10)}" /></div>
        <div class="dica mt-16">${ehEdicao ? 'Editando apenas este lançamento.' : 'Parcelas mensais são geradas automaticamente.'}</div>`,
      textoConfirmar: 'Salvar',
      aoAbrir: (el) => {
        if (ehEdicao) return;
        const parc = el.querySelector('#cr-parc');
        const parciniWrap = el.querySelector('#cr-parcini-wrap');
        const label = el.querySelector('#cr-valor-label');
        parc.addEventListener('input', () => {
          parciniWrap.style.display = Number(parc.value) > 1 ? '' : 'none';
        });
        el.querySelectorAll('input[name="cr-modo"]').forEach((r) => r.addEventListener('change', () => {
          const modo = el.querySelector('input[name="cr-modo"]:checked').value;
          label.textContent = modo === 'parcela' ? 'Valor de cada parcela (R$) *' : 'Valor total (R$) *';
        }));
      },
      aoConfirmar: async (el) => {
        try {
          if (ehEdicao) {
            await API.put(`/api/financeiro/contas-receber/${cr.id}`, {
              descricao: el.querySelector('#cr-desc').value,
              valor: el.querySelector('#cr-valor').value, vencimento: el.querySelector('#cr-venc').value || null,
            });
            UI.sucesso('Conta atualizada.');
          } else {
            const modo = el.querySelector('input[name="cr-modo"]:checked').value;
            const r = await API.post('/api/financeiro/contas-receber', {
              descricao: el.querySelector('#cr-desc').value,
              valor: el.querySelector('#cr-valor').value, valor_modo: modo,
              parcelas: el.querySelector('#cr-parc').value, parcela_inicial: el.querySelector('#cr-parcini').value,
              primeiro_vencimento: el.querySelector('#cr-venc').value || null,
            });
            UI.sucesso(`${r.criadas} parcela(s) criada(s).`);
          }
          await listarReceber(); carregarAlertas();
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
          <td>${UI.escapar(c.descricao)}${tipo === 'pagar' && c.conta_fixa_id ? ' <span class="badge badge--muted" title="Gerada automaticamente de uma conta fixa">🔁 fixa</span>' : ''}${tipo === 'receber' && c.assinatura_id ? ' <span class="badge badge--muted" title="Gerada automaticamente de uma mensalidade">🔁 mensalidade</span>' : ''}${tipo === 'pagar' && c.total_parcelas > 1 ? ` <span class="badge badge--muted">${c.parcela}/${c.total_parcelas}</span>` : ''}${tipo === 'pagar' && c.categoria_nome ? `<div class="dica">🏷️ ${UI.escapar(c.categoria_nome)}</div>` : ''}${tipo === 'pagar' && c.projeto_nome ? `<div class="dica">📁 ${UI.escapar(c.projeto_nome)}</div>` : ''}</td>
          ${tipo === 'pagar' ? `<td>${UI.escapar(c.fornecedor_nome || '—')}</td>` : ''}
          <td>${c.vencimento || '—'}</td>
          <td>${UI.moeda(c.valor)}</td>
          <td>${situacao(c)}</td>
          <td style="text-align:right;white-space:nowrap">
            ${!quitada && c.status !== 'cancelada' ? `<button class="btn" data-baixar="${c.id}">${tipo === 'pagar' ? 'Pagar' : 'Receber'}</button>` : ''}
            ${tipo === 'receber' && c.status === 'pendente' ? `<button class="btn btn--secundario" data-cobranca="${c.id}">🧾 Cobrança</button>` : ''}
            ${quitada && !ehVista ? `<button class="btn btn--secundario" data-reabrir="${c.id}">Reabrir</button>` : ''}
            ${ehVista ? '' : `<button class="btn btn--secundario" data-editar="${c.id}">Editar</button>`}
            ${ehVista ? '' : `<button class="btn btn--secundario" data-excluir="${c.id}">✕</button>`}
          </td>
        </tr>`;
      }).join('')}</tbody></table>`;
  }

  function ligarAcoes(alvo, tipo, contas) {
    const base = '/api/financeiro/contas-' + tipo;
    const recarregar = tipo === 'pagar' ? listarPagar : listarReceber;
    const formulario = tipo === 'pagar' ? formPagar : formReceber;
    alvo.querySelectorAll('[data-baixar]').forEach((b) => b.addEventListener('click', () => baixar(tipo, b.dataset.baixar)));
    alvo.querySelectorAll('[data-cobranca]').forEach((b) => b.addEventListener('click', () => imprimirCobranca(b.dataset.cobranca)));
    alvo.querySelectorAll('[data-reabrir]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.post(`${base}/${b.dataset.reabrir}/reabrir`, {}); await recarregar(); carregarAlertas(); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
      const c = contas.find((x) => x.id === Number(b.dataset.editar));
      if (c) formulario(c);
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta conta?', { titulo: 'Excluir conta', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`${base}/${b.dataset.excluir}`); await recarregar(); carregarAlertas(); UI.sucesso('Conta excluída.'); } catch (e) { UI.erro(e.message); }
    }));
  }

  // ------------------------ Cobrança (PIX) ---------------------------
  async function imprimirCobranca(id) {
    let dados, cfg;
    try {
      [dados, cfg] = await Promise.all([
        API.get(`/api/financeiro/contas-receber/${id}/cobranca`),
        API.get('/api/config').catch(() => ({})),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const c = dados.conta;
    const itensHTML = dados.itens.length ? `
      <table>
        <thead><tr><th style="text-align:left">Item</th><th>Qtd</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>${dados.itens.map((i) => `<tr>
          <td>${UI.escapar(i.descricao || '')}</td>
          <td style="text-align:center">${UI.numero(i.quantidade)}</td>
          <td style="text-align:right">${UI.moeda(i.valor_total)}</td>
        </tr>`).join('')}</tbody>
      </table>` : '';

    const html = `<html><head><meta charset="utf-8"><title>Cobrança #${c.id}</title>
      <style>
        * { font-family: Arial, Helvetica, sans-serif; }
        body { max-width: 480px; margin: 0 auto; padding: 24px; color:#111; }
        h2 { margin: 4px 0; }
        table { width:100%; border-collapse:collapse; margin: 12px 0; }
        td, th { padding:5px 0; border-bottom:1px solid #ddd; font-size:13px; }
        .center { text-align:center; }
        .tot { font-size:20px; font-weight:bold; margin-top:8px; }
        .pix-box { text-align:center; margin-top:24px; padding:16px; border:1px dashed #999; border-radius:8px; }
        .pix-copia { word-break: break-all; font-size:10px; background:#f4f4f4; padding:8px; border-radius:4px; margin-top:10px; }
      </style></head><body>
      ${cfg.loja_logo ? `<div class="center"><img src="${cfg.loja_logo}" style="max-width:120px;max-height:60px;object-fit:contain"></div>` : ''}
      <h2 class="center">${UI.escapar(cfg.nome_loja || 'Cobrança')}</h2>
      <p class="center" style="color:#555">Cobrança referente a: ${UI.escapar(c.descricao)}</p>
      <div class="center">Cliente: <strong>${UI.escapar(c.cliente_nome || '—')}</strong></div>
      <div class="center">Vencimento: <strong>${c.vencimento || '—'}</strong></div>
      ${itensHTML}
      <div class="center tot">Total: ${UI.moeda(c.valor)}</div>
      <div class="pix-box">
        <div>Pague com PIX — aponte a câmera do seu banco para o QR Code</div>
        <img src="${dados.pix.qr_data_url}" style="width:220px;height:220px;margin-top:10px" />
        <div class="dica" style="margin-top:8px">Ou copie o código:</div>
        <div class="pix-copia">${UI.escapar(dados.pix.payload)}</div>
      </div>
      </body></html>`;
    UI.baixarPDF(html, `cobranca-${c.id}.pdf`);
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
    const alvo = alvoConteudo();
    contasFin = await API.get('/api/financeiro/contas-financeiras').catch(() => []);
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
        <div class="campo"><label class="dica">Conta</label><select id="fx-conta"><option value="">Todas as contas (visão geral)</option>${contasFin.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
        <div class="campo"><label class="dica">De</label><input type="date" id="fx-inicio" value="${mesInicio}"></div>
        <div class="campo"><label class="dica">Até</label><input type="date" id="fx-fim" value="${hoje}"></div>
        <button class="btn btn--secundario" id="fx-aplicar" style="align-self:end">Atualizar</button>
      </div>
      <div id="fx-resultado"></div>`;
    alvo.querySelector('#fx-conta').value = filtroFluxo.conta_financeira_id;
    alvo.querySelector('#fx-aplicar').addEventListener('click', () => { filtroFluxo.conta_financeira_id = document.getElementById('fx-conta').value; carregarFluxo(); });
    alvo.querySelector('#fx-nova-conta').addEventListener('click', () => formContaFinanceira());
    alvo.querySelector('#fx-mapa').addEventListener('click', configMapa);
    await carregarFluxo();
  }

  async function carregarFluxo() {
    const alvo = document.getElementById('fx-resultado');
    const inicio = document.getElementById('fx-inicio').value;
    const fim = document.getElementById('fx-fim').value;
    let fx;
    try {
      const params = new URLSearchParams({ inicio, fim });
      if (filtroFluxo.conta_financeira_id) params.set('conta_financeira_id', filtroFluxo.conta_financeira_id);
      fx = await API.get(`/api/financeiro/fluxo-caixa?${params.toString()}`);
    } catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    renderContasCards(fx.contas || [], fx.saldo_total_contas || 0);

    const painelConta = fx.conta_financeira ? `
      <div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Saldo no início do período</span><span class="stat__value">${UI.moeda(fx.saldo_inicio_periodo)}</span></div>
        <div class="card stat"><span class="stat__label">Saldo no fim do período</span><span class="stat__value" style="color:${fx.saldo_fim_periodo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(fx.saldo_fim_periodo)}</span></div>
      </div>
      <p class="dica mb-16">Saldo de <strong>${UI.escapar(fx.conta_financeira.nome)}</strong> no fim do período selecionado — use para conferir com o saldo final do extrato do banco (aba Conciliação) antes de exportar para o contador.</p>` : '';

    alvo.innerHTML = `
      ${painelConta}
      <div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Entradas no período</span><span class="stat__value" style="color:var(--sucesso)">${UI.moeda(fx.entradas)}</span></div>
        <div class="card stat"><span class="stat__label">Saídas no período</span><span class="stat__value" style="color:var(--perigo)">${UI.moeda(fx.saidas)}</span></div>
        <div class="card stat"><span class="stat__label">Resultado do período</span><span class="stat__value" style="color:${fx.saldo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(fx.saldo)}</span></div>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Composição do período</h3>
        <table class="tabela">
          ${ehInstituto() ? '' : `<tr><td>Vendas à vista (dinheiro, cartão, PIX)</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.vendas_a_vista)}</td></tr>`}
          ${ehInstituto() || Number(fx.detalhe.ofertas || 0) > 0 ? `<tr><td>Ofertas e doações recebidas</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.ofertas || 0)}</td></tr>` : ''}
          <tr><td>${ehInstituto() ? 'Cobranças recebidas (contribuições, mensalidades)' : 'Recebimentos de contas (a prazo/parcelas)'}</td><td style="text-align:right;color:var(--sucesso)">+ ${UI.moeda(fx.detalhe.recebimentos)}</td></tr>
          <tr><td>${ehInstituto() ? 'Despesas pagas' : 'Pagamentos de contas'}</td><td style="text-align:right;color:var(--perigo)">- ${UI.moeda(fx.detalhe.pagamentos)}</td></tr>
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

  const NOME_ORIGEM_MOV = { venda: 'Venda', recebimento: 'Recebimento', pagamento: 'Pagamento', ajuste: 'Ajuste', abertura: 'Abertura', oferta: '🤝 Oferta' };

  async function verExtrato(conta) {
    const hoje = new Date().toISOString().slice(0, 10);
    const mesInicio = hoje.slice(0, 8) + '01';
    const corpo = `
      <div class="barra-ferramentas mb-16">
        <div class="campo"><label class="dica">De</label><input type="date" id="ve-inicio" value="${mesInicio}"></div>
        <div class="campo"><label class="dica">Até</label><input type="date" id="ve-fim" value="${hoje}"></div>
        <button class="btn btn--secundario" id="ve-aplicar" style="align-self:end">Filtrar</button>
      </div>
      <div id="ve-resultado">Carregando…</div>`;
    Modal.abrir({
      titulo: `Extrato — ${conta.nome}`, tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const carregar = async () => {
          const resAlvo = el.querySelector('#ve-resultado');
          const inicio = el.querySelector('#ve-inicio').value;
          const fim = el.querySelector('#ve-fim').value;
          let ext;
          try { ext = await API.get(`/api/financeiro/contas-financeiras/${conta.id}/extrato?inicio=${inicio}&fim=${fim}`); }
          catch (e) { resAlvo.innerHTML = UI.escapar(e.message); return; }
          resAlvo.innerHTML = `
            <div class="grid grid--cards mb-16">
              <div class="card stat"><span class="stat__label">Saldo no início do período</span><span class="stat__value">${UI.moeda(ext.saldo_inicio_periodo)}</span></div>
              <div class="card stat"><span class="stat__label">Saldo no fim do período</span><span class="stat__value" style="color:${ext.saldo_fim_periodo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(ext.saldo_fim_periodo)}</span></div>
              <div class="card stat"><span class="stat__label">Saldo atual (hoje)</span><span class="stat__value">${UI.moeda(ext.saldo_atual)}</span></div>
            </div>
            ${ext.movimentos.length ? `<table class="tabela">
              <thead><tr><th>Data</th><th>Origem</th><th>Descrição</th><th style="text-align:right">Valor</th></tr></thead>
              <tbody>${ext.movimentos.map((m) => `<tr>
                <td>${UI.dataHora(m.data)}</td>
                <td>${NOME_ORIGEM_MOV[m.origem] || m.origem}</td>
                <td>${UI.escapar(m.descricao || '—')}</td>
                <td style="text-align:right;color:${m.tipo === 'entrada' ? 'var(--sucesso)' : 'var(--perigo)'}">${m.tipo === 'entrada' ? '+' : '-'} ${UI.moeda(m.valor)}</td>
              </tr>`).join('')}</tbody></table>` : '<p class="muted">Sem movimentações neste período.</p>'}`;
        };
        el.querySelector('#ve-aplicar').addEventListener('click', carregar);
        carregar();
      },
    });
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
    const alvo = alvoConteudo();
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

    // Comércio ve CMV, serviço ve CSP, e quem tem os dois ve as duas linhas.
    const temComercio = window.__perfilNegocio !== 'servico';
    const temServico = window.__perfilNegocio !== 'comercio';
    const linhasCusto = [
      temComercio ? linha('(−) CMV — custo da mercadoria vendida', d.cmv, { cor: 'var(--perigo)' }) : '',
      temServico ? linha('(−) CSP — custo dos serviços prestados', d.csp, { cor: 'var(--perigo)' }) : '',
    ].join('');

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
            ${linhasCusto}
            ${linha('= Lucro bruto', d.lucro_bruto, { forte: true })}
            <tr><td colspan="2" style="padding-top:12px"><strong>Despesas operacionais</strong></td></tr>
            ${despesasHTML}
            ${linha('Total de despesas', d.total_despesas, { forte: true, cor: 'var(--perigo)' })}
            ${linha('= Resultado líquido do mês', d.resultado_liquido, { forte: true, cor: d.resultado_liquido >= 0 ? 'var(--sucesso)' : 'var(--perigo)' })}
          </tbody>
        </table>
        <p class="dica mt-16">A receita vem das vendas concluídas no mês; ${temComercio && temServico ? 'o CMV usa o custo dos produtos vendidos e o CSP o custo dos serviços prestados' : temServico ? 'o CSP usa o custo dos serviços prestados' : 'o CMV usa o custo dos itens vendidos'}; as despesas vêm das contas a pagar do mês, agrupadas por categoria. Compras de mercadoria não entram como despesa (elas viram CMV ao vender). Margem líquida: <strong>${d.margem_liquida_pct}%</strong>.</p>
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

  // ----------------------- Conciliação bancária (OFX) -----------------------
  const conciliacaoFiltro = { conta_financeira_id: '', status: 'pendente' };
  const FORMAS_CONCILIACAO = { transferencia: 'Transferência', pix: 'PIX', dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito', boleto: 'Boleto' };

  async function renderConciliacao() {
    const alvo = alvoConteudo();
    contasFin = await API.get('/api/financeiro/contas-financeiras').catch(() => []);
    if (!contasFin.length) {
      alvo.innerHTML = '<div class="card vazio">Cadastre uma conta financeira primeiro (aba "Formas de pagamento → contas" ou no botão de saldos) para poder importar um extrato.</div>';
      return;
    }
    alvo.innerHTML = `
      <div class="card mb-16">
        <div class="flex flex--between" style="align-items:flex-start">
          <h3 style="margin-top:0">Importar extrato (.ofx)</h3>
          <button class="btn btn--secundario" id="cc-regras">⚙️ Regras de conciliação</button>
        </div>
        <p class="dica">Importe o extrato exportado do seu banco (formato OFX) para bater as transações com o que já está lançado — ${ehInstituto() ? 'ofertas recebidas e despesas' : 'contas a pagar/receber'} — e já dar baixa nelas. Transações sem par podem ser lançadas automaticamente por uma regra (ex.: "taxa" sempre vira despesa de tarifas bancárias).</p>
        <div class="form-grid">
          <div class="campo"><label>Conta financeira</label><select id="cc-conta">${contasFin.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Arquivo OFX</label><input type="file" id="cc-arquivo" accept=".ofx" /></div>
        </div>
        <button class="btn mt-16" id="cc-importar">Importar extrato</button>
      </div>
      <div class="barra-ferramentas">
        <select id="cc-filtro-conta"><option value="">Todas as contas</option>${contasFin.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select>
        <select id="cc-filtro-status">
          <option value="pendente">Pendentes</option>
          <option value="conciliada">Conciliadas</option>
          <option value="ignorada">Ignoradas</option>
          <option value="">Todas</option>
        </select>
        <div class="cresce"></div>
      </div>
      <div class="card"><div id="cc-lista">Carregando…</div></div>`;

    alvo.querySelector('#cc-importar').addEventListener('click', importarExtratoOfx);
    alvo.querySelector('#cc-regras').addEventListener('click', gerenciarRegrasConciliacao);
    alvo.querySelector('#cc-filtro-conta').addEventListener('change', (e) => { conciliacaoFiltro.conta_financeira_id = e.target.value; listarConciliacao(); });
    alvo.querySelector('#cc-filtro-status').addEventListener('change', (e) => { conciliacaoFiltro.status = e.target.value; listarConciliacao(); });
    await listarConciliacao();
  }

  async function importarExtratoOfx() {
    const contaId = document.getElementById('cc-conta').value;
    const arquivo = document.getElementById('cc-arquivo').files[0];
    if (!contaId) { UI.erro('Selecione a conta financeira.'); return; }
    if (!arquivo) { UI.erro('Selecione o arquivo .ofx.'); return; }
    const fd = new FormData();
    fd.append('conta_financeira_id', contaId);
    fd.append('ofx', arquivo);
    try {
      const r = await API.post('/api/conciliacao/importar', fd);
      UI.sucesso(`${r.importadas} transação(ões) importada(s)${r.duplicadas ? ` — ${r.duplicadas} já tinha(m) sido importada(s) antes` : ''}${r.autoConciliadas ? ` — ${r.autoConciliadas} conciliada(s) automaticamente por regra` : ''}.`);
      document.getElementById('cc-arquivo').value = '';
      await listarConciliacao();
    } catch (e) { UI.erro(e.message); }
  }

  async function listarConciliacao() {
    const alvo = document.getElementById('cc-lista');
    if (!alvo) return;
    const params = new URLSearchParams();
    if (conciliacaoFiltro.conta_financeira_id) params.set('conta_financeira_id', conciliacaoFiltro.conta_financeira_id);
    if (conciliacaoFiltro.status) params.set('status', conciliacaoFiltro.status);
    let transacoes;
    try { transacoes = await API.get('/api/conciliacao?' + params.toString()); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!transacoes.length) { alvo.innerHTML = '<p class="muted">Nenhuma transação neste filtro.</p>'; return; }

    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Status</th><th></th></tr></thead>
      <tbody>${transacoes.map((t) => `<tr>
        <td>${t.data}</td>
        <td>${UI.escapar(t.descricao)}${t.regra_padrao ? ` <span class="badge badge--muted" title="Conciliado automaticamente pela regra &quot;${UI.escapar(t.regra_padrao)}&quot;">🤖 automático</span>` : ''}${t.pagar_descricao ? `<div class="dica">↳ ${UI.escapar(t.pagar_descricao)}</div>` : ''}${t.receber_descricao ? `<div class="dica">↳ ${UI.escapar(t.receber_descricao)}</div>` : ''}${t.oferta_descricao ? `<div class="dica">↳ ${UI.escapar(t.oferta_descricao)}</div>` : ''}</td>
        <td><span class="chip-forma">${t.tipo === 'credito' ? '🟢 Crédito' : '🔴 Débito'}</span></td>
        <td>${UI.moeda(t.valor)}</td>
        <td>${t.status === 'pendente' ? '<span class="badge badge--alerta">Pendente</span>' : t.status === 'conciliada' ? '<span class="badge badge--ok">Conciliada</span>' : '<span class="badge badge--muted">Ignorada</span>'}</td>
        <td style="text-align:right;white-space:nowrap">
          ${t.status === 'pendente' ? `<button class="btn" data-conciliar="${t.id}">Conciliar</button><button class="btn btn--secundario" data-ignorar="${t.id}">Ignorar</button>` : `<button class="btn btn--secundario" data-reabrir="${t.id}">Reabrir</button>`}
        </td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-conciliar]').forEach((b) => b.addEventListener('click', () => {
      const t = transacoes.find((x) => x.id === Number(b.dataset.conciliar));
      formConciliar(t);
    }));
    alvo.querySelectorAll('[data-ignorar]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Ignorar esta transação? Ela não vai gerar nenhum lançamento.', { titulo: 'Ignorar transação', textoConfirmar: 'Ignorar' });
      if (!ok) return;
      try { await API.post(`/api/conciliacao/${b.dataset.ignorar}/ignorar`, {}); await listarConciliacao(); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-reabrir]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.post(`/api/conciliacao/${b.dataset.reabrir}/reabrir`, {}); UI.sucesso('Transação reaberta.'); await listarConciliacao(); } catch (e) { UI.erro(e.message); }
    }));
  }

  async function gerenciarRegrasConciliacao() {
    let regras = await API.get('/api/conciliacao/regras').catch(() => []);
    let editandoId = null;

    const corpo = `
      <p class="dica mb-16">Quando uma transação do extrato não bater com nenhuma conta pendente, o sistema procura por esses termos na descrição e já lança automaticamente na categoria/fornecedor ou cliente escolhido (o que também aparece no DRE).</p>
      <form id="rc-form">
        <div class="form-grid">
          <div class="campo"><label>Termo(s) na descrição</label><input id="rc-padrao" placeholder="ex.: taxa, tarifa" required /></div>
          <div class="campo"><label>Lança como</label><select id="rc-tipo"><option value="pagar">Despesa (a pagar)</option><option value="receber">Receita (a receber)</option></select></div>
        </div>
        <div id="rc-campos-pagar" class="form-grid mt-16">
          <div class="campo"><label>Categoria (DRE)</label><select id="rc-categoria"><option value="">— sem categoria —</option>${categoriasDespesa.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Fornecedor</label><select id="rc-fornecedor"><option value="">—</option>${fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('')}</select></div>
        </div>
        <div id="rc-campos-receber" class="campo mt-16" style="display:none"><label>Cliente</label><select id="rc-cliente"><option value="">—</option>${clientes.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
        <div class="campo mt-16"><label>Descrição do lançamento (opcional)</label><input id="rc-descricao" placeholder="Se vazio, usa a descrição do próprio banco" /></div>
        <div class="flex gap-12 mt-16" style="align-items:center">
          <button class="btn" type="submit" id="rc-salvar">Adicionar regra</button>
          <button class="btn btn--secundario" type="button" id="rc-cancelar" style="display:none">Cancelar edição</button>
        </div>
      </form>
      <hr class="mt-16 mb-16" />
      <div id="rc-lista"></div>`;

    Modal.abrir({
      titulo: 'Regras de conciliação', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const tipoSel = el.querySelector('#rc-tipo');
        const alternarCampos = () => {
          const pagar = tipoSel.value === 'pagar';
          el.querySelector('#rc-campos-pagar').style.display = pagar ? '' : 'none';
          el.querySelector('#rc-campos-receber').style.display = pagar ? 'none' : '';
        };
        tipoSel.addEventListener('change', alternarCampos);
        alternarCampos();

        const limparForm = () => {
          editandoId = null;
          el.querySelector('#rc-form').reset();
          alternarCampos();
          el.querySelector('#rc-salvar').textContent = 'Adicionar regra';
          el.querySelector('#rc-cancelar').style.display = 'none';
        };

        const render = () => {
          el.querySelector('#rc-lista').innerHTML = regras.length ? `<table class="tabela">
            <thead><tr><th>Termo(s)</th><th>Lança como</th><th>Destino</th><th>Ativa?</th><th></th></tr></thead>
            <tbody>${regras.map((r) => `<tr>
              <td>${UI.escapar(r.padrao)}</td>
              <td>${r.tipo === 'pagar' ? 'Despesa' : 'Receita'}</td>
              <td>${UI.escapar(r.categoria_nome || r.fornecedor_nome || r.cliente_nome || '—')}</td>
              <td>${r.ativa ? '<span class="badge badge--ok">Sim</span>' : '<span class="badge badge--muted">Pausada</span>'}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-rc-editar="${r.id}">Editar</button>
                <button class="btn btn--secundario" data-rc-pausar="${r.id}">${r.ativa ? 'Pausar' : 'Ativar'}</button>
                <button class="btn btn--secundario" data-rc-del="${r.id}">✕</button>
              </td>
            </tr>`).join('')}</tbody></table>` : '<p class="muted">Nenhuma regra cadastrada.</p>';

          el.querySelectorAll('[data-rc-editar]').forEach((b) => b.addEventListener('click', () => {
            const r = regras.find((x) => x.id === Number(b.dataset.rcEditar));
            if (!r) return;
            editandoId = r.id;
            el.querySelector('#rc-padrao').value = r.padrao;
            el.querySelector('#rc-tipo').value = r.tipo;
            alternarCampos();
            el.querySelector('#rc-categoria').value = r.categoria_despesa_id || '';
            el.querySelector('#rc-fornecedor').value = r.fornecedor_id || '';
            el.querySelector('#rc-cliente').value = r.cliente_id || '';
            el.querySelector('#rc-descricao').value = r.descricao_lancamento || '';
            el.querySelector('#rc-salvar').textContent = 'Salvar edição';
            el.querySelector('#rc-cancelar').style.display = '';
            el.querySelector('#rc-padrao').focus();
          }));
          el.querySelectorAll('[data-rc-pausar]').forEach((b) => b.addEventListener('click', async () => {
            const r = regras.find((x) => x.id === Number(b.dataset.rcPausar));
            if (!r) return;
            try { await API.put(`/api/conciliacao/regras/${r.id}`, { ativa: !r.ativa }); regras = await API.get('/api/conciliacao/regras'); render(); }
            catch (e) { UI.erro(e.message); }
          }));
          el.querySelectorAll('[data-rc-del]').forEach((b) => b.addEventListener('click', async () => {
            const ok = await UI.confirmar('Excluir esta regra?', { titulo: 'Excluir regra', textoConfirmar: 'Excluir' });
            if (!ok) return;
            try {
              await API.del(`/api/conciliacao/regras/${b.dataset.rcDel}`);
              regras = await API.get('/api/conciliacao/regras');
              if (editandoId === Number(b.dataset.rcDel)) limparForm();
              render();
              UI.sucesso('Regra excluída.');
            } catch (e) { UI.erro(e.message); }
          }));
        };
        render();

        el.querySelector('#rc-cancelar').addEventListener('click', limparForm);
        el.querySelector('#rc-form').addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const tipo = tipoSel.value;
          const dados = {
            padrao: el.querySelector('#rc-padrao').value,
            tipo,
            descricao_lancamento: el.querySelector('#rc-descricao').value || null,
            categoria_despesa_id: tipo === 'pagar' ? (el.querySelector('#rc-categoria').value || null) : null,
            fornecedor_id: tipo === 'pagar' ? (el.querySelector('#rc-fornecedor').value || null) : null,
            cliente_id: tipo === 'receber' ? (el.querySelector('#rc-cliente').value || null) : null,
          };
          try {
            if (editandoId) await API.put(`/api/conciliacao/regras/${editandoId}`, dados);
            else await API.post('/api/conciliacao/regras', dados);
            regras = await API.get('/api/conciliacao/regras');
            limparForm();
            render();
            UI.sucesso('Regra salva.');
          } catch (e) { UI.erro(e.message); }
        });
      },
    });
  }

  function opcaoContaHTML(s, tipo, marcada) {
    const diferenca = Math.abs(Number(s.valor) - Number(s.__valorTransacao || 0));
    const ehOferta = s.origem_registro === 'oferta';
    // A oferta ja entrou no caixa quando foi registrada: conciliar so amarra
    // com o extrato, nunca lanca o valor de novo.
    const statusTxt = ehOferta
      ? '<span class="badge badge--ok">🤝 Oferta — já está no caixa</span>'
      : (s.status === 'pendente' ? '<span class="badge badge--alerta">Pendente</span>' : `<span class="badge badge--ok">${tipo === 'pagar' ? 'Paga' : 'Recebida'} — só amarra com o extrato</span>`);
    return `
      <label class="flex gap-12" style="align-items:center;padding:8px 0;border-bottom:1px solid var(--borda)">
        <input type="radio" name="cc-opcao" value="${s.id}" data-origem="${ehOferta ? 'oferta' : 'conta'}" ${marcada ? 'checked' : ''} />
        <span class="cresce">${UI.escapar(s.descricao)}${s.contraparte_nome ? ' — ' + UI.escapar(s.contraparte_nome) : ''}
          <span class="dica">${s.vencimento ? 'vence ' + s.vencimento : ''} — ${UI.moeda(s.valor)}${diferenca > 0.01 ? ` <span style="color:var(--perigo)">(diferença de ${UI.moeda(diferenca)})</span>` : ''}</span>
        </span>
        ${statusTxt}
      </label>`;
  }

  async function formConciliar(t) {
    let sugestoes;
    try { sugestoes = await API.get(`/api/conciliacao/${t.id}/sugestoes`); } catch (e) { UI.erro(e.message); return; }
    const tipo = t.tipo === 'debito' ? 'pagar' : 'receber';
    sugestoes.forEach((s) => { s.__valorTransacao = t.valor; });

    const corpo = `
      <div class="card mb-16">
        <div class="flex flex--between"><strong>${UI.escapar(t.descricao)}</strong><strong>${UI.moeda(t.valor)}</strong></div>
        <div class="dica">${t.data} · ${t.tipo === 'credito' ? 'Entrada (crédito)' : 'Saída (débito)'}</div>
      </div>
      ${sugestoes.length ? `
      <div class="campo"><label>Bate com uma conta já cadastrada?</label></div>
      <div id="cc-sugestoes">${sugestoes.map((s, idx) => opcaoContaHTML(s, tipo, idx === 0)).join('')}</div>` : '<div class="dica mb-16">Nenhuma conta pendente com esse valor.</div>'}

      <div class="campo mt-16"><label>🔍 Buscar ${tipo === 'pagar' ? 'outra despesa' : (ehInstituto() ? 'outra oferta ou cobrança' : 'outra conta a receber')}</label></div>
      <div class="barra-ferramentas" style="margin-bottom:8px">
        <input type="search" id="cc-busca-termo" class="cresce" placeholder="Buscar por descrição…" />
        <select id="cc-busca-status">
          <option value="">Pendentes e pagas</option>
          <option value="pendente">Só pendentes</option>
          <option value="pago">Só já ${tipo === 'pagar' ? 'pagas' : 'recebidas'}</option>
        </select>
        <button type="button" class="btn btn--secundario" id="cc-busca-btn">Buscar</button>
      </div>
      <div id="cc-busca-resultados" class="mb-16"></div>

      <label class="flex gap-12" style="align-items:center;padding:8px 0">
        <input type="radio" name="cc-opcao" value="novo" ${sugestoes.length ? '' : 'checked'} />
        <span>Nenhuma dessas — criar um lançamento novo</span>
      </label>

      <div id="cc-form-novo" class="mt-16" style="${sugestoes.length ? 'display:none' : ''}">
        <div class="campo"><label>Descrição</label><input id="cc-nova-desc" value="${UI.escapar(t.descricao)}" /></div>
        ${tipo === 'pagar' ? `
        <div class="form-grid mt-16">
          <div class="campo"><label>Fornecedor</label><select id="cc-nova-forn"><option value="">—</option>${fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('')}</select></div>
          <div class="campo"><label>Categoria (DRE)</label><select id="cc-nova-cat"><option value="">— sem categoria —</option>${categoriasDespesa.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>
        </div>` : `
        <div class="campo mt-16"><label>Cliente</label><select id="cc-nova-cliente"><option value="">—</option>${clientes.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('')}</select></div>`}
      </div>
      <div class="campo mt-16"><label>Forma de pagamento</label><select id="cc-forma">${Object.entries(FORMAS_CONCILIACAO).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>`;

    Modal.abrir({
      titulo: `Conciliar — ${tipo === 'pagar' ? 'a pagar' : 'a receber'}`, tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Confirmar',
      aoAbrir: (el) => {
        // Delegacao: cobre tanto os radios que ja vem no HTML quanto os que a busca adicionar depois.
        el.addEventListener('change', (e) => {
          if (e.target.name !== 'cc-opcao') return;
          const sel = el.querySelector('input[name="cc-opcao"]:checked');
          el.querySelector('#cc-form-novo').style.display = sel && sel.value === 'novo' ? '' : 'none';
        });

        el.querySelector('#cc-busca-btn').addEventListener('click', async () => {
          const termo = el.querySelector('#cc-busca-termo').value.trim();
          const status = el.querySelector('#cc-busca-status').value;
          const resAlvo = el.querySelector('#cc-busca-resultados');
          resAlvo.innerHTML = 'Buscando…';
          try {
            const params = new URLSearchParams();
            if (termo) params.set('termo', termo);
            if (status) params.set('status', status);
            const achadas = await API.get(`/api/conciliacao/${t.id}/buscar?${params.toString()}`);
            achadas.forEach((s) => { s.__valorTransacao = t.valor; });
            resAlvo.innerHTML = achadas.length
              ? achadas.map((s) => opcaoContaHTML(s, tipo, false)).join('')
              : '<p class="muted">Nenhuma conta encontrada.</p>';
          } catch (e) { resAlvo.innerHTML = UI.escapar(e.message); }
        });
      },
      aoConfirmar: async (el) => {
        const opcaoSel = el.querySelector('input[name="cc-opcao"]:checked');
        const forma = el.querySelector('#cc-forma').value;
        try {
          if (opcaoSel && opcaoSel.value !== 'novo') {
            const alvoTipo = opcaoSel.dataset.origem === 'oferta' ? 'oferta' : tipo;
            await API.post(`/api/conciliacao/${t.id}/conciliar`, { tipo: alvoTipo, conta_id: Number(opcaoSel.value), forma });
            UI.sucesso(alvoTipo === 'oferta' ? 'Oferta amarrada ao extrato.' : 'Conciliado.');
          } else {
            const dados = { tipo, descricao: el.querySelector('#cc-nova-desc').value, forma };
            if (tipo === 'pagar') {
              dados.fornecedor_id = el.querySelector('#cc-nova-forn').value || null;
              dados.categoria_despesa_id = el.querySelector('#cc-nova-cat').value || null;
            } else {
              dados.cliente_id = el.querySelector('#cc-nova-cliente').value || null;
            }
            await API.post(`/api/conciliacao/${t.id}/novo-lancamento`, dados);
            UI.sucesso('Lançamento criado e conciliado.');
          }
          await listarConciliacao(); carregarAlertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Financeiro', render };
})();
