'use strict';

/**
 * Pagina de Vendas: historico com filtros (periodo, forma de pagamento,
 * produto), detalhe da venda e cancelamento/estorno.
 * A realizacao de novas vendas fica no PDV.
 */
window.PaginaVendas = (function () {
  const FORMAS = {
    dinheiro: 'Dinheiro', cartao_credito: 'Cartão crédito', cartao_debito: 'Cartão débito',
    pix: 'PIX', prazo: 'A prazo',
  };

  async function render(container) {
    const hoje = new Date().toISOString().slice(0, 10);
    const mesInicio = hoje.slice(0, 8) + '01';
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="campo"><label class="dica">De</label><input type="date" id="f-inicio" value="${mesInicio}"></div>
        <div class="campo"><label class="dica">Até</label><input type="date" id="f-fim" value="${hoje}"></div>
        <div class="campo"><label class="dica">Forma</label>
          <select id="f-forma"><option value="">Todas</option>${Object.entries(FORMAS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
        </div>
        <div class="campo"><label class="dica">Status</label>
          <select id="f-status"><option value="">Todas</option><option value="concluida">Concluídas</option><option value="cancelada">Canceladas</option></select>
        </div>
        <button class="btn btn--secundario" id="f-aplicar" style="align-self:end">Filtrar</button>
        <div class="cresce"></div>
        <button class="btn" id="btn-nova" style="align-self:end">🛒 Nova venda (PDV)</button>
      </div>
      <div id="resumo-vendas" class="grid grid--cards mb-16"></div>
      <div class="card"><div id="lista-vendas">Carregando…</div></div>`;

    container.querySelector('#f-aplicar').addEventListener('click', listar);
    container.querySelector('#btn-nova').addEventListener('click', () => { location.hash = '#/pdv'; });
    await listar();
  }

  function filtros() {
    return {
      inicio: val('f-inicio'), fim: val('f-fim'),
      forma_pagamento: val('f-forma'), status: val('f-status'),
    };
  }
  function val(id) { const e = document.getElementById(id); return e ? e.value : ''; }

  async function listar() {
    const alvo = document.getElementById('lista-vendas');
    const f = filtros();
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    let vendas;
    try { vendas = await API.get('/api/vendas?' + params.toString()); }
    catch (e) { alvo.innerHTML = `<span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}`; return; }

    // Resumo
    const concl = vendas.filter((v) => v.status === 'concluida');
    const totalPeriodo = concl.reduce((s, v) => s + Number(v.valor_total), 0);
    document.getElementById('resumo-vendas').innerHTML = `
      ${cardStat('Vendas concluídas', concl.length)}
      ${cardStat('Faturamento', UI.moeda(totalPeriodo))}
      ${cardStat('Ticket médio', UI.moeda(concl.length ? totalPeriodo / concl.length : 0))}
      ${cardStat('Canceladas', vendas.filter((v) => v.status === 'cancelada').length)}`;

    if (!vendas.length) { alvo.innerHTML = '<p class="muted">Nenhuma venda no período.</p>'; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>#</th><th>Data</th><th>Itens</th><th>Formas</th><th>Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${vendas.map((v) => `<tr style="${v.status === 'cancelada' ? 'opacity:.55' : ''}">
        <td>${v.id}</td>
        <td>${UI.dataHora(v.data)}</td>
        <td>${v.total_itens}</td>
        <td>${(v.formas || '').split(', ').filter(Boolean).map((x) => `<span class="chip-forma">${FORMAS[x] || x}</span>`).join('')}</td>
        <td>${UI.moeda(v.valor_total)}</td>
        <td>${v.status === 'concluida' ? '<span class="badge badge--ok">Concluída</span>' : '<span class="badge badge--erro">Cancelada</span>'}</td>
        <td style="text-align:right"><button class="btn btn--secundario" data-ver="${v.id}">Detalhes</button></td>
      </tr>`).join('')}</tbody></table>`;
    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verVenda(Number(b.dataset.ver))));
  }

  function cardStat(label, valor) {
    return `<div class="card stat"><span class="stat__label">${label}</span><span class="stat__value" style="font-size:22px">${valor}</span></div>`;
  }

  async function verVenda(id) {
    let v;
    try { v = await API.get('/api/vendas/' + id); } catch (e) { UI.erro(e.message); return; }
    const corpo = `
      <div class="flex flex--between mb-16">
        <div><strong>Venda #${v.id}</strong><div class="dica">${UI.dataHora(v.data)}</div></div>
        <div>${v.status === 'concluida' ? '<span class="badge badge--ok">Concluída</span>' : '<span class="badge badge--erro">Cancelada</span>'}</div>
      </div>
      <table class="tabela">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Preço</th><th>Desc.</th><th>Total</th></tr></thead>
        <tbody>${v.itens.map((i) => `<tr>
          <td>${UI.escapar(i.descricao || '—')}</td><td>${UI.numero(i.quantidade)}</td>
          <td>${UI.moeda(i.preco_unitario)}</td><td>${UI.moeda(i.desconto_item)}</td><td>${UI.moeda(i.valor_total)}</td>
        </tr>`).join('')}</tbody>
      </table>
      <div class="flex flex--between mt-16"><span>Subtotal</span><span>${UI.moeda(v.valor_bruto)}</span></div>
      <div class="flex flex--between"><span>Desconto</span><span>- ${UI.moeda(v.desconto)}</span></div>
      <div class="flex flex--between"><strong>Total</strong><strong>${UI.moeda(v.valor_total)}</strong></div>
      <h3 class="mt-16">Pagamentos</h3>
      ${v.pagamentos.map((p) => `<div class="flex flex--between"><span class="chip-forma">${FORMAS[p.forma_pagamento] || p.forma_pagamento}</span><span>${UI.moeda(p.valor)}</span></div>`).join('')}
      ${v.observacao ? `<p class="muted mt-16">${UI.escapar(v.observacao)}</p>` : ''}`;

    Modal.abrir({
      titulo: 'Detalhes da venda', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        if (v.status === 'concluida') {
          const foot = el.querySelector('.modal__foot');
          const btn = document.createElement('button');
          btn.className = 'btn btn--perigo'; btn.textContent = 'Cancelar / estornar venda';
          btn.addEventListener('click', async () => {
            const ok = await UI.confirmar('Cancelar esta venda? O estoque dos itens será devolvido.', { titulo: 'Cancelar venda', textoConfirmar: 'Cancelar venda' });
            if (!ok) return;
            try { await API.post(`/api/vendas/${v.id}/cancelar`, {}); UI.sucesso('Venda cancelada e estoque devolvido.'); el.remove(); await listar(); }
            catch (e) { UI.erro(e.message); }
          });
          foot.insertBefore(btn, foot.firstChild);
        }
      },
    });
  }

  return { titulo: 'Vendas', render };
})();
