'use strict';

/**
 * Dashboard: cartoes-resumo + graficos interativos (vendas por periodo,
 * mais vendidos, margem por categoria, curva ABC, pagar x receber).
 */
window.PaginaDashboard = (function () {
  async function render(container) {
    const hoje = new Date().toISOString().slice(0, 10);
    const ini30 = new Date(Date.now() - 29 * 864e5).toISOString().slice(0, 10);
    // Graficos e cartoes de produto/estoque so fazem sentido para quem vende produtos.
    const temProdutos = window.__perfilNegocio !== 'servico';
    container.innerHTML = `
      <div id="dash-cards" class="grid grid--cards mb-16"></div>
      <div class="barra-ferramentas">
        <div class="campo"><label class="dica">De</label><input type="date" id="d-inicio" value="${ini30}"></div>
        <div class="campo"><label class="dica">Até</label><input type="date" id="d-fim" value="${hoje}"></div>
        <div class="campo"><label class="dica">Agrupar vendas por</label>
          <select id="d-agrup"><option value="dia">Dia</option><option value="mes">Mês</option></select></div>
        <button class="btn btn--secundario" id="d-aplicar" style="align-self:end">Atualizar</button>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px">
        <div class="card"><h3 style="margin-top:0">Vendas por período</h3><div id="g-vendas"></div></div>
        ${temProdutos ? '<div class="card"><h3 style="margin-top:0">Produtos mais vendidos</h3><div id="g-ranking"></div></div>' : '<div class="card"><h3 style="margin-top:0">Contas a pagar x a receber</h3><div id="g-pagrec"></div></div>'}
        ${temProdutos ? `
        <div class="card"><h3 style="margin-top:0">Margem por categoria</h3><div id="g-margem"></div></div>
        <div class="card"><h3 style="margin-top:0">Contas a pagar x a receber</h3><div id="g-pagrec"></div></div>
        <div class="card" style="grid-column:1/3"><h3 style="margin-top:0">Curva ABC de produtos (por faturamento)</h3><div id="g-abc"></div></div>` : ''}
      </div>`;

    container.querySelector('#d-aplicar').addEventListener('click', carregarGraficos);
    await carregarResumo(temProdutos);
    await carregarGraficos(temProdutos);
  }

  async function carregarResumo(temProdutos) {
    let r;
    try { r = await API.get('/api/dashboard/resumo'); } catch { return; }
    document.getElementById('dash-cards').innerHTML = `
      ${card('Vendas hoje', UI.moeda(r.vendas_hoje.total), `${r.vendas_hoje.qtd} venda(s)`)}
      ${card('Faturamento do mês', UI.moeda(r.vendas_mes.total), `${r.vendas_mes.qtd} venda(s)`)}
      ${card('Lucro do mês', UI.moeda(r.lucro_mes), `margem ${r.margem_mes}%`)}
      ${temProdutos ? card('Estoque baixo', r.estoque_baixo, 'produto(s)', r.estoque_baixo > 0 ? 'var(--alerta)' : '') : ''}
      ${card('A receber', UI.moeda(r.a_receber), 'pendente')}
      ${card('A pagar', UI.moeda(r.a_pagar), 'pendente')}`;
  }

  function card(label, valor, sub, cor) {
    return `<div class="card stat">
      <span class="stat__label">${label}</span>
      <span class="stat__value" style="font-size:22px;${cor ? 'color:' + cor : ''}">${valor}</span>
      <span class="dica">${sub || ''}</span></div>`;
  }

  async function carregarGraficos(temProdutos) {
    const inicio = document.getElementById('d-inicio').value;
    const fim = document.getElementById('d-fim').value;
    const agrup = document.getElementById('d-agrup').value;
    const qs = `inicio=${inicio}&fim=${fim}`;

    const pedidos = [
      API.get(`/api/dashboard/vendas-periodo?${qs}&agrupamento=${agrup}`).catch(() => []),
      API.get(`/api/dashboard/pagar-receber?${qs}`).catch(() => ({})),
    ];
    if (temProdutos) {
      pedidos.push(
        API.get(`/api/dashboard/mais-vendidos?${qs}&limite=8&por=quantidade`).catch(() => []),
        API.get(`/api/dashboard/margem-categoria?${qs}`).catch(() => []),
        API.get(`/api/dashboard/curva-abc?${qs}`).catch(() => ({ itens: [] })),
      );
    }
    const [vendas, pagrec, ranking, margem, abc] = await Promise.all(pedidos);

    document.getElementById('g-vendas').innerHTML = Graficos.linha(
      vendas.map((v) => ({ label: v.periodo, valor: v.total })), { moeda: true });

    document.getElementById('g-pagrec').innerHTML = Graficos.barrasHorizontais([
      { label: 'A receber', valor: pagrec.receber || 0 },
      { label: 'A pagar', valor: pagrec.pagar || 0 },
    ], { moeda: true });

    if (!temProdutos) return;

    document.getElementById('g-ranking').innerHTML = Graficos.barrasHorizontais(
      ranking.map((p) => ({ label: p.nome, valor: p.quantidade })), { moeda: false });

    document.getElementById('g-margem').innerHTML = Graficos.barras(
      margem.map((m) => ({ label: m.categoria, valor: m.margem })), { moeda: false, cor: Graficos.CORES[1] });

    document.getElementById('g-abc').innerHTML = abc.itens && abc.itens.length
      ? tabelaABC(abc.itens)
      : '<div class="vazio">Sem vendas no período.</div>';
  }

  function tabelaABC(itens) {
    const cor = { A: '#16a34a', B: '#d97706', C: '#dc2626' };
    return `<table class="tabela">
      <thead><tr><th>#</th><th>Produto</th><th>Faturamento</th><th>%</th><th>% acum.</th><th>Classe</th></tr></thead>
      <tbody>${itens.map((i, idx) => `<tr>
        <td>${idx + 1}</td><td>${UI.escapar(i.nome)}</td><td>${UI.moeda(i.faturamento)}</td>
        <td>${i.perc}%</td><td>${i.perc_acumulado}%</td>
        <td><span class="badge" style="background:${cor[i.classe]}22;color:${cor[i.classe]}">${i.classe}</span></td>
      </tr>`).join('')}</tbody></table>`;
  }

  return { titulo: 'Dashboard', render };
})();
