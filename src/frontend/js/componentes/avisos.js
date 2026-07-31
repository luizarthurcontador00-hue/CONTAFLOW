'use strict';

/**
 * Sininho de avisos do topo — visível em qualquer tela do sistema.
 *
 * Junta tudo que precisa de atenção (instrumento não devolvido, chamada não
 * feita, aluno sumindo, gente na fila de espera, conta vencida...) num lugar
 * só, com um contador. A ideia é que a pessoa não precise lembrar de entrar
 * em cada tela para descobrir que tem pendência.
 *
 * Atualiza sozinho a cada 3 minutos e sempre que a tela muda.
 */
window.Avisos = (function () {
  const CORES = { critico: 'erro', alerta: 'alerta', informativo: 'muted' };
  let ultimo = null;
  let painelAberto = false;

  function elSino() { return document.getElementById('sino-avisos'); }

  /** Desenha o sino com o contador (ou apagado quando não há nada). */
  function desenharSino(dados) {
    const sino = elSino();
    if (!sino) return;
    const total = dados ? dados.total : 0;
    const critico = dados && dados.criticos > 0;

    sino.innerHTML = `
      <span class="sino__icone">🔔</span>
      ${total ? `<span class="sino__contador ${critico ? 'sino__contador--critico' : ''}">${total > 99 ? '99+' : total}</span>` : ''}`;
    sino.title = total
      ? `${total} pendência(s)${critico ? ` — ${dados.criticos} urgente(s)` : ''}`
      : 'Nenhuma pendência';
    sino.classList.toggle('sino--tem', total > 0);
    sino.classList.toggle('sino--critico', !!critico);
  }

  async function atualizar() {
    try {
      ultimo = await API.get('/api/avisos');
    } catch (_) {
      ultimo = null;
    }
    desenharSino(ultimo);
    if (painelAberto) desenharPainel();
    return ultimo;
  }

  function fecharPainel() {
    const p = document.getElementById('painel-avisos');
    if (p) p.remove();
    painelAberto = false;
    document.removeEventListener('click', aoClicarFora, true);
  }

  function aoClicarFora(ev) {
    const painel = document.getElementById('painel-avisos');
    if (!painel) return;
    if (painel.contains(ev.target) || (elSino() && elSino().contains(ev.target))) return;
    fecharPainel();
  }

  function desenharPainel() {
    let painel = document.getElementById('painel-avisos');
    if (!painel) {
      painel = document.createElement('div');
      painel.id = 'painel-avisos';
      painel.className = 'painel-avisos';
      document.body.appendChild(painel);
    }

    const sino = elSino();
    if (sino) {
      const r = sino.getBoundingClientRect();
      painel.style.top = `${r.bottom + 8}px`;
      painel.style.right = `${Math.max(12, window.innerWidth - r.right)}px`;
    }

    const avisos = (ultimo && ultimo.avisos) || [];
    painel.innerHTML = `
      <div class="painel-avisos__topo">
        <strong>Avisos</strong>
        <button class="painel-avisos__fechar" type="button" title="Fechar">&times;</button>
      </div>
      <div class="painel-avisos__corpo">
        ${!avisos.length
          ? '<div class="painel-avisos__vazio">✅ Nada pendente por aqui.</div>'
          : avisos.map((a, i) => `
            <button class="aviso" type="button" data-ir="${i}">
              <span class="aviso__icone">${a.icone || '•'}</span>
              <span class="aviso__texto">
                <span class="aviso__titulo">
                  ${UI.escapar(a.titulo)}
                  <span class="badge badge--${CORES[a.gravidade] || 'muted'}">${a.gravidade}</span>
                </span>
                ${(a.detalhe || []).map((d) => `<span class="aviso__detalhe">${UI.escapar(d)}</span>`).join('')}
                ${a.quantidade > (a.detalhe || []).length
                  ? `<span class="aviso__detalhe">…e mais ${a.quantidade - a.detalhe.length}</span>` : ''}
                ${a.ajuda ? `<span class="aviso__ajuda">${UI.escapar(a.ajuda)}</span>` : ''}
              </span>
            </button>`).join('')}
      </div>
      <div class="painel-avisos__rodape">
        <button class="btn btn--secundario" type="button" id="avisos-atualizar">Atualizar</button>
      </div>`;

    painel.querySelector('.painel-avisos__fechar').addEventListener('click', fecharPainel);
    painel.querySelector('#avisos-atualizar').addEventListener('click', () => atualizar());
    painel.querySelectorAll('[data-ir]').forEach((b) => b.addEventListener('click', () => {
      const a = avisos[Number(b.dataset.ir)];
      fecharPainel();
      if (a && a.rota) location.hash = a.rota;
    }));
  }

  function alternarPainel() {
    if (painelAberto) { fecharPainel(); return; }
    painelAberto = true;
    desenharPainel();
    // no proximo tick, para nao fechar com o mesmo clique que abriu
    setTimeout(() => document.addEventListener('click', aoClicarFora, true), 0);
    atualizar();
  }

  function iniciar() {
    const sino = elSino();
    if (!sino) return;
    sino.addEventListener('click', alternarPainel);
    desenharSino(null);
    atualizar();
    setInterval(atualizar, 3 * 60 * 1000);
    window.addEventListener('hashchange', () => { if (painelAberto) fecharPainel(); });
  }

  return { iniciar, atualizar, alternarPainel };
})();
