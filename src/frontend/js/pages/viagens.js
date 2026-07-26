'use strict';

/**
 * Calendário de Viagens: uma barra por cliente, indo da data de ida até a
 * data de volta, dentro da grade de dias do mês (estilo linha do tempo).
 * Alimentado automaticamente quando uma venda é fechada no CRM.
 */
window.PaginaViagens = (function () {
  let mesAtual = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  let viagens = [];

  function mesLabel(aaMm) {
    const [a, m] = aaMm.split('-').map(Number);
    const nomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    return `${nomes[m - 1]} de ${a}`;
  }
  function mudarMes(aaMm, delta) {
    const [a, m] = aaMm.split('-').map(Number);
    const d = new Date(a, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function periodoMes(aaMm) {
    const [a, m] = aaMm.split('-').map(Number);
    const ultimo = new Date(a, m, 0).getDate();
    return { inicio: `${aaMm}-01`, fim: `${aaMm}-${String(ultimo).padStart(2, '0')}`, dias: ultimo };
  }

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="flex gap-12" style="align-items:center">
          <button class="btn btn--secundario" id="vg-ant">◀</button>
          <strong style="min-width:170px;text-align:center">${mesLabel(mesAtual)}</strong>
          <button class="btn btn--secundario" id="vg-prox">▶</button>
          <button class="btn btn--secundario" id="vg-hoje">Mês atual</button>
        </div>
      </div>
      <div class="card"><div id="vg-conteudo">Carregando…</div></div>`;

    container.querySelector('#vg-ant').addEventListener('click', () => { mesAtual = mudarMes(mesAtual, -1); listar(); });
    container.querySelector('#vg-prox').addEventListener('click', () => { mesAtual = mudarMes(mesAtual, 1); listar(); });
    container.querySelector('#vg-hoje').addEventListener('click', () => { mesAtual = new Date().toISOString().slice(0, 7); listar(); });
    await listar();
  }

  async function listar() {
    const container = document.getElementById('view');
    const cabecalho = container && container.querySelector('.barra-ferramentas strong');
    if (cabecalho) cabecalho.textContent = mesLabel(mesAtual);

    const alvo = document.getElementById('vg-conteudo');
    if (!alvo) return;
    const { inicio, fim, dias } = periodoMes(mesAtual);
    try { viagens = await API.get(`/api/crm/viagens?inicio=${inicio}&fim=${fim}`); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }

    if (!viagens.length) {
      alvo.innerHTML = '<p class="muted">Nenhuma viagem nesse período. As viagens aparecem aqui quando uma venda é fechada no CRM com data de ida/volta.</p>';
      return;
    }

    const colTemplate = `180px repeat(${dias}, minmax(26px, 1fr))`;
    const diasHTML = Array.from({ length: dias }, (_, i) => `<div class="viagens-dia">${i + 1}</div>`).join('');

    const linhasHTML = viagens.map((v) => {
      const colIni = v.data_ida < inicio ? 2 : (Number(v.data_ida.slice(8, 10)) + 1);
      const colFimBase = v.data_volta > fim ? dias + 1 : Number(v.data_volta.slice(8, 10)) + 1;
      const colFim = Math.max(colIni + 1, colFimBase + 1);
      const cor = v.agente_cor || 'var(--primaria)';
      return `<div class="viagens-linha" style="grid-template-columns:${colTemplate}">
        <div class="viagens-rotulo">${UI.escapar(v.cliente_nome)}</div>
        <div class="viagens-barra" data-ver="${v.id}" style="grid-column:${colIni} / ${colFim};background:${cor}" title="${UI.escapar(v.descricao)}">
          ${UI.escapar(v.descricao)}
        </div>
      </div>`;
    }).join('');

    alvo.innerHTML = `
      <div class="viagens-tabela">
        <div class="viagens-linha viagens-linha--cab" style="grid-template-columns:${colTemplate}">
          <div class="viagens-rotulo">Cliente</div>${diasHTML}
        </div>
        ${linhasHTML}
      </div>`;

    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verViagem(viagens.find((v) => v.id === Number(b.dataset.ver)))));
  }

  function verViagem(v) {
    const corpo = `
      <table class="tabela">
        <tr><th>Cliente</th><td>${UI.escapar(v.cliente_nome)}</td></tr>
        <tr><th>Descrição</th><td>${UI.escapar(v.descricao)}</td></tr>
        ${v.operadora ? `<tr><th>Operadora</th><td>${UI.escapar(v.operadora)}</td></tr>` : ''}
        ${v.numero_reserva ? `<tr><th>Nº reserva</th><td>${UI.escapar(v.numero_reserva)}</td></tr>` : ''}
        <tr><th>Ida</th><td>${v.data_ida || '—'}</td></tr>
        <tr><th>Volta</th><td>${v.data_volta || '—'}</td></tr>
        <tr><th>Valor da venda</th><td>${UI.moeda(v.valor_venda)}</td></tr>
        ${v.agente_nome ? `<tr><th>Agente</th><td>${UI.escapar(v.agente_nome)} ${v.comissao_pct ? `(${v.comissao_pct}%)` : ''}</td></tr>` : ''}
        ${v.comissao_valor > 0 ? `<tr><th>Comissão</th><td>${UI.moeda(v.comissao_valor)}</td></tr>` : ''}
        ${v.observacao ? `<tr><th>Observação</th><td>${UI.escapar(v.observacao)}</td></tr>` : ''}
      </table>`;
    Modal.abrir({ titulo: '✈️ Detalhes da viagem', tamanho: 'modal--pequeno', corpoHTML: corpo, mostrarConfirmar: false });
  }

  return { titulo: 'Calendário de Viagens', render };
})();
