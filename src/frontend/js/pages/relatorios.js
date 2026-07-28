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
    // "Estoque atual" e "Produtos parados" so fazem sentido para quem vende produtos.
    const temProdutos = window.__perfilNegocio !== 'servico';
    const temCRM = window.__ramoServico === 'agencia_viagem';
    if (!temProdutos && (relatorio === 'estoque' || relatorio === 'parados')) relatorio = 'vendas';
    if (!temCRM && (relatorio === 'crm' || relatorio === 'viagens')) relatorio = 'vendas';
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="campo"><label class="dica">Relatório</label>
          <select id="r-tipo">
            ${temProdutos ? `<option value="estoque" ${relatorio === 'estoque' ? 'selected' : ''}>Estoque atual</option>` : ''}
            <option value="vendas" ${relatorio === 'vendas' ? 'selected' : ''}>Vendas detalhado</option>
            <option value="financeiro" ${relatorio === 'financeiro' ? 'selected' : ''}>Financeiro</option>
            ${temProdutos ? `<option value="parados" ${relatorio === 'parados' ? 'selected' : ''}>Produtos parados</option>` : ''}
            ${temCRM ? `<option value="crm" ${relatorio === 'crm' ? 'selected' : ''}>Funil do CRM</option>` : ''}
            ${temCRM ? `<option value="viagens" ${relatorio === 'viagens' ? 'selected' : ''}>Viagens</option>` : ''}
          </select></div>
        <div class="campo" id="r-periodo"><label class="dica">De</label><input type="date" id="r-inicio" value="${mesIni}"></div>
        <div class="campo" id="r-periodo2"><label class="dica">Até</label><input type="date" id="r-fim" value="${hoje}"></div>
        <div class="campo" id="r-dias" style="display:none"><label class="dica">Sem vender há pelo menos (dias)</label><input type="number" id="r-dias-input" min="1" value="30" style="width:90px"></div>
        <button class="btn btn--secundario" id="r-gerar" style="align-self:end">Gerar</button>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="r-excel" style="align-self:end">⬇️ Excel</button>
        <button class="btn btn--secundario" id="r-csv" style="align-self:end">⬇️ CSV</button>
        <button class="btn" id="r-pdf" style="align-self:end">🖨️ Imprimir / PDF</button>
      </div>
      <div class="card"><div id="r-conteudo">Selecione um relatório e clique em Gerar.</div></div>

      <div class="card mt-16">
        <h3 style="margin-top:0">📊 Exportar para o contador</h3>
        <p class="dica">Gera uma planilha Excel com Vendas, Compras, Contas Pagas e Contas Recebidas do período — pronta para mandar pro contador fechar o mês.</p>
        <div class="barra-ferramentas" style="margin-bottom:0">
          <div class="campo"><label class="dica">De</label><input type="date" id="ec-inicio" value="${mesIni}"></div>
          <div class="campo"><label class="dica">Até</label><input type="date" id="ec-fim" value="${hoje}"></div>
          <button class="btn" id="ec-exportar" style="align-self:end">⬇️ Baixar planilha</button>
        </div>
      </div>`;

    const tipo = container.querySelector('#r-tipo');
    tipo.addEventListener('change', () => { relatorio = tipo.value; ajustarPeriodo(); });
    container.querySelector('#r-gerar').addEventListener('click', gerar);
    container.querySelector('#r-excel').addEventListener('click', () => exportar('xls'));
    container.querySelector('#r-csv').addEventListener('click', () => exportar('csv'));
    container.querySelector('#r-pdf').addEventListener('click', imprimir);
    container.querySelector('#ec-exportar').addEventListener('click', exportarContador);
    ajustarPeriodo();
    await gerar();
  }

  function ajustarPeriodo() {
    const mostrarPeriodo = relatorio !== 'estoque' && relatorio !== 'parados';
    document.getElementById('r-periodo').style.display = mostrarPeriodo ? '' : 'none';
    document.getElementById('r-periodo2').style.display = mostrarPeriodo ? '' : 'none';
    document.getElementById('r-dias').style.display = relatorio === 'parados' ? '' : 'none';
  }

  function params() {
    const p = new URLSearchParams();
    if (relatorio !== 'estoque' && relatorio !== 'parados') {
      p.set('inicio', document.getElementById('r-inicio').value);
      p.set('fim', document.getElementById('r-fim').value);
    }
    if (relatorio === 'parados') {
      p.set('dias', document.getElementById('r-dias-input').value || 30);
    }
    return p;
  }

  function exportarContador() {
    const inicio = document.getElementById('ec-inicio').value;
    const fim = document.getElementById('ec-fim').value;
    const url = `/api/relatorios/contador?inicio=${inicio}&fim=${fim}`;
    const a = document.createElement('a');
    a.href = url; a.download = '';
    document.body.appendChild(a); a.click(); a.remove();
  }

  async function gerar() {
    const alvo = document.getElementById('r-conteudo');
    alvo.innerHTML = 'Gerando…';
    let dados;
    try { dados = await API.get(`/api/relatorios/${relatorio}?${params().toString()}`); }
    catch (e) { alvo.innerHTML = `<span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}`; return; }

    if (relatorio === 'estoque') alvo.innerHTML = tabelaEstoque(dados);
    else if (relatorio === 'vendas') alvo.innerHTML = tabelaVendas(dados);
    else if (relatorio === 'parados') alvo.innerHTML = tabelaParados(dados);
    else if (relatorio === 'crm') alvo.innerHTML = tabelaCRM(dados);
    else if (relatorio === 'viagens') alvo.innerHTML = tabelaViagens(dados);
    else alvo.innerHTML = tabelaFinanceiro(dados);
  }

  function tabelaParados(d) {
    return `
      <div class="flex gap-12 mb-16" style="flex-wrap:wrap">
        ${mini('Produtos parados', d.totais.itens)} ${mini('Valor parado (custo)', UI.moeda(d.totais.valor_parado))}
      </div>
      <div id="print-area"><h2 class="print-titulo">Produtos Parados</h2>
      <p class="dica" style="margin-top:0">Itens com estoque que não vendem há um tempo — candidatos a promoção ou revisão de compra.</p>
      <table class="tabela"><thead><tr><th>Produto</th><th>Categoria</th><th>Estoque</th><th>Dias sem venda</th><th>Valor parado</th></tr></thead>
      <tbody>${d.itens.length ? d.itens.map((i) => `<tr>
        <td>${UI.escapar(i.nome)}</td><td>${UI.escapar(i.categoria || '—')}</td><td>${UI.numero(i.estoque_atual)}</td>
        <td>${i.dias_sem_venda == null ? '<span class="badge badge--erro">Nunca vendido</span>' : i.dias_sem_venda}</td>
        <td>${UI.moeda(i.valor_parado)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="muted">Nenhum produto parado nesse período.</td></tr>'}</tbody></table></div>`;
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

  function tabelaCRM(d) {
    const rotulos = { contato: 'Contato', proposta: 'Proposta', pagamento: 'Pagamento', vendido: 'Vendido', perdido: 'Perdido' };
    return `
      <div class="flex gap-12 mb-16" style="flex-wrap:wrap">
        ${mini('Leads no período', d.totalLeads)} ${mini('Vendas fechadas', d.totais.vendas)}
        ${mini('Taxa de conversão', d.totais.taxa_conversao + '%')}
        ${mini('Comissão da agência', UI.moeda(d.totais.comissao_agencia))}
        ${mini('Comissão dos funcionários', UI.moeda(d.totais.comissao_funcionario))}
        ${mini('Lucro líquido', UI.moeda(d.totais.lucro_liquido))}
      </div>
      <div id="print-area"><h2 class="print-titulo">Funil do CRM</h2>
      <h3>Leads por etapa</h3>
      <table class="tabela"><thead><tr>${Object.keys(rotulos).map((k) => `<th>${rotulos[k]}</th>`).join('')}</tr></thead>
      <tbody><tr>${Object.keys(rotulos).map((k) => `<td>${d.porStatus[k] || 0}</td>`).join('')}</tr></tbody></table>
      <h3 class="mt-16">Vendas fechadas no período</h3>
      <p class="dica" style="margin-top:0">Valor da venda é informativo (o pacote é da operadora) — a receita de verdade da agência é a comissão.</p>
      <table class="tabela"><thead><tr><th>Cliente</th><th>Descrição</th><th>Funcionário</th><th>Valor da venda</th><th>Comissão agência</th><th>Comissão funcionário</th></tr></thead>
      <tbody>${d.vendas.length ? d.vendas.map((v) => `<tr>
        <td>${UI.escapar(v.lead_nome)}</td><td>${UI.escapar(v.descricao)}</td><td>${UI.escapar(v.agente_nome || '—')}</td>
        <td>${UI.moeda(v.valor_venda)}</td><td>${UI.moeda(v.comissao_valor)}</td><td>${UI.moeda(v.comissao_funcionario_valor || 0)}</td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted">Nenhuma venda fechada nesse período.</td></tr>'}</tbody></table></div>`;
  }

  function tabelaViagens(d) {
    return `
      <div class="flex gap-12 mb-16" style="flex-wrap:wrap">
        ${mini('Viagens no período', d.totais.viagens)} ${mini('Check-ins feitos', d.totais.checkins_feitos)}
        ${mini('Comissão da agência', UI.moeda(d.totais.comissao_agencia))}
        ${mini('Comissão dos funcionários', UI.moeda(d.totais.comissao_funcionario))}
      </div>
      <div id="print-area"><h2 class="print-titulo">Relatório de Viagens</h2>
      <table class="tabela"><thead><tr><th>Cliente</th><th>Destino/pacote</th><th>Ida</th><th>Volta</th><th>Funcionário</th><th>Valor venda</th><th>Comissão agência</th><th>Comissão funcionário</th><th>Check-in</th></tr></thead>
      <tbody>${d.itens.length ? d.itens.map((v) => `<tr>
        <td>${UI.escapar(v.cliente_nome)}</td><td>${UI.escapar(v.descricao)}</td><td>${v.data_ida || '—'}</td><td>${v.data_volta || '—'}</td>
        <td>${UI.escapar(v.agente_nome || '—')}</td><td>${UI.moeda(v.valor_venda)}</td><td>${UI.moeda(v.comissao_valor)}</td>
        <td>${UI.moeda(v.comissao_funcionario_valor || 0)}</td><td>${v.checkin_feito ? '✅' : '—'}</td>
      </tr>`).join('') : '<tr><td colspan="9" class="muted">Nenhuma viagem nesse período.</td></tr>'}</tbody></table></div>`;
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
    UI.imprimir(`<html><head><title>Relatório</title>
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
  }

  return { titulo: 'Relatórios', render };
})();
