'use strict';

/**
 * Comissões: quanto cada profissional produziu no mês (atendimentos da
 * Agenda + Ordens de Serviço faturados) e a comissão a pagar, calculada
 * pelo percentual cadastrado em cada profissional. Permite lançar a
 * comissão como conta a pagar (uma única vez por profissional/período).
 */
window.PaginaComissoes = (function () {
  let mesAtual = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const abertos = new Set(); // profissional_id com detalhamento expandido

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
    return { inicio: `${aaMm}-01`, fim: `${aaMm}-${String(ultimo).padStart(2, '0')}` };
  }

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="flex gap-12" style="align-items:center">
          <button class="btn btn--secundario" id="cm-ant">◀</button>
          <strong style="min-width:170px;text-align:center">${mesLabel(mesAtual)}</strong>
          <button class="btn btn--secundario" id="cm-prox">▶</button>
          <button class="btn btn--secundario" id="cm-hoje">Mês atual</button>
        </div>
      </div>
      <div id="cm-resumo" class="grid grid--cards mb-16"></div>
      <div id="cm-lista"><div class="card">Carregando…</div></div>`;

    container.querySelector('#cm-ant').addEventListener('click', () => { mesAtual = mudarMes(mesAtual, -1); listar(); });
    container.querySelector('#cm-prox').addEventListener('click', () => { mesAtual = mudarMes(mesAtual, 1); listar(); });
    container.querySelector('#cm-hoje').addEventListener('click', () => { mesAtual = new Date().toISOString().slice(0, 7); listar(); });

    await listar();
  }

  async function listar() {
    const container = document.getElementById('view');
    const cabecalho = container && container.querySelector('.barra-ferramentas strong');
    if (cabecalho) cabecalho.textContent = mesLabel(mesAtual);

    const alvo = document.getElementById('cm-lista');
    if (!alvo) return;
    const { inicio, fim } = periodoMes(mesAtual);
    let itens;
    try { itens = await API.get(`/api/comissoes?inicio=${inicio}&fim=${fim}`); }
    catch (e) { alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    const totalProduzido = itens.reduce((s, i) => s + Number(i.total_produzido), 0);
    const totalComissao = itens.reduce((s, i) => s + Number(i.comissao), 0);
    const totalLancado = itens.filter((i) => i.ja_lancado).reduce((s, i) => s + Number(i.comissao), 0);
    const resumo = document.getElementById('cm-resumo');
    resumo.innerHTML = `
      <div class="card stat"><span class="stat__label">Produzido no mês</span><span class="stat__value">${UI.moeda(totalProduzido)}</span></div>
      <div class="card stat"><span class="stat__label">Comissões do mês</span><span class="stat__value" style="color:var(--primaria)">${UI.moeda(totalComissao)}</span></div>
      <div class="card stat"><span class="stat__label">Já lançadas</span><span class="stat__value" style="color:var(--sucesso)">${UI.moeda(totalLancado)}</span></div>`;

    if (!itens.length) {
      alvo.innerHTML = '<div class="card vazio">Nenhum profissional cadastrado ainda. Cadastre a equipe pela tela de Agenda.</div>';
      return;
    }
    if (!itens.some((i) => i.total_atendimentos > 0)) {
      alvo.innerHTML = '<div class="card vazio">Nenhuma produção registrada neste mês (atendimentos da Agenda ou Ordens de Serviço faturados).</div>';
      return;
    }

    alvo.innerHTML = itens.map((p) => cardProfissional(p)).join('');

    alvo.querySelectorAll('[data-toggle]').forEach((h) => h.addEventListener('click', () => {
      const id = Number(h.dataset.toggle);
      if (abertos.has(id)) abertos.delete(id); else abertos.add(id);
      listar();
    }));
    alvo.querySelectorAll('[data-lancar]').forEach((b) => b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(b.dataset.lancar);
      const item = itens.find((i) => i.profissional_id === id);
      const ok = await UI.confirmar(
        `Lançar a comissão de ${item.nome} (${UI.moeda(item.comissao)}) como conta a pagar para ${mesLabel(mesAtual)}?`,
        { titulo: 'Lançar comissão', textoConfirmar: 'Lançar', perigo: false }
      );
      if (!ok) return;
      try {
        await API.post(`/api/comissoes/${id}/lancar`, { inicio, fim });
        UI.sucesso('Comissão lançada em Contas a Pagar.');
        await listar();
      } catch (err) { UI.erro(err.message); }
    }));
  }

  function cardProfissional(p) {
    const aberto = abertos.has(p.profissional_id);
    const nomeOrigem = { agenda: 'Agenda', os: 'Ordem de serviço' };
    return `<div class="card mb-16">
      <div class="flex flex--between" style="flex-wrap:wrap;gap:12px;cursor:pointer" data-toggle="${p.profissional_id}">
        <div class="flex gap-12" style="align-items:center">
          <span class="cm-cor" style="background:${p.cor || 'var(--primaria)'}"></span>
          <div>
            <strong>${aberto ? '▾' : '▸'} ${UI.escapar(p.nome)}</strong>
            <div class="dica">${p.total_atendimentos} atendimento(s) · comissão ${p.comissao_pct}%</div>
          </div>
        </div>
        <div class="flex gap-12" style="align-items:center;flex-wrap:wrap" onclick="event.stopPropagation()">
          <div style="text-align:right">
            <div class="dica">Produzido: ${UI.moeda(p.total_produzido)}</div>
            <strong style="font-size:18px;color:var(--primaria)">${UI.moeda(p.comissao)}</strong>
          </div>
          ${p.ja_lancado
            ? '<span class="badge badge--ok">✓ Lançada</span>'
            : (p.comissao > 0 ? `<button class="btn" data-lancar="${p.profissional_id}">💾 Lançar comissão</button>` : '<span class="badge badge--muted">Sem comissão</span>')}
        </div>
      </div>
      ${aberto ? `<table class="tabela mt-16">
        <thead><tr><th>Data</th><th>Origem</th><th>Descrição</th><th>Cliente</th><th style="text-align:right">Valor</th></tr></thead>
        <tbody>${p.detalhes.length ? p.detalhes.map((d) => `<tr>
          <td>${d.data ? UI.dataHora(d.data).split(' ')[0] || d.data : '—'}</td>
          <td><span class="badge badge--muted">${nomeOrigem[d.tipo] || d.tipo}</span></td>
          <td>${UI.escapar(d.descricao)}</td>
          <td>${UI.escapar(d.cliente || '—')}</td>
          <td style="text-align:right">${UI.moeda(d.valor)}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted">Nenhum atendimento no período.</td></tr>'}</tbody>
      </table>` : ''}
    </div>`;
  }

  return { titulo: 'Comissões', render };
})();
