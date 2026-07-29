'use strict';

/**
 * Central de Gestao (tela inicial): em vez de graficos e numeros soltos,
 * mostra uma lista priorizada do que precisa de atencao agora (contas
 * vencendo, estoque baixo, faturamento, clientes inativos, meta mensal…).
 * Cada item leva direto para a tela onde a acao e resolvida.
 */
window.PaginaInicio = (function () {
  const NIVEL = {
    vermelho: { icone: '🔴' }, laranja: { icone: '🟠' }, amarelo: { icone: '🟡' },
    azul: { icone: '🔵' }, verde: { icone: '🟢' }, info: { icone: '⚪' },
  };

  function montarItem(item) {
    const d = item.dados || {};
    switch (item.tipo) {
      case 'contas_hoje': {
        const partes = [];
        if (d.qtd_pagar > 0) partes.push(`${d.qtd_pagar} a pagar (${UI.moeda(d.valor_pagar)})`);
        if (d.qtd_receber > 0) partes.push(`${d.qtd_receber} a receber (${UI.moeda(d.valor_receber)})`);
        return { titulo: `${d.qtd} conta${d.qtd > 1 ? 's' : ''} vence${d.qtd > 1 ? 'm' : ''} hoje`, detalhe: partes.join(' · ') };
      }
      case 'contas_atrasadas': {
        const partes = [];
        if (d.qtd_pagar > 0) partes.push(`${d.qtd_pagar} a pagar (${UI.moeda(d.valor_pagar)})`);
        if (d.qtd_receber > 0) partes.push(`${d.qtd_receber} a receber (${UI.moeda(d.valor_receber)})`);
        return { titulo: `${d.qtd} conta${d.qtd > 1 ? 's' : ''} atrasada${d.qtd > 1 ? 's' : ''}`, detalhe: partes.join(' · ') };
      }
      case 'estoque_baixo':
        return { titulo: `${d.qtd} produto${d.qtd > 1 ? 's' : ''} abaixo do estoque mínimo`, detalhe: 'Reponha para não perder vendas.' };
      case 'faturamento_mes': {
        const acima = d.variacao_pct >= 0;
        return {
          titulo: `O faturamento do mês está ${Math.abs(d.variacao_pct)}% ${acima ? 'acima' : 'abaixo'} do mesmo período do mês anterior`,
          detalhe: `${UI.moeda(d.atual)} até agora (mês anterior: ${UI.moeda(d.anterior)})`,
        };
      }
      case 'clientes_inativos':
        return { titulo: `${d.qtd} cliente${d.qtd > 1 ? 's' : ''} há mais de ${d.dias} dias sem comprar`, detalhe: 'Um contato pode reativar essas vendas.' };
      case 'meta_mensal':
        return {
          titulo: `A meta mensal está em ${d.pct}%`,
          detalhe: d.falta > 0 ? `Faltam ${UI.moeda(d.falta)} para atingir a meta de ${UI.moeda(d.meta)}.` : `Meta de ${UI.moeda(d.meta)} atingida! 🎉`,
        };
      case 'meta_nao_definida':
        return { titulo: 'Defina sua meta mensal de faturamento', detalhe: 'Acompanhe o progresso aqui na Central de Gestão.' };
      case 'lembretes_vencidos':
        return { titulo: `${d.qtd} lembrete${d.qtd > 1 ? 's' : ''} vencido${d.qtd > 1 ? 's' : ''}`, detalhe: 'Veja o que ficou pendente.' };
      default:
        return { titulo: item.tipo, detalhe: '' };
    }
  }

  async function render(container) {
    container.innerHTML = `
      <div class="flex flex--between mb-16" style="align-items:flex-end;flex-wrap:wrap;gap:8px">
        <div>
          <h2 style="margin:0 0 4px">Central de Gestão</h2>
          <p class="dica" style="margin:0">O que precisa da sua atenção agora.</p>
        </div>
      </div>
      <div id="central-itens"></div>
      <div class="card mt-16">
        <h3 style="margin-top:0">Resumo rápido</h3>
        <div class="grid grid--cards" id="central-resumo"></div>
      </div>`;

    await Promise.all([carregarCentral(container), carregarResumo()]);
  }

  async function carregarCentral(container) {
    const alvo = container.querySelector('#central-itens');
    let central;
    try { central = await API.get('/api/dashboard/central'); }
    catch (e) { alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    const itens = central.itens || [];
    if (!itens.length) {
      alvo.innerHTML = `<div class="card central-vazio">
        <div style="font-size:32px">✅</div>
        <strong>Tudo em dia!</strong>
        <p class="dica">Nada precisa da sua atenção imediata agora.</p>
      </div>`;
      return;
    }

    alvo.innerHTML = `<div class="central-lista">${itens.map((item, idx) => {
      const { icone } = NIVEL[item.nivel] || NIVEL.info;
      const { titulo, detalhe } = montarItem(item);
      return `<div class="central-item central-item--${item.nivel}" data-idx="${idx}">
        <span class="central-item__icone">${icone}</span>
        <div class="central-item__corpo">
          <span class="central-item__titulo">${UI.escapar(titulo)}</span>
          ${detalhe ? `<span class="central-item__detalhe">${UI.escapar(detalhe)}</span>` : ''}
        </div>
        <span class="central-item__seta">→</span>
      </div>`;
    }).join('')}</div>`;

    alvo.querySelectorAll('[data-idx]').forEach((el) => el.addEventListener('click', () => {
      const item = itens[Number(el.dataset.idx)];
      if (item && item.rota) location.hash = '#/' + item.rota;
    }));
  }

  async function carregarResumo() {
    const alvo = document.getElementById('central-resumo');
    if (!alvo) return;
    const temProdutos = window.__perfilNegocio !== 'servico' && window.__ramoServico !== 'professor';
    let r;
    try { r = await API.get('/api/dashboard/resumo'); } catch { alvo.innerHTML = ''; return; }
    alvo.innerHTML = `
      ${cardStat('Vendas hoje', UI.moeda(r.vendas_hoje.total), `${r.vendas_hoje.qtd} venda(s)`)}
      ${cardStat('Faturamento do mês', UI.moeda(r.vendas_mes.total), `${r.vendas_mes.qtd} venda(s)`)}
      ${cardStat('Lucro do mês', UI.moeda(r.lucro_mes), `margem ${r.margem_mes}%`)}
      ${temProdutos ? cardStat('Estoque baixo', r.estoque_baixo, 'produto(s)') : ''}
      ${cardStat('A receber', UI.moeda(r.a_receber), 'pendente')}
      ${cardStat('A pagar', UI.moeda(r.a_pagar), 'pendente')}`;
  }

  function cardStat(label, valor, sub) {
    return `<div class="card stat">
      <span class="stat__label">${label}</span>
      <span class="stat__value" style="font-size:22px">${valor}</span>
      <span class="dica">${sub || ''}</span>
    </div>`;
  }

  return { titulo: 'Central de Gestão', render };
})();
