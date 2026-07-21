'use strict';

/**
 * Pagina de Precificacao:
 *  - Simulador: custo + (markup OU margem OU preco) -> mostra os demais
 *  - Reajuste em lote: por categoria/fornecedor, com preview antes de aplicar
 */
window.PaginaPrecificacao = (function () {
  let categorias = [];
  let fornecedores = [];
  let abaTopo = 'planilha';

  async function render(container) {
    container.innerHTML = `
      <div class="tabs">
        <div class="tab ${abaTopo === 'planilha' ? 'ativo' : ''}" data-topo="planilha">📊 Planilha de Precificação</div>
        <div class="tab ${abaTopo === 'ferramentas' ? 'ativo' : ''}" data-topo="ferramentas">🧮 Ferramentas rápidas</div>
      </div>
      <div id="prec-conteudo"></div>`;
    container.querySelectorAll('[data-topo]').forEach((t) => t.addEventListener('click', () => {
      abaTopo = t.dataset.topo;
      container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('ativo', x === t));
      trocarTopo();
    }));
    trocarTopo();
  }

  function trocarTopo() {
    const alvo = document.getElementById('prec-conteudo');
    if (abaTopo === 'planilha') {
      if (window.PrecAvancada) window.PrecAvancada.render(alvo);
      else alvo.innerHTML = '<div class="card">Módulo indisponível.</div>';
    } else {
      renderFerramentas(alvo);
    }
  }

  async function renderFerramentas(container) {
    [categorias, fornecedores] = await Promise.all([
      API.get('/api/categorias').catch(() => []),
      API.get('/api/fornecedores').catch(() => []),
    ]);

    container.innerHTML = `
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px;align-items:start">
        <div class="card">
          <h3 style="margin-top:0">🧮 Simulador de preço</h3>
          <p class="dica">Informe o custo e um dos campos abaixo. Os demais são calculados automaticamente.</p>
          <div class="form-grid">
            <div class="campo col-2"><label>Custo (R$)</label><input id="sim-custo" type="number" step="0.01" min="0" value="10" /></div>
            <div class="campo"><label>Markup (%)</label><input id="sim-markup" type="number" step="0.01" placeholder="ex: 100" /></div>
            <div class="campo"><label>Margem (%)</label><input id="sim-margem" type="number" step="0.01" placeholder="ex: 50" /></div>
            <div class="campo col-2"><label>Preço de venda (R$)</label><input id="sim-preco" type="number" step="0.01" placeholder="ex: 20" /></div>
          </div>
          <div class="card mt-16" style="background:#f8fafc">
            <div class="flex flex--between"><span>Preço sugerido</span><strong id="r-preco" style="font-size:20px;color:var(--primaria)">—</strong></div>
            <div class="flex flex--between mt-16"><span>Markup</span><strong id="r-markup">—</strong></div>
            <div class="flex flex--between"><span>Margem</span><strong id="r-margem">—</strong></div>
            <div class="flex flex--between"><span>Lucro por unidade</span><strong id="r-lucro">—</strong></div>
          </div>
        </div>

        <div class="card">
          <h3 style="margin-top:0">📈 Reajuste de preços em lote</h3>
          <p class="dica">Aumente ou reduza preços de um grupo de produtos de uma vez.</p>
          <div class="form-grid">
            <div class="campo"><label>Filtrar por</label>
              <select id="rj-tipo"><option value="categoria">Categoria</option><option value="fornecedor">Fornecedor</option><option value="todos">Todos os produtos</option></select></div>
            <div class="campo"><label id="rj-alvo-label">Categoria</label><select id="rj-alvo"></select></div>
            <div class="campo"><label>Percentual (%)</label><input id="rj-perc" type="number" step="0.01" placeholder="ex: 10 ou -5" /></div>
            <div class="campo"><label>Base do cálculo</label>
              <select id="rj-base"><option value="preco_venda">Sobre o preço atual</option><option value="custo">Sobre o custo</option></select></div>
          </div>
          <div class="mt-16"><button class="btn btn--secundario" id="rj-preview">Pré-visualizar</button></div>
          <div id="rj-resultado" class="mt-16"></div>
        </div>
      </div>`;

    // Simulador
    ['sim-custo', 'sim-markup', 'sim-margem', 'sim-preco'].forEach((id) => {
      container.querySelector('#' + id).addEventListener('input', (e) => simular(e.target.id));
    });
    simular();

    // Reajuste
    const tipo = container.querySelector('#rj-tipo');
    tipo.addEventListener('change', () => preencherAlvo());
    preencherAlvo();
    container.querySelector('#rj-preview').addEventListener('click', previewReajuste);
  }

  let ultimoEditado = 'sim-markup';
  async function simular(origem) {
    if (origem) ultimoEditado = origem;
    const custo = num('sim-custo');
    const body = { custo };
    // Usa apenas o ultimo campo editado entre markup/margem/preco
    if (ultimoEditado === 'sim-preco' && get('sim-preco') !== '') body.preco = num('sim-preco');
    else if (ultimoEditado === 'sim-margem' && get('sim-margem') !== '') body.margem = num('sim-margem');
    else body.markup = get('sim-markup') !== '' ? num('sim-markup') : 100;

    try {
      const r = await API.post('/api/precificacao/simular', body);
      document.getElementById('r-preco').textContent = UI.moeda(r.preco);
      document.getElementById('r-markup').textContent = r.markup + '%';
      document.getElementById('r-margem').textContent = r.margem + '%';
      document.getElementById('r-lucro').textContent = UI.moeda(r.lucro);
      // Preenche os campos que nao estao sendo editados (feedback ao vivo)
      if (ultimoEditado !== 'sim-markup') setVal('sim-markup', r.markup);
      if (ultimoEditado !== 'sim-margem') setVal('sim-margem', r.margem);
      if (ultimoEditado !== 'sim-preco') setVal('sim-preco', r.preco);
    } catch (e) { UI.erro(e.message); }
  }

  function preencherAlvo() {
    const tipo = get('rj-tipo');
    const label = document.getElementById('rj-alvo-label');
    const alvo = document.getElementById('rj-alvo');
    if (tipo === 'todos') {
      label.textContent = '—'; alvo.innerHTML = '<option value="">Todos os produtos ativos</option>'; alvo.disabled = true;
      return;
    }
    alvo.disabled = false;
    if (tipo === 'categoria') {
      label.textContent = 'Categoria';
      alvo.innerHTML = categorias.map((c) => `<option value="${c.id}">${UI.escapar(c.nome)}</option>`).join('');
    } else {
      label.textContent = 'Fornecedor';
      alvo.innerHTML = fornecedores.map((f) => `<option value="${f.id}">${UI.escapar(f.nome)}</option>`).join('');
    }
  }

  function montarFiltro() {
    const tipo = get('rj-tipo');
    const filtro = { percentual: num('rj-perc'), base: get('rj-base') };
    if (tipo === 'categoria') filtro.categoria_id = get('rj-alvo');
    else if (tipo === 'fornecedor') filtro.fornecedor_id = get('rj-alvo');
    return filtro;
  }

  async function previewReajuste() {
    const filtro = montarFiltro();
    if (get('rj-perc') === '') { UI.erro('Informe o percentual.'); return; }
    let itens;
    try { itens = await API.post('/api/precificacao/reajuste/preview', filtro); }
    catch (e) { UI.erro(e.message); return; }

    const alvo = document.getElementById('rj-resultado');
    if (!itens.length) { alvo.innerHTML = '<p class="muted">Nenhum produto encontrado para esse filtro.</p>'; return; }
    alvo.innerHTML = `
      <div class="flex flex--between mb-16"><strong>${itens.length} produto(s) afetado(s)</strong>
        <button class="btn" id="rj-aplicar">Aplicar reajuste</button></div>
      <div style="max-height:280px;overflow:auto"><table class="tabela">
        <thead><tr><th>Produto</th><th>Preço atual</th><th>Preço novo</th><th>Margem nova</th></tr></thead>
        <tbody>${itens.map((i) => `<tr>
          <td>${UI.escapar(i.nome)}</td><td>${UI.moeda(i.preco_atual)}</td>
          <td><strong>${UI.moeda(i.preco_novo)}</strong></td><td>${i.margem_nova}%</td>
        </tr>`).join('')}</tbody></table></div>`;
    alvo.querySelector('#rj-aplicar').addEventListener('click', async () => {
      const ok = await UI.confirmar(`Aplicar o reajuste em ${itens.length} produto(s)? Esta ação altera os preços de venda.`, { titulo: 'Confirmar reajuste', textoConfirmar: 'Aplicar', perigo: false });
      if (!ok) return;
      try {
        const r = await API.post('/api/precificacao/reajuste/aplicar', filtro);
        UI.sucesso(`${r.atualizados} preço(s) atualizado(s).`);
        alvo.innerHTML = '';
      } catch (e) { UI.erro(e.message); }
    });
  }

  // utils
  function get(id) { const e = document.getElementById(id); return e ? e.value : ''; }
  function num(id) { return Number(get(id) || 0); }
  function setVal(id, v) { const e = document.getElementById(id); if (e && document.activeElement !== e) e.value = v; }

  return { titulo: 'Precificação', render };
})();
