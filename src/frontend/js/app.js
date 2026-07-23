'use strict';

/**
 * Roteador simples baseado em hash (#/rota). Cada pagina registra-se aqui.
 * Paginas de fases futuras aparecem como "em construcao" ate serem criadas.
 */
(function () {
  const rotas = {
    inicio: { titulo: 'Início', pagina: () => window.PaginaInicio },
    produtos: { titulo: 'Produtos', pagina: () => window.PaginaProdutos },
    servicos: { titulo: 'Serviços', pagina: () => window.PaginaServicos },
    ordens: { titulo: 'Ordens & Orçamentos', pagina: () => window.PaginaOrdens },
    lote: { titulo: 'Cadastro em Lote', pagina: () => window.PaginaLote },
    clientes: { titulo: 'Clientes', pagina: () => window.PaginaClientes },
    etiquetas: { titulo: 'Etiquetas', pagina: () => window.PaginaEtiquetas },
    compras: { titulo: 'Compras', pagina: () => window.PaginaCompras },
    vendas: { titulo: 'Vendas', pagina: () => window.PaginaVendas },
    pdv: { titulo: 'PDV', pagina: () => window.PaginaPDV },
    precificacao: { titulo: 'Precificação', pagina: () => window.PaginaPrecificacao },
    financeiro: { titulo: 'Financeiro', pagina: () => window.PaginaFinanceiro },
    dashboard: { titulo: 'Dashboard', pagina: () => window.PaginaDashboard },
    relatorios: { titulo: 'Relatórios', pagina: () => window.PaginaRelatorios },
    configuracoes: { titulo: 'Configurações', pagina: () => window.PaginaConfiguracoes },
    backup: { titulo: 'Backup', pagina: () => window.PaginaBackup },
  };

  const view = () => document.getElementById('view');
  const titulo = () => document.getElementById('titulo-pagina');

  // Perfil do negócio: 'comercio' | 'servico' | 'ambos'. Controla quais
  // itens do menu (e rotas) ficam visíveis.
  let perfil = 'ambos';
  const rotaPerfil = { produtos: 'comercio', compras: 'comercio', servicos: 'servico' };

  function rotaVisivel(nome) {
    const p = rotaPerfil[nome];
    return !p || perfil === 'ambos' || perfil === p;
  }

  function aplicarPerfil() {
    document.querySelectorAll('.nav-item[data-perfil]').forEach((a) => {
      const mostra = perfil === 'ambos' || perfil === a.dataset.perfil;
      a.style.display = mostra ? '' : 'none';
    });
  }

  function rotaAtual() {
    const h = (location.hash || '#/inicio').replace(/^#\//, '');
    if (!rotas[h]) return 'inicio';
    // Rota escondida pelo perfil volta para o início.
    if (!rotaVisivel(h)) return 'inicio';
    return h;
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

  // ----------------------- Onboarding / perfil do negócio -----------------------
  async function carregarPerfil() {
    let cfg = {};
    try { cfg = await API.get('/api/config'); } catch (_) { cfg = {}; }
    perfil = ['comercio', 'servico', 'ambos'].includes(cfg.perfil_negocio) ? cfg.perfil_negocio : 'ambos';
    aplicarPerfil();
    return cfg;
  }

  // Permite que a tela de Configurações reaplique o perfil sem recarregar tudo.
  window.__recarregarPerfil = async () => { await carregarPerfil(); if (!rotaVisivel(rotaAtual())) location.hash = '#/inicio'; };

  function abrirOnboarding() {
    return new Promise((resolve) => {
      const corpo = `
        <p class="dica" style="margin-top:0">Bem-vindo! Vamos configurar o sistema para o seu negócio. Você pode alterar tudo depois em <strong>Configurações</strong>.</p>
        <div class="campo"><label>Nome da empresa *</label><input id="ob-nome" placeholder="Ex.: Barbearia do João" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Telefone</label><input id="ob-tel" /></div>
          <div class="campo"><label>CNPJ / CPF</label><input id="ob-doc" /></div>
        </div>
        <div class="campo mt-16"><label>Tipo de atividade *</label>
          <div id="ob-perfil" class="ob-perfil">
            <button type="button" class="ob-opcao" data-p="comercio"><span class="ob-opcao__ic">📦</span><strong>Comércio</strong><span class="dica">Venda de produtos, estoque, compras/NF-e</span></button>
            <button type="button" class="ob-opcao" data-p="servico"><span class="ob-opcao__ic">🧰</span><strong>Serviço</strong><span class="dica">Prestação de serviços (sem estoque)</span></button>
            <button type="button" class="ob-opcao ativa" data-p="ambos"><span class="ob-opcao__ic">🧩</span><strong>Comércio e Serviço</strong><span class="dica">Os dois no mesmo sistema</span></button>
          </div>
        </div>`;
      let escolha = 'ambos';
      Modal.abrir({
        titulo: 'Configuração inicial', tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Concluir',
        aoAbrir: (el) => {
          el.querySelectorAll('.ob-opcao').forEach((b) => b.addEventListener('click', () => {
            escolha = b.dataset.p;
            el.querySelectorAll('.ob-opcao').forEach((x) => x.classList.toggle('ativa', x === b));
          }));
          // Sem botão de cancelar: o onboarding é obrigatório no primeiro uso.
          const cancelar = el.querySelector('.modal__foot .btn--secundario');
          if (cancelar) cancelar.style.display = 'none';
          const fechar = el.querySelector('[data-fechar].modal__fechar');
          if (fechar) fechar.style.display = 'none';
        },
        aoConfirmar: async (el) => {
          const nome = el.querySelector('#ob-nome').value.trim();
          if (!nome) { UI.erro('Informe o nome da empresa.'); return false; }
          try {
            await API.put('/api/config', {
              nome_loja: nome,
              loja_telefone: el.querySelector('#ob-tel').value,
              loja_cnpj: el.querySelector('#ob-doc').value,
              perfil_negocio: escolha,
              onboarding_ok: '1',
            });
            // Alinha a atividade da precificação ao perfil escolhido.
            if (escolha === 'servico') await API.put('/api/precificacao-avancada/config', { atividade: 'servicos' }).catch(() => {});
          } catch (e) { UI.erro(e.message); return false; }
          resolve();
        },
      });
    });
  }

  window.addEventListener('hashchange', navegar);
  window.addEventListener('DOMContentLoaded', async () => {
    if (!location.hash) location.hash = '#/inicio';
    verificarConexao();
    const cfg = await carregarPerfil();
    if (cfg.onboarding_ok !== '1') {
      await abrirOnboarding();
      await carregarPerfil();
    }
    navegar();
  });
})();
