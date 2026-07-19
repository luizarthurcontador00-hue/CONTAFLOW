'use strict';

/**
 * Pagina inicial: mostra que o sistema esta funcionando e um resumo rapido.
 */
const PaginaInicio = {
  titulo: 'Início',

  async render(container) {
    container.innerHTML = '<div class="card">Carregando…</div>';
    try {
      const status = await API.get('/api/status');
      const t = status.totais || {};
      container.innerHTML = `
        <div class="card mb-16">
          <h2 style="margin-top:0">Bem-vindo(a) ao Gestor de Vendas 👋</h2>
          <p class="muted">Sistema local de gestão de vendas, estoque, compras, financeiro e relatórios.</p>
          <span class="badge badge--ok">Sistema conectado</span>
        </div>

        <div class="grid grid--cards">
          ${cardStat('Produtos', t.produtos)}
          ${cardStat('Categorias', t.categorias)}
          ${cardStat('Fornecedores', t.fornecedores)}
          ${cardStat('Vendas', t.vendas)}
          ${cardStat('Compras', t.compras)}
        </div>

        <div class="card mt-16">
          <h3 style="margin-top:0">Próximos passos</h3>
          <p class="muted">Use o menu à esquerda para navegar. Os módulos são liberados por fase de desenvolvimento.</p>
        </div>
      `;
    } catch (e) {
      container.innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span>
        <p>${UI.escapar(e.message)}</p></div>`;
    }
  },
};

function cardStat(label, valor) {
  return `<div class="card stat">
    <span class="stat__label">${label}</span>
    <span class="stat__value">${UI.numero(valor || 0)}</span>
  </div>`;
}
