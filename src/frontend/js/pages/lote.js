'use strict';

/**
 * Pagina de Cadastro em Lote: grade editavel para cadastrar varios produtos
 * de uma vez, gerador de variacoes (ex: tamanhos de uma camiseta) e
 * importacao por planilha (baixar modelo -> preencher -> subir), que apenas
 * preenche a mesma grade para o usuario revisar antes de salvar.
 */
window.PaginaLote = (function () {
  let categorias = [];
  let fornecedores = [];
  let linhas = []; // { nome, codigo_barras, categoria, fornecedor, unidade, custo, preco_venda, markup, estoque_atual, estoque_minimo, grupo_variacao, variacao, _status, _erro }

  function novaLinha(base) {
    return Object.assign({
      nome: '', codigo_barras: '', categoria: '', fornecedor: '', unidade: 'UN',
      custo: '', preco_venda: '', markup: '', estoque_atual: '', estoque_minimo: '',
      grupo_variacao: '', variacao: '', _status: null, _erro: null,
    }, base || {});
  }

  async function render(container) {
    linhas = [novaLinha(), novaLinha(), novaLinha()];
    [categorias, fornecedores] = await Promise.all([
      API.get('/api/categorias').catch(() => []),
      API.get('/api/fornecedores').catch(() => []),
    ]);

    container.innerHTML = `
      <div class="barra-ferramentas">
        <button class="btn btn--secundario" id="lt-add-linha">+ Adicionar linha</button>
        <button class="btn btn--secundario" id="lt-variacoes">🧬 Gerar variações</button>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="lt-modelo">📥 Baixar planilha modelo</button>
        <input type="file" id="lt-arquivo" accept=".xlsx,.xls,.csv" style="display:none" />
        <button class="btn btn--secundario" id="lt-importar">📤 Importar planilha</button>
        <button class="btn" id="lt-salvar">💾 Salvar todos</button>
      </div>
      <p class="dica mb-16">Preencha o nome de cada produto (obrigatório). Categoria e fornecedor podem ser digitados livremente — se não existirem, são criados automaticamente. Deixe o preço em branco para calcular pelo markup.</p>
      <div class="card"><div id="lt-tabela" style="overflow-x:auto"></div></div>
      <div id="lt-resumo" class="mt-16"></div>
    `;

    container.querySelector('#lt-add-linha').addEventListener('click', () => { linhas.push(novaLinha()); renderTabela(); });
    container.querySelector('#lt-variacoes').addEventListener('click', abrirGeradorVariacoes);
    container.querySelector('#lt-modelo').addEventListener('click', baixarModelo);
    container.querySelector('#lt-importar').addEventListener('click', () => container.querySelector('#lt-arquivo').click());
    container.querySelector('#lt-arquivo').addEventListener('change', importarPlanilha);
    container.querySelector('#lt-salvar').addEventListener('click', salvarTodos);

    renderTabela();
  }

  function renderTabela() {
    const alvo = document.getElementById('lt-tabela');
    if (!alvo) return;
    alvo.innerHTML = `<table class="tabela" style="min-width:1100px">
      <thead><tr>
        <th style="min-width:160px">Nome *</th>
        <th style="min-width:130px">Código de barras</th>
        <th style="min-width:130px">Categoria</th>
        <th style="min-width:130px">Fornecedor</th>
        <th style="width:70px">Unid.</th>
        <th style="width:90px">Custo</th>
        <th style="width:100px">Preço venda</th>
        <th style="width:80px">Markup %</th>
        <th style="width:90px">Estoque</th>
        <th style="width:90px">Est. mín.</th>
        <th style="width:40px"></th>
      </tr></thead>
      <tbody>${linhas.map((l, i) => linhaHTML(l, i)).join('')}</tbody>
    </table>
    <datalist id="lt-lista-categorias">${categorias.map((c) => `<option value="${UI.escapar(c.nome)}">`).join('')}</datalist>
    <datalist id="lt-lista-fornecedores">${fornecedores.map((f) => `<option value="${UI.escapar(f.nome)}">`).join('')}</datalist>`;

    alvo.querySelectorAll('[data-campo]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const idx = Number(inp.dataset.idx);
        linhas[idx][inp.dataset.campo] = inp.value;
      });
    });
    alvo.querySelectorAll('[data-remover]').forEach((btn) => btn.addEventListener('click', () => {
      linhas.splice(Number(btn.dataset.remover), 1);
      renderTabela();
    }));
  }

  function linhaHTML(l, i) {
    const statusBadge = l._status === 'ok'
      ? '<span class="badge badge--ok" title="Cadastrado">✓</span>'
      : l._status === 'erro'
        ? `<span class="badge badge--erro" title="${UI.escapar(l._erro || '')}">✕</span>`
        : '';
    const linhaFeita = l._status === 'ok';
    return `<tr style="${linhaFeita ? 'opacity:.6' : ''}">
      <td><input data-campo="nome" data-idx="${i}" value="${UI.escapar(l.nome)}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td><input data-campo="codigo_barras" data-idx="${i}" value="${UI.escapar(l.codigo_barras)}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td><input data-campo="categoria" data-idx="${i}" list="lt-lista-categorias" value="${UI.escapar(l.categoria)}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td><input data-campo="fornecedor" data-idx="${i}" list="lt-lista-fornecedores" value="${UI.escapar(l.fornecedor)}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td><input data-campo="unidade" data-idx="${i}" value="${UI.escapar(l.unidade)}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td><input type="number" step="0.01" data-campo="custo" data-idx="${i}" value="${l.custo}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td><input type="number" step="0.01" data-campo="preco_venda" data-idx="${i}" value="${l.preco_venda}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td><input type="number" step="0.01" data-campo="markup" data-idx="${i}" value="${l.markup}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td><input type="number" step="0.001" data-campo="estoque_atual" data-idx="${i}" value="${l.estoque_atual}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td><input type="number" step="0.001" data-campo="estoque_minimo" data-idx="${i}" value="${l.estoque_minimo}" ${linhaFeita ? 'disabled' : ''} style="width:100%" /></td>
      <td style="text-align:center">${statusBadge || `<button class="btn btn--secundario" data-remover="${i}" title="Remover linha">✕</button>`}</td>
    </tr>`;
  }

  // ----------------------- Gerador de variações -----------------------
  function abrirGeradorVariacoes() {
    Modal.abrir({
      titulo: 'Gerar variações (ex: tamanhos, cores)',
      tamanho: 'modal--grande',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Nome base do produto *</label><input id="gv-nome" placeholder="Ex.: Camiseta Modelo A" /></div>
          <div class="campo col-2"><label>Variações * <span class="dica">(separadas por vírgula)</span></label>
            <input id="gv-valores" placeholder="Ex.: P, M, G, GG" /></div>
          <div class="campo"><label>Categoria</label><input id="gv-categoria" list="lt-lista-categorias" /></div>
          <div class="campo"><label>Fornecedor</label><input id="gv-fornecedor" list="lt-lista-fornecedores" /></div>
          <div class="campo"><label>Unidade</label><input id="gv-unidade" value="UN" /></div>
          <div class="campo"><label>Custo (aplicado a todas)</label><input id="gv-custo" type="number" step="0.01" /></div>
          <div class="campo"><label>Preço de venda (aplicado a todas)</label><input id="gv-preco" type="number" step="0.01" /></div>
          <div class="campo"><label>Markup % (se não informar preço)</label><input id="gv-markup" type="number" step="0.01" /></div>
          <div class="campo"><label>Estoque inicial (cada variação)</label><input id="gv-estoque" type="number" step="0.001" value="0" /></div>
          <div class="campo"><label>Estoque mínimo (cada variação)</label><input id="gv-estmin" type="number" step="0.001" value="0" /></div>
        </div>
        <p class="dica mt-16">Serão criadas uma linha por variação, com o nome "Base - Variação" (ex.: "Camiseta Modelo A - P"). Ajuste código de barras e preços individualmente na grade depois, se precisar.</p>`,
      textoConfirmar: 'Adicionar à grade',
      aoConfirmar: (el) => {
        const base = el.querySelector('#gv-nome').value.trim();
        const valoresTxt = el.querySelector('#gv-valores').value.trim();
        if (!base) { UI.erro('Informe o nome base do produto.'); return false; }
        const valores = valoresTxt.split(',').map((v) => v.trim()).filter(Boolean);
        if (!valores.length) { UI.erro('Informe ao menos uma variação (ex.: P, M, G).'); return false; }

        const comuns = {
          categoria: el.querySelector('#gv-categoria').value,
          fornecedor: el.querySelector('#gv-fornecedor').value,
          unidade: el.querySelector('#gv-unidade').value || 'UN',
          custo: el.querySelector('#gv-custo').value,
          preco_venda: el.querySelector('#gv-preco').value,
          markup: el.querySelector('#gv-markup').value,
          estoque_atual: el.querySelector('#gv-estoque').value,
          estoque_minimo: el.querySelector('#gv-estmin').value,
          grupo_variacao: base,
        };
        valores.forEach((v) => {
          linhas.push(novaLinha(Object.assign({}, comuns, { nome: `${base} - ${v}`, variacao: v })));
        });
        renderTabela();
        UI.sucesso(`${valores.length} variação(ões) adicionada(s) à grade.`);
      },
    });
  }

  // ----------------------- Planilha -----------------------
  function baixarModelo() {
    const a = document.createElement('a');
    a.href = '/api/produtos/planilha/modelo';
    a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function importarPlanilha(e) {
    const arquivo = e.target.files[0];
    if (!arquivo) return;
    const fd = new FormData();
    fd.append('planilha', arquivo);
    try {
      const resp = await fetch('/api/produtos/planilha/importar', { method: 'POST', body: fd });
      const texto = await resp.text();
      const dados = texto ? JSON.parse(texto) : [];
      if (!resp.ok) throw new Error((dados && dados.erro) || 'Falha ao ler a planilha.');
      // remove linhas em branco nao usadas antes de anexar as importadas
      linhas = linhas.filter((l) => l.nome || l._status);
      dados.forEach((row) => linhas.push(novaLinha(row)));
      renderTabela();
      UI.sucesso(`${dados.length} linha(s) importada(s) da planilha. Revise antes de salvar.`);
    } catch (err) { UI.erro(err.message); }
    e.target.value = '';
  }

  // ----------------------- Salvar -----------------------
  async function salvarTodos() {
    const pendentes = linhas.filter((l) => l._status !== 'ok' && (l.nome || '').trim());
    if (!pendentes.length) { UI.erro('Adicione ao menos um produto com nome preenchido.'); return; }

    let resultado;
    try {
      resultado = await API.post('/api/produtos/lote', { produtos: pendentes });
    } catch (e) { UI.erro(e.message); return; }

    // Casa os resultados de volta com as linhas (na mesma ordem enviada).
    let idxResultado = 0;
    linhas.forEach((l) => {
      if (l._status === 'ok' || !(l.nome || '').trim()) return;
      const r = resultado.resultados[idxResultado++];
      if (r.sucesso) { l._status = 'ok'; l._erro = null; }
      else { l._status = 'erro'; l._erro = r.erro; }
    });

    renderTabela();
    const alvoResumo = document.getElementById('lt-resumo');
    alvoResumo.innerHTML = `<div class="card">
      <span class="badge ${resultado.erros ? 'badge--alerta' : 'badge--ok'}">${resultado.criados} de ${resultado.total} cadastrados</span>
      ${resultado.erros ? `<span class="dica" style="margin-left:8px">Corrija as linhas marcadas com ✕ e clique em Salvar todos novamente.</span>` : ''}
    </div>`;

    if (resultado.erros) UI.toast(`${resultado.criados} cadastrados, ${resultado.erros} com erro.`, 'erro');
    else UI.sucesso(`${resultado.criados} produto(s) cadastrado(s) com sucesso!`);
  }

  return { titulo: 'Cadastro em Lote', render };
})();
