'use strict';

/**
 * Roteador simples baseado em hash (#/rota). Cada pagina registra-se aqui.
 * Paginas de fases futuras aparecem como "em construcao" ate serem criadas.
 */
(function () {
  const rotas = {
    inicio: { titulo: 'Início', pagina: () => window.PaginaInicio },
    produtos: { titulo: 'Produtos', pagina: () => window.PaginaProdutos },
    compras: { titulo: 'Compras', pagina: () => window.PaginaCompras },
    vendas: { titulo: 'Vendas', pagina: () => window.PaginaVendas },
    pdv: { titulo: 'PDV', pagina: () => window.PaginaPDV },
    precificacao: { titulo: 'Precificação', pagina: () => window.PaginaPrecificacao },
    financeiro: { titulo: 'Financeiro', pagina: () => window.PaginaFinanceiro },
    dashboard: { titulo: 'Dashboard', pagina: () => window.PaginaDashboard },
    relatorios: { titulo: 'Relatórios', pagina: () => window.PaginaRelatorios },
    backup: { titulo: 'Backup', pagina: () => window.PaginaBackup },
  };

  const view = () => document.getElementById('view');
  const titulo = () => document.getElementById('titulo-pagina');

  function rotaAtual() {
    const h = (location.hash || '#/inicio').replace(/^#\//, '');
    return rotas[h] ? h : 'inicio';
  }

  function marcarMenu(nome) {
    document.querySelectorAll('.nav-item').forEach((a) => {
      a.classList.toggle('ativo', a.dataset.rota === nome);
    });
  }

  async function navegar() {
    const nome = rotaAtual();
    const def = rotas[nome];
    marcarMenu(nome);
    titulo().textContent = def.titulo;

    const pagina = def.pagina && def.pagina();
    if (pagina && typeof pagina.render === 'function') {
      try {
        await pagina.render(view());
      } catch (e) {
        view().innerHTML = `<div class="card"><span class="badge badge--erro">Erro</span>
          <p>${UI.escapar(e.message || 'Falha ao carregar a página.')}</p></div>`;
      }
    } else {
      view().innerHTML = `<div class="card vazio">
        <h2>🚧 Em construção</h2>
        <p>O módulo <strong>${def.titulo}</strong> será liberado em uma próxima fase.</p>
      </div>`;
    }
  }

  async function verificarConexao() {
    const badge = document.getElementById('status-banco');
    try {
      const h = await API.get('/api/health');
      badge.textContent = 'Sistema conectado';
      badge.className = 'badge badge--ok';
      const v = document.getElementById('versao-app');
      if (v && h.versao) v.textContent = 'v' + h.versao;
    } catch (e) {
      badge.textContent = 'Sem conexão';
      badge.className = 'badge badge--erro';
    }
  }

  window.addEventListener('hashchange', navegar);
  window.addEventListener('DOMContentLoaded', () => {
    if (!location.hash) location.hash = '#/inicio';
    verificarConexao();
    navegar();
  });
})();
