'use strict';

/**
 * Relatorios de apoio a gestao: estoque atual, vendas detalhado e financeiro.
 * Exportacao em Excel (.xls/.csv) e impressao/PDF (dialogo nativo do sistema).
 */
window.PaginaRelatorios = (function () {
  let relatorio = 'estoque';

  async function render(container) {
    const hoje = new Date().toISOString().slice(0, 10);
    const mesIni = hoje.slice(0, 8) + '01';
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="campo"><label class="dica">Relatório</label>
          <select id="r-tipo">
            <option value="estoque">Estoque atual</option>
            <option value="vendas">Vendas detalhado</option>
            <option value="financeiro">Financeiro</option>
          </select></div>
        <div class="campo" id="r-periodo"><label class="dica">De</label><input type="date" id="r-inicio" value="${mesIni}"></div>
        <div class="campo" id="r-periodo2"><label class="dica">Até</label><input type="date" id="r-fim" value="${hoje}"></div>
        <button class="btn btn--secundario" id="r-gerar" style="align-self:end">Gerar</button>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="r-excel" style="align-self:end">⬇️ Excel</button>
        <button class="btn btn--secundario" id="r-csv" style="align-self:end">⬇️ CSV</button>
        <button class="btn" id="r-pdf" style="align-self:end">🖨️ Imprimir / PDF</button>
      </div>
      <div class="card"><div id="r-conteudo">Selecione um relatório e clique em Gerar.</div></div>`;

    const tipo = container.querySelector('#r-tipo');
    tipo.addEventListener('change', () => { relatorio = tipo.value; ajustarPeriodo(); });
    container.querySelector('#r-gerar').addEventListener('click', gerar);
    container.querySelector('#r-excel').addEventListener('click', () => exportar('xls'));
    container.querySelector('#r-csv').addEventListener('click', () => exportar('csv'));
    container.querySelector('#r-pdf').addEventListener('click', imprimir);
    ajustarPeriodo();
    await gerar();
  }

  function ajustarPeriodo() {
    const mostrar = relatorio !== 'estoque';
    document.getElementById('r-periodo').style.display = mostrar ? '' : 'none';
    document.getElementById('r-periodo2').style.display = mostrar ? '' : 'none';
  }

  function params() {
    const p = new URLSearchParams();
    if (relatorio !== 'estoque') {
      p.set('inicio', document.getElementById('r-inicio').value);
      p.set('fim', document.getElementById('r-fim').value);
    }
    return p;
  }

  async function gerar() {
    const alvo = document.getElementById('r-conteudo');
    alvo.innerHTML = 'Gerando…';
    let dados;
    try { dados = await API.get(`/api/relatorios/${relatorio}?${params().toString()}`); }
    catch (e) { alvo.innerHTML = `<span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}`; return; }

    if (relatorio === 'estoque') alvo.innerHTML = tabelaEstoque(dados);
    else if (relatorio === 'vendas') alvo.innerHTML = tabelaVendas(dados);
    else alvo.innerHTML = tabelaFinanceiro(dados);
  }

  function tabelaEstoque(d) {
    return `
      <div class="flex gap-12 mb-16" style="flex-wrap:wrap">
        ${mini('Itens', d.totais.itens)} ${mini('Valor em custo', UI.moeda(d.totais.valor_custo))}
        ${mini('Valor em venda', UI.moeda(d.totais.valor_venda))} ${mini('Lucro potencial', UI.moeda(d.totais.lucro_potencial))}
      </div>
      <div id="print-area"><h2 class="print-titulo">Relatório de Estoque</h2>
      <table class="tabela"><thead><tr><th>Produto</th><th>Categoria</th><th>Estoque</th><th>Custo</th><th>Preço</th><th>Valor custo</th><th>Valor venda</th></tr></thead>
      <tbody>${d.itens.map((i) => `<tr${Number(i.estoque_atual) <= Number(i.estoque_minimo) ? ' style="background:#fef2f2"' : ''}>
        <td>${UI.escapar(i.nome)}</td><td>${UI.escapar(i.categoria || '—')}</td><td>${UI.numero(i.estoque_atual)}</td>
        <td>${UI.moeda(i.custo)}</td><td>${UI.moeda(i.preco_venda)}</td><td>${UI.moeda(i.valor_custo)}</td><td>${UI.moeda(i.valor_venda)}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function tabelaVendas(d) {
    return `
      <div class="flex gap-12 mb-16" style="flex-wrap:wrap">
        ${mini('Vendas', d.totais.vendas)} ${mini('Faturamento', UI.moeda(d.totais.faturamento))}
        ${mini('Descontos', UI.moeda(d.totais.descontos))} ${mini('Canceladas', d.totais.canceladas)}
      </div>
      <div id="print-area"><h2 class="print-titulo">Relatório de Vendas</h2>
      <table class="tabela"><thead><tr><th>#</th><th>Data</th><th>Itens</th><th>Formas</th><th>Total</th><th>Status</th></tr></thead>
      <tbody>${d.itens.map((v) => `<tr>
        <td>${v.id}</td><td>${UI.dataHora(v.data)}</td><td>${v.itens}</td><td>${UI.escapar(v.formas || '')}</td>
        <td>${UI.moeda(v.valor_total)}</td><td>${v.status}</td>
      </tr>`).join('')}</tbody></table></div>`;
  }

  function tabelaFinanceiro(d) {
    return `
      <div class="flex gap-12 mb-16" style="flex-wrap:wrap">
        ${mini('Total a pagar', UI.moeda(d.totais.total_pagar))} ${mini('Pendente a pagar', UI.moeda(d.totais.pagar_pendente))}
        ${mini('Total a receber', UI.moeda(d.totais.total_receber))} ${mini('Pendente a receber', UI.moeda(d.totais.receber_pendente))}
      </div>
      <div id="print-area"><h2 class="print-titulo">Relatório Financeiro</h2>
      <h3>Contas a pagar</h3>
      <table class="tabela"><thead><tr><th>Descrição</th><th>Fornecedor</th><th>Venc.</th><th>Valor</th><th>Status</th></tr></thead>
      <tbody>${d.pagar.map((c) => `<tr><td>${UI.escapar(c.descricao)}</td><td>${UI.escapar(c.fornecedor || '—')}</td><td>${c.vencimento || '—'}</td><td>${UI.moeda(c.valor)}</td><td>${c.status}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhuma</td></tr>'}</tbody></table>
      <h3 class="mt-16">Contas a receber</h3>
      <table class="tabela"><thead><tr><th>Descrição</th><th>Venc.</th><th>Valor</th><th>Status</th></tr></thead>
      <tbody>${d.receber.map((c) => `<tr><td>${UI.escapar(c.descricao)}</td><td>${c.vencimento || '—'}</td><td>${UI.moeda(c.valor)}</td><td>${c.status}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhuma</td></tr>'}</tbody></table></div>`;
  }

  function mini(label, valor) {
    return `<div class="card stat" style="min-width:150px"><span class="stat__label">${label}</span><span class="stat__value" style="font-size:20px">${valor}</span></div>`;
  }

  function exportar(formato) {
    const p = params(); p.set('formato', formato);
    // Abrir a URL faz o backend responder com Content-Disposition attachment (download).
    const url = `/api/relatorios/${relatorio}?${p.toString()}`;
    const a = document.createElement('a');
    a.href = url; a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function imprimir() {
    const area = document.getElementById('print-area');
    if (!area) { UI.erro('Gere o relatório antes de imprimir.'); return; }
    const win = window.open('', '_blank');
    win.document.write(`<html><head><title>Relatório</title>
      <style>
        body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#111}
        table{width:100%;border-collapse:collapse;margin-top:8px}
        th,td{border:1px solid #cbd5e1;padding:6px 8px;font-size:12px;text-align:left}
        th{background:#e0e7ff}
        h2{margin:0 0 4px} h3{margin:16px 0 4px}
      </style></head><body>
      <div style="text-align:right;color:#666;font-size:11px">Emitido em ${new Date().toLocaleString('pt-BR')}</div>
      ${area.innerHTML}
      </body></html>`);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 300);
  }

  return { titulo: 'Relatórios', render };
})();
