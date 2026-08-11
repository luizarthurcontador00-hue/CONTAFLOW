'use strict';

/**
 * Planilha de Precificação (markup divisor) — 5 módulos:
 * 1) Instruções · 2) Faturamento · 3) Despesas · 4) Percentuais por Atividade
 * 5) Precificação de Produtos.
 * Células de entrada são editáveis (tom claro); células de cálculo automático
 * são verdes e bloqueadas. O estado vem calculado do backend (fonte única).
 */
window.PrecAvancada = (function () {
  let estado = null;
  let modulo = 'instrucoes';
  let moduloPendente = null;      // definido por solicitarModulo (ao vir de uma importacao)
  let raizEl = null;
  let filtroProd = '';             // busca de produto no Modulo 5
  const gruposAbertos = new Set(); // lotes expandidos no Modulo 5

  // Permite abrir a planilha ja num modulo especifico (ex.: apos importar).
  function solicitarModulo(m) { moduloPendente = m; }

  const pct = (n) => (Number(n || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  const moeda = (n) => UI.moeda(n);
  const esc = (s) => UI.escapar(s);

  async function render(container) {
    raizEl = container;
    if (moduloPendente) { modulo = moduloPendente; moduloPendente = null; }
    container.innerHTML = '<div class="card">Carregando…</div>';
    try { estado = await API.get('/api/precificacao-avancada'); }
    catch (e) { container.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${esc(e.message)}</div>`; return; }
    desenhar();
  }

  function desenhar() {
    const modulos = [
      ['instrucoes', '📖 Instruções'],
      ['faturamento', '💵 Faturamento'],
      ['despesas', '📉 Despesas'],
      ['atividades', '📊 Percentuais por Atividade'],
      ['precificacao', '🏷️ Precificação'],
    ];
    raizEl.innerHTML = `
      <div class="tabs" style="margin-top:8px">
        ${modulos.map(([k, nome]) => `<div class="tab ${modulo === k ? 'ativo' : ''}" data-mod="${k}">${nome}</div>`).join('')}
      </div>
      <div class="mb-16">
        <span class="prec-legenda"><span class="amostra" style="background:#fffdf5"></span> Célula de entrada (você preenche)</span>
        <span class="prec-legenda"><span class="amostra" style="background:#dcfce7"></span> Cálculo automático (não editar)</span>
      </div>
      <div id="prec-mod"></div>`;
    raizEl.querySelectorAll('[data-mod]').forEach((t) => t.addEventListener('click', () => {
      modulo = t.dataset.mod; desenhar();
    }));
    renderModulo();
  }

  function renderModulo() {
    const alvo = raizEl.querySelector('#prec-mod');
    if (modulo === 'instrucoes') alvo.innerHTML = htmlInstrucoes();
    else if (modulo === 'faturamento') { alvo.innerHTML = htmlFaturamento(); ligarFaturamento(alvo); }
    else if (modulo === 'despesas') { alvo.innerHTML = htmlDespesas(); ligarDespesas(alvo); }
    else if (modulo === 'atividades') alvo.innerHTML = htmlAtividades();
    else { alvo.innerHTML = htmlPrecificacao(); ligarPrecificacao(alvo); }
  }

  // Recarrega o estado (apos salvar) e redesenha apenas o modulo atual.
  async function recarregar(novoEstado) {
    if (novoEstado) estado = novoEstado;
    else estado = await API.get('/api/precificacao-avancada').catch(() => estado);
    renderModulo();
  }

  // =============================== Módulo 1 ===============================
  function htmlInstrucoes() {
    return `
      <div class="card">
        <h2 style="margin-top:0">Planilha de Precificação</h2>
        <p>Esta ferramenta ajuda você a <strong>entender seus custos</strong> e <strong>definir preços com segurança</strong>,
           usando a metodologia de <strong>markup divisor</strong>. Em vez de "chutar" o preço, ela calcula o
           <strong>preço de venda sugerido</strong> a partir do seu faturamento, despesas, impostos e da margem de lucro desejada.</p>

        <h3>As abas</h3>
        <ul style="line-height:1.7">
          <li><strong>Faturamento</strong> — informe seu faturamento mensal e os impostos; o sistema calcula o faturamento líquido.</li>
          <li><strong>Despesas</strong> — cadastre despesas fixas e variáveis; o sistema mostra o peso de cada uma sobre a receita (AV%).</li>
          <li><strong>Percentuais Médios por Atividade</strong> — tabela de referência de mercado (comércio, serviços, indústria).</li>
          <li><strong>Precificação (atual)</strong> — cada linha é um produto/serviço; o sistema calcula o preço sugerido e valida com a "Prova Real".</li>
          <li><strong>Precificação Atualizada com a Reforma Tributária</strong> — versão que usa CBS/IBS no lugar dos impostos atuais.</li>
        </ul>

        <h3>Como preencher</h3>
        <ul style="line-height:1.7">
          <li>Comece pela aba <strong>Faturamento</strong>: preencha o faturamento e os percentuais de impostos do seu regime.</li>
          <li>Na aba <strong>Despesas</strong>, lance os valores mensais e escolha sua <strong>atividade</strong> (comércio, serviços ou indústria).</li>
          <li>Na aba <strong>Precificação</strong>, adicione seus produtos: informe quantidade, valor do pedido, embalagem, frete, taxa de cartão e a margem de lucro desejada. O <strong>preço sugerido</strong> aparece automaticamente.</li>
          <li>Confira a <strong>Prova Real</strong>: ela deve sempre fechar em <strong>R$ 0,00</strong>. Se não fechar, revise os preenchimentos.</li>
        </ul>

        <div class="prec-aviso mt-16">
          <strong>⚠️ Aviso legal:</strong> Esta ferramenta utiliza uma abordagem simplificada da Reforma Tributária.
          As alíquotas de CBS e IBS são aplicadas de forma estimada, sem considerar integralmente os créditos tributários,
          regimes específicos e demais particularidades da legislação. Os resultados são apenas indicativos e não substituem
          orientação profissional. <strong>Recomenda-se validação com profissional contábil.</strong>
        </div>

        <p class="dica mt-16">Convenção visual: <span class="celula-calc" style="padding:2px 8px;border-radius:4px">células verdes</span> são cálculos automáticos — não edite.</p>
      </div>`;
  }

  // =============================== Módulo 2 ===============================
  function htmlFaturamento() {
    const m = estado.modulo2, c = estado.config;
    const linhaImposto = (i) => `<tr>
      <td>${esc(i.nome)}</td>
      <td style="width:120px"><input type="number" step="0.1" data-cfg="${i.chave}_pct" value="${valorCampo(i.chave)}" /></td>
      <td class="celula-calc" style="width:140px">${moeda(i.valor)}</td>
    </tr>`;
    return `
      <div class="card mb-16">
        <h3 style="margin-top:0">Faturamento bruto</h3>
        <div class="campo" style="max-width:280px">
          <label>Faturamento mensal (R$)</label>
          <input type="number" step="0.01" min="0" id="fat-bruto" data-cfg="faturamento_mensal" value="${c.faturamento_mensal || ''}" />
        </div>
        <div class="flex flex--between mt-16" style="max-width:280px"><span>Total</span><strong class="celula-calc" style="padding:4px 10px;border-radius:6px">${moeda(m.faturamento_bruto)}</strong></div>
      </div>

      <div class="card mb-16">
        <h3 style="margin-top:0">Impostos (%)</h3>
        <h4 style="margin:8px 0;color:var(--texto-suave)">Regime atual</h4>
        <table class="prec-tabela">
          <thead><tr><th>Imposto</th><th>% de desconto</th><th>Valor (R$)</th></tr></thead>
          <tbody>${m.impostos_atual.map(linhaImposto).join('')}</tbody>
          <tfoot><tr><th>Total de impostos (%)</th><th class="celula-calc">${pct(m.total_impostos_atual_pct)}</th><th class="celula-calc">${moeda(m.impostos_atual.reduce((s, i) => s + i.valor, 0))}</th></tr></tfoot>
        </table>

        <h4 style="margin:16px 0 8px;color:var(--texto-suave)">Após Reforma 2027</h4>
        <table class="prec-tabela">
          <thead><tr><th>Imposto</th><th>%</th><th>Valor (R$)</th></tr></thead>
          <tbody>${m.impostos_reforma.map(linhaImposto).join('')}</tbody>
          <tfoot><tr><th>Total de impostos (reforma)</th><th class="celula-calc">${pct(m.total_impostos_reforma_pct)}</th><th class="celula-calc">${moeda(m.impostos_reforma.reduce((s, i) => s + i.valor, 0))}</th></tr></tfoot>
        </table>
        <div class="flex flex--between mt-16"><strong>Total geral de impostos (R$)</strong><strong class="celula-calc" style="padding:4px 10px;border-radius:6px">${moeda(m.total_impostos_valor)}</strong></div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Faturamento líquido (R$)</h3>
        <table class="prec-tabela" style="max-width:420px">
          <tr><td>Faturamento bruto</td><td class="celula-calc">${moeda(m.faturamento_bruto)}</td></tr>
          <tr><td>Total de impostos</td><td class="celula-calc">− ${moeda(m.total_impostos_valor)}</td></tr>
          <tr><td><strong>Faturamento líquido</strong></td><td class="celula-calc celula-calc--destaque">${moeda(m.faturamento_liquido)}</td></tr>
        </table>
        <p class="dica mt-16">O "Total de impostos (%)" do regime atual (${pct(m.total_impostos_atual_pct)}) é reutilizado automaticamente na aba Precificação.</p>
      </div>`;
  }

  function valorCampo(chave) {
    const mapa = { simples_nacional: 'simples_nacional_pct', icms: 'icms_pct', pis: 'pis_pct', cofins: 'cofins_pct', ir: 'ir_pct', cs: 'cs_pct', ibs: 'ibs_pct', cbs: 'cbs_pct' };
    return estado.config[mapa[chave]] || '';
  }

  function ligarFaturamento(alvo) {
    alvo.querySelectorAll('[data-cfg]').forEach((inp) => inp.addEventListener('change', async () => {
      try { const novo = await API.put('/api/precificacao-avancada/config', { [inp.dataset.cfg]: Number(inp.value || 0) }); await recarregar(novo); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  // =============================== Módulo 3 ===============================
  function htmlDespesas() {
    const m = estado.modulo3;
    const linha = (d) => `<tr>
      <td><input data-desp-desc="${d.id}" value="${esc(d.descricao)}" /></td>
      <td style="width:140px"><input type="number" step="0.01" data-desp-val="${d.id}" value="${d.valor || ''}" /></td>
      <td class="celula-calc" style="width:90px">${pct(d.av)}</td>
      <td style="width:40px"><button class="btn btn--secundario" data-desp-del="${d.id}">✕</button></td>
    </tr>`;
    const atOpts = Object.entries(estado.modulo4).map(([k, v]) => `<option value="${k}" ${m.atividade === k ? 'selected' : ''}>${esc(v.nome)}</option>`).join('');
    return `
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;align-items:start">
        <div class="card">
          <div class="flex flex--between"><h3 style="margin-top:0">Despesas fixas (R$)</h3><button class="btn btn--secundario" data-add-desp="fixa">+ Linha</button></div>
          <table class="prec-tabela"><thead><tr><th>Descrição</th><th>Valor</th><th>AV%</th><th></th></tr></thead>
            <tbody>${m.fixas.map(linha).join('')}</tbody>
            <tfoot><tr><th>Total</th><th class="celula-calc">${moeda(m.total_fixas)}</th><th class="celula-calc">${pct(m.av_fixas_real)}</th><th></th></tr></tfoot>
          </table>
        </div>
        <div class="card">
          <div class="flex flex--between"><h3 style="margin-top:0">Despesas variáveis (R$)</h3><button class="btn btn--secundario" data-add-desp="variavel">+ Linha</button></div>
          <table class="prec-tabela"><thead><tr><th>Descrição</th><th>Valor</th><th>AV%</th><th></th></tr></thead>
            <tbody>${m.variaveis.map(linha).join('')}</tbody>
            <tfoot><tr><th>Total</th><th class="celula-calc">${moeda(m.total_variaveis)}</th><th class="celula-calc">${pct(m.av_variaveis_real)}</th><th></th></tr></tfoot>
          </table>
        </div>
      </div>

      <div class="grid grid--cards mt-16">
        <div class="card stat"><span class="stat__label">Total de despesas fixas</span><span class="stat__value celula-calc" style="font-size:20px;border-radius:6px;padding:4px 8px">${moeda(m.total_fixas)}</span></div>
        <div class="card stat"><span class="stat__label">Total de despesas variáveis</span><span class="stat__value celula-calc" style="font-size:20px;border-radius:6px;padding:4px 8px">${moeda(m.total_variaveis)}</span></div>
        <div class="card stat"><span class="stat__label">Total de despesas</span><span class="stat__value celula-calc celula-calc--destaque" style="font-size:20px;border-radius:6px;padding:4px 8px">${moeda(m.total_despesas)}</span></div>
      </div>

      <div class="card mt-16">
        <h3 style="margin-top:0">Percentual Médio por Atividade</h3>
        <div class="flex gap-12" style="align-items:center;flex-wrap:wrap">
          <div class="campo" style="max-width:220px"><label>Atividade</label><select id="desp-atividade">${atOpts}</select></div>
          <div class="stat" style="min-width:180px"><span class="stat__label">% máx. de despesas fixas</span><span class="celula-calc" style="font-size:18px;border-radius:6px;padding:4px 8px;display:inline-block">${pct(m.max_desp_fixa_pct)}</span></div>
          <div class="stat" style="min-width:180px"><span class="stat__label">% máx. de despesas variáveis</span><span class="celula-calc" style="font-size:18px;border-radius:6px;padding:4px 8px;display:inline-block">${pct(m.max_desp_variavel_pct)}</span></div>
        </div>
        <p class="dica mt-16">Estes percentuais de referência (aba Percentuais por Atividade) são usados no cálculo da precificação quando você opta por "usar margem do setor".</p>
      </div>`;
  }

  function ligarDespesas(alvo) {
    alvo.querySelectorAll('[data-desp-val]').forEach((inp) => inp.addEventListener('change', () => salvarDespesa(inp.dataset.despVal, { valor: Number(inp.value || 0) })));
    alvo.querySelectorAll('[data-desp-desc]').forEach((inp) => inp.addEventListener('change', () => salvarDespesa(inp.dataset.despDesc, { descricao: inp.value })));
    alvo.querySelectorAll('[data-desp-del]').forEach((b) => b.addEventListener('click', async () => {
      try { await recarregar(await API.del('/api/precificacao-avancada/despesa/' + b.dataset.despDel)); } catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-add-desp]').forEach((b) => b.addEventListener('click', async () => {
      try { await recarregar(await API.post('/api/precificacao-avancada/despesa', { tipo: b.dataset.addDesp })); } catch (e) { UI.erro(e.message); }
    }));
    const at = alvo.querySelector('#desp-atividade');
    at.addEventListener('change', async () => {
      try { await recarregar(await API.put('/api/precificacao-avancada/config', { atividade: at.value })); } catch (e) { UI.erro(e.message); }
    });
  }

  async function salvarDespesa(id, campos) {
    try { await recarregar(await API.put('/api/precificacao-avancada/despesa/' + id, campos)); } catch (e) { UI.erro(e.message); }
  }

  // =============================== Módulo 4 ===============================
  function htmlAtividades() {
    const t = estado.modulo4;
    const linha = (k) => {
      const a = t[k];
      return `<tr>
        <td><strong>${esc(a.nome)}</strong></td>
        <td>${esc(a.despesa_fixa.faixa)}</td><td class="celula-calc">${(a.despesa_fixa.valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
        <td>${esc(a.custo_variavel.faixa)}</td><td class="celula-calc">${(a.custo_variavel.valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
        <td>${esc(a.lucratividade.faixa)}</td><td class="celula-calc">${(a.lucratividade.valor / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
      </tr>`;
    };
    return `
      <div class="card">
        <h3 style="margin-top:0">Tabela de Percentuais Médios por Atividade</h3>
        <p class="dica">Referência de mercado (valores fixos), usada como parâmetro pelas abas Despesas e Precificação.</p>
        <div class="prec-scroll"><table class="prec-tabela">
          <thead><tr><th>Atividade</th><th>Despesa Fixa Ideal</th><th>valor</th><th>Custo Variável Médio</th><th>valor</th><th>Lucratividade Esperada</th><th>valor</th></tr></thead>
          <tbody>${['comercio', 'servicos', 'industria'].map(linha).join('')}</tbody>
        </table></div>
      </div>`;
  }

  // =============================== Módulo 5 ===============================
  function gruposFiltrados() {
    const grupos = estado.modulo5_grupos;
    const termo = filtroProd.trim().toLowerCase();
    if (!termo) return grupos;
    return grupos
      .map((g) => {
        const itens = g.itens.filter((i) =>
          (i.descricao || '').toLowerCase().includes(termo) || (i.referencia || '').toLowerCase().includes(termo));
        return { ...g, itens, qtd: itens.length };
      })
      .filter((g) => g.itens.length);
  }

  function htmlPrecificacao() {
    const impPct = estado.modulo2.total_impostos_atual_pct;
    const grupos = gruposFiltrados();
    const termo = filtroProd.trim();
    return `
      <div class="card mb-16" style="background:#f8fafc">
        <div class="flex flex--between" style="flex-wrap:wrap;gap:8px">
          <span class="dica">Impostos aplicados (do Faturamento): <strong>${pct(impPct)}</strong> · Atividade: <strong>${esc(estado.modulo4[estado.modulo3.atividade].nome)}</strong> (desp. fixa setor ${pct(estado.modulo3.max_desp_fixa_pct)})</span>
          <div class="flex gap-12" style="flex-wrap:wrap">
            <button class="btn btn--secundario" id="prec-buscar-cad">🔎 Buscar produto do cadastro</button>
            <button class="btn" id="prec-add">+ Produto avulso</button>
          </div>
        </div>
        <div class="barra-ferramentas mt-16" style="margin-bottom:0">
          <input type="search" id="prec-busca" class="cresce" placeholder="Filtrar produtos na planilha por nome ou referência…" value="${esc(filtroProd)}" />
          ${termo ? `<button class="btn btn--secundario" id="prec-busca-limpar">Limpar</button>` : ''}
        </div>
        <p class="dica mt-16" style="margin-bottom:0">Produtos importados (cadastro em lote ou NF-e) aparecem agrupados por importação. Você também pode <strong>buscar um produto do cadastro</strong> para precificar sob demanda. Depois use <strong>"Aplicar preços"</strong> para atualizar o preço de venda.</p>
      </div>
      ${grupos.length ? grupos.map(htmlGrupo).join('') : `<div class="card vazio">${termo ? 'Nenhum produto encontrado para “' + esc(termo) + '”.' : 'Nenhum produto na planilha. Importe produtos (cadastro em lote ou NF-e), busque um produto do cadastro ou adicione um avulso.'}</div>`}
      <div class="mt-16 flex gap-12" style="flex-wrap:wrap">
        <span class="prec-legenda"><span class="amostra" style="background:#dcfce7"></span> Verde = automático</span>
        <span class="prec-legenda">⭐ Preço de venda sugerido pelo markup divisor</span>
        <span class="prec-legenda">Prova Real deve fechar em R$ 0,00</span>
      </div>`;
  }

  function htmlGrupo(g) {
    const chave = g.lote || '__avulsos__';
    // Ao filtrar, todos os grupos com resultado ficam abertos.
    const aberto = !!filtroProd.trim() || gruposAbertos.has(chave);
    const dataTxt = g.lote_data ? UI.dataHora(g.lote_data) : '';
    return `
      <div class="card mb-16" data-grupo="${esc(chave)}">
        <div class="flex flex--between" style="flex-wrap:wrap;gap:8px;cursor:pointer" data-toggle="${esc(chave)}">
          <div>
            <strong>${aberto ? '▾' : '▸'} ${esc(g.rotulo)}</strong>
            <span class="dica" style="margin-left:8px">${g.qtd} produto(s)${g.aplicaveis ? ` · ${g.aplicaveis} com preço aplicável` : ''}${dataTxt ? ` · ${dataTxt.split(' ')[0]}` : ''}</span>
          </div>
          <div class="flex gap-12" onclick="event.stopPropagation()">
            ${g.lote ? `<button class="btn" data-aplicar-lote="${esc(g.lote)}" ${g.aplicaveis ? '' : 'disabled'}>💾 Aplicar preços (${g.aplicaveis})</button>
            <button class="btn btn--secundario" data-excluir-lote="${esc(g.lote)}">Remover grupo</button>` : ''}
          </div>
        </div>
        ${aberto ? `
        <div class="prec-scroll-topo" data-scroll-topo><div data-scroll-topo-largura></div></div>
        <div class="prec-scroll mt-16" data-scroll-tabela><table class="prec-tabela" style="min-width:1850px">
          <thead><tr>
            <th>Ref.</th><th>Descrição</th><th>Qtd</th><th>Valor pedido</th>
            <th>Custo unit.</th><th>Embalagem</th><th>Frete fixo</th><th>Custo total</th>
            <th>Frete %</th><th>Cartão %</th><th>Impostos %</th><th>Margem %</th><th>Margem setor?</th>
            <th>Markup</th><th>⭐ Sugerido</th><th>Preço de venda</th><th>Preço mercado</th><th>Preço praticado</th><th>Margem atual</th>
            <th>Prova Real</th><th>Aplicar</th><th title="Copiar embalagem/frete/cartão/margem desta linha pras outras do grupo">Replicar</th><th></th>
          </tr></thead>
          <tbody>${g.itens.map(linhaProduto).join('')}</tbody>
        </table></div>` : ''}
      </div>`;
  }

  function linhaProduto(p) {
    const pr = p.prova_real;
    const provaOk = Math.abs(pr.total) < 0.005;
    const podeAplicar = p.produto_id && (p.manual ? p.preco_final > 0 : (!p.markup_invalido && p.preco_final > 0));
    return `<tr data-linha="${p.id}">
      <td style="min-width:80px"><input data-pp="referencia" value="${esc(p.referencia || '')}" /></td>
      <td style="min-width:140px"><input data-pp="descricao" value="${esc(p.descricao || '')}" title="${esc(p.descricao || '')}" /></td>
      <td style="width:70px"><input type="number" step="0.001" data-pp="quantidade" value="${p.quantidade}" /></td>
      <td style="width:110px"><input type="number" step="0.01" data-pp="valor_pedido" value="${p.valor_pedido}" /></td>
      <td class="celula-calc">${moeda(p.custo_unitario)}</td>
      <td style="width:100px"><input type="number" step="0.01" data-pp="custo_embalagem" value="${p.custo_embalagem}" /></td>
      <td style="width:100px"><input type="number" step="0.01" data-pp="custo_frete_fixo" value="${p.custo_frete_fixo}" /></td>
      <td class="celula-calc">${moeda(p.custo_total_produto)}</td>
      <td style="width:80px"><input type="number" step="0.1" data-pp="frete_pct" value="${p.frete_pct}" /></td>
      <td style="width:80px"><input type="number" step="0.1" data-pp="taxa_cartao_pct" value="${p.taxa_cartao_pct}" /></td>
      <td class="celula-calc">${pct(p.impostos_pct)}</td>
      <td style="width:80px"><input type="number" step="0.1" data-pp="margem_pct" value="${p.margem_pct}" /></td>
      <td style="width:90px"><select data-pp="usar_margem_setor"><option value="1" ${p.usar_margem_setor ? 'selected' : ''}>Sim</option><option value="0" ${!p.usar_margem_setor ? 'selected' : ''}>Não</option></select></td>
      <td class="celula-calc ${p.markup_invalido ? 'celula-calc--erro' : ''}">${p.markup_invalido ? '—' : p.markup.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</td>
      <td class="celula-calc ${p.markup_invalido ? 'celula-calc--erro' : ''}">${p.markup_invalido ? 'inválido' : moeda(p.preco_sugerido)}</td>
      <td style="width:120px"><input type="number" step="0.01" data-pp="preco_venda_manual" class="${p.manual ? 'input-manual' : ''}" placeholder="${p.preco_sugerido > 0 ? p.preco_sugerido.toFixed(2) : ''}" value="${p.preco_venda_manual != null ? p.preco_venda_manual : ''}" title="Deixe em branco para usar o preço sugerido, ou digite o preço de venda que você quer" /></td>
      <td style="width:110px"><input type="number" step="0.01" data-pp="preco_mercado" value="${p.preco_mercado != null ? p.preco_mercado : ''}" /></td>
      <td style="width:110px"><input type="number" step="0.01" data-pp="preco_praticado" value="${p.preco_praticado != null ? p.preco_praticado : ''}" /></td>
      <td class="celula-calc">${p.preco_praticado ? pct(p.margem_atual_pct) : '—'}</td>
      <td class="celula-calc ${provaOk ? '' : 'celula-calc--erro'}" title="Frete ${moeda(pr.frete)} · Cartão ${moeda(pr.cartao)} · Impostos ${moeda(pr.impostos)} · Margem ${moeda(pr.margem)} · Despesas ${moeda(pr.despesas)} · Custo ${moeda(pr.custo_produto)}">${moeda(pr.total)} ${provaOk ? '✓' : '⚠️'}</td>
      <td style="width:90px">${p.produto_id ? `<button class="btn ${podeAplicar ? '' : 'btn--secundario'}" data-aplicar="${p.id}" ${podeAplicar ? '' : 'disabled'} title="Gravar ${p.manual ? 'o preço de venda digitado' : 'o preço sugerido'} no produto">Aplicar</button>` : '<span class="dica">avulso</span>'}</td>
      <td style="width:50px"><button class="btn btn--secundario" data-replicar="${p.id}" title="Copiar embalagem, frete, cartão, margem e 'margem do setor' desta linha para as outras do grupo">📋</button></td>
      <td style="width:40px"><button class="btn btn--secundario" data-pp-del="${p.id}">✕</button></td>
    </tr>`;
  }

  function ligarPrecificacao(alvo) {
    alvo.querySelector('#prec-add').addEventListener('click', async () => {
      try { const r = await API.post('/api/precificacao-avancada/produto', {}); gruposAbertos.add('__avulsos__'); await recarregar(r); } catch (e) { UI.erro(e.message); }
    });
    // Filtro de produtos na planilha (mantem o foco enquanto digita).
    const busca = alvo.querySelector('#prec-busca');
    if (busca) {
      let t;
      busca.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(() => { filtroProd = busca.value; renderModulo(); const b2 = raizEl.querySelector('#prec-busca'); if (b2) { b2.focus(); b2.setSelectionRange(b2.value.length, b2.value.length); } }, 200);
      });
    }
    const limpar = alvo.querySelector('#prec-busca-limpar');
    if (limpar) limpar.addEventListener('click', () => { filtroProd = ''; renderModulo(); });
    // Buscar um produto ja cadastrado e adicionar a planilha (avulsos).
    alvo.querySelector('#prec-buscar-cad').addEventListener('click', buscarProdutoCadastro);
    // Expandir/recolher grupos
    alvo.querySelectorAll('[data-toggle]').forEach((h) => h.addEventListener('click', () => {
      const chave = h.dataset.toggle;
      if (gruposAbertos.has(chave)) gruposAbertos.delete(chave); else gruposAbertos.add(chave);
      renderModulo();
    }));
    // Aplicar preco do lote inteiro
    alvo.querySelectorAll('[data-aplicar-lote]').forEach((b) => b.addEventListener('click', async () => {
      const lote = b.dataset.aplicarLote;
      const ok = await UI.confirmar(`Aplicar os preços sugeridos deste grupo aos produtos do cadastro? Isso atualiza o preço de venda de cada produto.`, { titulo: 'Aplicar preços', textoConfirmar: 'Aplicar', perigo: false });
      if (!ok) return;
      try { const r = await API.post('/api/precificacao-avancada/aplicar-lote', { lote }); UI.sucesso(`${r.aplicados} preço(s) aplicado(s)${r.ignorados ? `, ${r.ignorados} ignorado(s)` : ''}.`); await recarregar(r.estado); }
      catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-excluir-lote]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Remover este grupo da planilha de precificação? (Os produtos do cadastro não são afetados.)', { titulo: 'Remover grupo', textoConfirmar: 'Remover' });
      if (!ok) return;
      try { await recarregar(await API.post('/api/precificacao-avancada/excluir-lote', { lote: b.dataset.excluirLote })); } catch (e) { UI.erro(e.message); }
    }));
    // Linhas
    alvo.querySelectorAll('[data-linha]').forEach((tr) => {
      const id = tr.dataset.linha;
      tr.querySelectorAll('[data-pp]').forEach((inp) => inp.addEventListener('change', async () => {
        const campo = inp.dataset.pp;
        let valor = inp.value;
        if (inp.type === 'number') valor = valor === '' ? '' : Number(valor);
        try { await recarregar(await API.put('/api/precificacao-avancada/produto/' + id, { [campo]: valor })); }
        catch (e) { UI.erro(e.message); }
      }));
      const aplicar = tr.querySelector('[data-aplicar]');
      if (aplicar) aplicar.addEventListener('click', async () => {
        try { const r = await API.post('/api/precificacao-avancada/produto/' + aplicar.dataset.aplicar + '/aplicar-preco', {}); UI.sucesso(`Preço ${moeda(r.preco)} aplicado ao produto.`); await recarregar(r.estado); }
        catch (e) { UI.erro(e.message); }
      });
      const del = tr.querySelector('[data-pp-del]');
      if (del) del.addEventListener('click', async () => {
        try { await recarregar(await API.del('/api/precificacao-avancada/produto/' + del.dataset.ppDel)); } catch (e) { UI.erro(e.message); }
      });
      const replicar = tr.querySelector('[data-replicar]');
      if (replicar) replicar.addEventListener('click', async () => {
        try {
          const r = await API.post('/api/precificacao-avancada/produto/' + replicar.dataset.replicar + '/replicar', {});
          if (r.atualizadas) UI.sucesso(`Valores replicados para ${r.atualizadas} outra(s) linha(s) do grupo.`);
          else UI.toast('Não há outras linhas neste grupo para replicar.', 'info');
          await recarregar(r.estado);
        } catch (e) { UI.erro(e.message); }
      });
    });
    ligarScrollDuplo(alvo);
  }

  // Espelha a barra de rolagem horizontal no topo de cada tabela larga, pra
  // não precisar descer até o fim da planilha só pra rolar pros lados.
  function ligarScrollDuplo(alvo) {
    alvo.querySelectorAll('[data-grupo]').forEach((cartao) => {
      const topo = cartao.querySelector('[data-scroll-topo]');
      const largura = cartao.querySelector('[data-scroll-topo-largura]');
      const tabelaBox = cartao.querySelector('[data-scroll-tabela]');
      if (!topo || !largura || !tabelaBox) return;
      const tabela = tabelaBox.querySelector('table');
      largura.style.width = tabela.scrollWidth + 'px';
      let sincronizando = false;
      topo.addEventListener('scroll', () => {
        if (sincronizando) return;
        sincronizando = true; tabelaBox.scrollLeft = topo.scrollLeft; sincronizando = false;
      });
      tabelaBox.addEventListener('scroll', () => {
        if (sincronizando) return;
        sincronizando = true; topo.scrollLeft = tabelaBox.scrollLeft; sincronizando = false;
      });
    });
  }

  // Busca um produto do cadastro e o adiciona a planilha (grupo avulsos).
  function buscarProdutoCadastro() {
    Modal.abrir({
      titulo: 'Buscar produto do cadastro', tamanho: 'modal--pequeno', mostrarConfirmar: false,
      corpoHTML: `
        <div class="campo"><label>Nome ou código de barras</label>
          <input id="pbc-termo" placeholder="Digite para buscar…" autocomplete="off" /></div>
        <div id="pbc-res" class="mt-16"></div>`,
      aoAbrir: (el) => {
        const termo = el.querySelector('#pbc-termo');
        const res = el.querySelector('#pbc-res');
        let t;
        termo.addEventListener('input', () => {
          clearTimeout(t);
          t = setTimeout(async () => {
            const q = termo.value.trim();
            if (!q) { res.innerHTML = ''; return; }
            const achados = await API.get('/api/vendas/buscar-produto?termo=' + encodeURIComponent(q)).catch(() => []);
            if (!achados.length) { res.innerHTML = '<div class="dica">Nenhum produto encontrado.</div>'; return; }
            res.innerHTML = `<div class="pdv-resultados">${achados.map((c) => `
              <button type="button" data-add="${c.id}">${esc(c.nome)} <span class="muted">— custo ${moeda(c.custo)}${c.codigo_barras ? ' · ' + esc(c.codigo_barras) : ''}</span></button>`).join('')}</div>`;
            res.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', async () => {
              try {
                const r = await API.post('/api/precificacao-avancada/produto-existente', { produto_id: Number(b.dataset.add) });
                gruposAbertos.add('__avulsos__');
                await recarregar(r.estado);
                UI.sucesso(r.ja_existe ? 'Produto já estava na planilha.' : 'Produto adicionado à planilha.');
                el.remove();
              } catch (e) { UI.erro(e.message); }
            }));
          }, 250);
        });
        termo.focus();
      },
    });
  }

  return { render, solicitarModulo };
})();
