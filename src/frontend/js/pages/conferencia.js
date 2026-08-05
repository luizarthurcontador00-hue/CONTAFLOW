'use strict';

/**
 * Conferência de mercadoria: quando a caixa física chega, quem recebe bate
 * item a item o que veio contra o que foi cadastrado no sistema (lote a
 * lote, um lote por cadastro em lote feito na tela de Produtos).
 *
 * Não mexe em estoque — isso já aconteceu no cadastro. É só o checklist de
 * recebimento: se a quantidade que chegou for diferente da esperada, fica
 * marcado como divergência para quem conferiu ajustar o estoque à parte.
 */
window.PaginaConferencia = (function () {
  let itens = [];
  let abertos = new Set();

  function agruparPorLote() {
    const mapa = new Map();
    itens.forEach((it) => {
      const chave = it.lote || '__sem_lote__';
      if (!mapa.has(chave)) mapa.set(chave, { lote: it.lote, lote_data: it.lote_data, itens: [] });
      mapa.get(chave).itens.push(it);
    });
    return [...mapa.values()].sort((a, b) => (b.lote_data || '').localeCompare(a.lote_data || ''));
  }

  async function render(container) {
    container.innerHTML = `
      <a href="#/produtos" class="dica" style="display:inline-block;margin-bottom:12px">← Voltar para Produtos</a>
      <div class="barra-ferramentas">
        <p class="dica" style="margin:0">Confira, item a item, o que chegou de verdade contra o que foi cadastrado em lote no sistema.</p>
        <div class="cresce"></div>
        <button class="btn btn--secundario" id="cf-atualizar">🔄 Atualizar</button>
      </div>
      <div id="cf-lista" class="mt-16">Carregando…</div>
    `;
    container.querySelector('#cf-atualizar').addEventListener('click', carregar);
    await carregar();
  }

  async function carregar() {
    const alvo = document.getElementById('cf-lista');
    if (!alvo) return;
    try { itens = await API.get('/api/conferencia'); }
    catch (e) { alvo.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}</div>`; return; }

    if (!itens.length) {
      alvo.innerHTML = `<div class="card vazio">Nenhum item pendente de conferência.
        <div class="dica mt-16">Itens aparecem aqui automaticamente quando você faz um cadastro em lote na tela de Produtos.</div></div>`;
      return;
    }

    const grupos = agruparPorLote();
    if (!abertos.size) grupos.forEach((g) => { if (g.itens.some((i) => !i.conferido)) abertos.add(g.lote || '__sem_lote__'); });

    alvo.innerHTML = grupos.map(htmlGrupo).join('');
    ligar(alvo);
  }

  function htmlGrupo(g) {
    const chave = g.lote || '__sem_lote__';
    const aberto = abertos.has(chave);
    const total = g.itens.length;
    const conferidos = g.itens.filter((i) => i.conferido).length;
    const divergentes = g.itens.filter((i) => i.conferido && Number(i.quantidade_conferida) !== Number(i.quantidade_esperada)).length;
    const completo = conferidos === total;
    const dataTxt = g.lote_data ? UI.dataHora(g.lote_data) : '';
    return `
      <div class="card mb-16" data-grupo="${UI.escapar(chave)}">
        <div class="flex flex--between" style="flex-wrap:wrap;gap:8px;cursor:pointer" data-toggle="${UI.escapar(chave)}">
          <div>
            <strong>${aberto ? '▾' : '▸'} ${UI.escapar(g.lote || 'Sem lote')}</strong>
            <span class="badge ${completo ? 'badge--ok' : 'badge--alerta'}" style="margin-left:8px">${conferidos} de ${total} conferido(s)</span>
            ${divergentes ? `<span class="badge badge--erro" style="margin-left:4px">${divergentes} divergência(s)</span>` : ''}
            ${dataTxt ? `<span class="dica" style="margin-left:8px">${dataTxt}</span>` : ''}
          </div>
          <div class="flex gap-12" onclick="event.stopPropagation()">
            ${completo ? `<button class="btn btn--secundario" data-remover-lote="${UI.escapar(g.lote || '')}">🗑️ Remover grupo</button>` : ''}
          </div>
        </div>
        ${aberto ? `<div class="mt-16" style="overflow-x:auto"><table class="tabela">
          <thead><tr><th>Referência</th><th>Descrição</th><th>Qtd. esperada</th><th>Qtd. recebida</th><th>Observação</th><th>Status</th><th></th></tr></thead>
          <tbody>${g.itens.map(linhaItem).join('')}</tbody>
        </table></div>` : ''}
      </div>`;
  }

  function linhaItem(i) {
    const divergente = i.conferido && Number(i.quantidade_conferida) !== Number(i.quantidade_esperada);
    return `<tr data-item="${i.id}">
      <td>${UI.escapar(i.referencia || i.produto_codigo_barras || '—')}</td>
      <td>${UI.escapar(i.descricao)}</td>
      <td>${UI.numero(i.quantidade_esperada)}</td>
      <td style="width:110px"><input type="number" step="0.001" data-qtd="${i.id}" value="${i.quantidade_conferida != null ? i.quantidade_conferida : i.quantidade_esperada}" ${i.conferido ? 'disabled' : ''} style="width:100%" /></td>
      <td style="width:180px"><input type="text" data-obs="${i.id}" value="${UI.escapar(i.observacao || '')}" placeholder="opcional" ${i.conferido ? 'disabled' : ''} style="width:100%" /></td>
      <td>${i.conferido ? (divergente ? '<span class="badge badge--erro">Divergente</span>' : '<span class="badge badge--ok">OK</span>') : '<span class="badge badge--muted">Pendente</span>'}</td>
      <td style="white-space:nowrap">
        ${i.conferido
          ? `<button class="btn btn--secundario" data-reabrir="${i.id}">↺ Reabrir</button>`
          : `<button class="btn" data-conferir="${i.id}">✓ Conferir</button>`}
      </td>
    </tr>`;
  }

  function ligar(alvo) {
    alvo.querySelectorAll('[data-toggle]').forEach((h) => h.addEventListener('click', () => {
      const chave = h.dataset.toggle;
      if (abertos.has(chave)) abertos.delete(chave); else abertos.add(chave);
      carregar();
    }));
    alvo.querySelectorAll('[data-conferir]').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.conferir;
      const linha = alvo.querySelector(`tr[data-item="${id}"]`);
      const quantidade_conferida = linha.querySelector(`[data-qtd="${id}"]`).value;
      const observacao = linha.querySelector(`[data-obs="${id}"]`).value;
      try { await API.post(`/api/conferencia/${id}/conferir`, { quantidade_conferida, observacao }); await carregar(); }
      catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-reabrir]').forEach((b) => b.addEventListener('click', async () => {
      try { await API.post(`/api/conferencia/${b.dataset.reabrir}/reabrir`, {}); await carregar(); }
      catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-remover-lote]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Remover este grupo já conferido da fila? (Não afeta o estoque nem o cadastro dos produtos.)', { titulo: 'Remover grupo', textoConfirmar: 'Remover' });
      if (!ok) return;
      try { await API.del(`/api/conferencia/lote/${encodeURIComponent(b.dataset.removerLote)}`); await carregar(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  return { titulo: 'Conferência de Mercadoria', render };
})();
