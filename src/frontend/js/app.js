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
    agenda: { titulo: 'Agenda', pagina: () => window.PaginaAgenda },
    ordens: { titulo: 'Ordens & Orçamentos', pagina: () => window.PaginaOrdens },
    lote: { titulo: 'Cadastro em Lote', pagina: () => window.PaginaLote },
    clientes: { titulo: 'Clientes', pagina: () => window.PaginaClientes },
    fornecedores: { titulo: 'Fornecedores', pagina: () => window.PaginaFornecedores },
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
  // Ramo de atividade (só importa quando perfil inclui 'servico'):
  // 'salao' | 'oficina' | 'geral'. Refina ainda mais o que aparece —
  // ex.: Ordens de Serviço/Pátio (foco oficina) não faz sentido num salão.
  let ramo = 'geral';
  const rotaPerfil = { produtos: 'comercio', compras: 'comercio', fornecedores: 'comercio', servicos: 'servico', agenda: 'servico' };

  function rotaVisivel(nome) {
    if (nome === 'ordens') return perfil === 'comercio' || ramo !== 'salao';
    const p = rotaPerfil[nome];
    return !p || perfil === 'ambos' || perfil === p;
  }

  function aplicarPerfil() {
    document.querySelectorAll('.nav-item[data-perfil]').forEach((a) => {
      const mostra = perfil === 'ambos' || perfil === a.dataset.perfil;
      a.style.display = mostra ? '' : 'none';
    });
    // Regra composta: Ordens & Orçamentos (Pátio/OS) some para o ramo "salão".
    const linkOrdens = document.querySelector('.nav-item[data-rota="ordens"]');
    if (linkOrdens) linkOrdens.style.display = rotaVisivel('ordens') ? '' : 'none';
    // Esconde o grupo inteiro (cabeçalho) quando nenhum item dele estiver visível.
    document.querySelectorAll('.nav-group').forEach((grupo) => {
      const filhos = Array.from(grupo.querySelectorAll('.nav-submenu > .nav-item'));
      const algumVisivel = filhos.some((a) => a.style.display !== 'none');
      grupo.style.display = algumVisivel ? '' : 'none';
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
    document.querySelectorAll('.nav-item[data-rota]').forEach((a) => {
      a.classList.toggle('ativo', a.dataset.rota === nome);
    });
    // Destaca também o cabeçalho do grupo que contém a rota atual.
    document.querySelectorAll('.nav-group__cabecalho').forEach((c) => c.classList.remove('ativo'));
    const linkAtivo = Array.from(document.querySelectorAll('.nav-item[data-rota]')).find((a) => a.dataset.rota === nome);
    const grupo = linkAtivo && linkAtivo.closest('.nav-group');
    if (grupo) {
      const cabecalho = grupo.querySelector('.nav-group__cabecalho');
      if (cabecalho) cabecalho.classList.add('ativo');
    }
  }

  // ----------------------- Submenus do menu lateral (flyout ao passar o mouse) -----------------------
  function configurarSubmenus() {
    const grupos = Array.from(document.querySelectorAll('.nav-group'));
    let timerFechar = null;

    function fecharTodos() {
      grupos.forEach((g) => g.classList.remove('nav-group--aberto'));
    }

    function abrir(grupo) {
      clearTimeout(timerFechar);
      grupos.forEach((g) => g.classList.toggle('nav-group--aberto', g === grupo));
      const cabecalho = grupo.querySelector('.nav-group__cabecalho');
      const submenu = grupo.querySelector('.nav-submenu');
      const rSidebar = document.querySelector('.sidebar').getBoundingClientRect();
      const rCabecalho = cabecalho.getBoundingClientRect();
      submenu.style.left = rSidebar.right + 'px';
      // Mantem o submenu dentro da tela verticalmente.
      const alturaEstimada = submenu.offsetHeight || (submenu.children.length * 40 + 12);
      const topo = Math.max(6, Math.min(rCabecalho.top, window.innerHeight - alturaEstimada - 6));
      submenu.style.top = topo + 'px';
    }

    function agendarFechamento() {
      clearTimeout(timerFechar);
      timerFechar = setTimeout(fecharTodos, 220);
    }

    grupos.forEach((grupo) => {
      const cabecalho = grupo.querySelector('.nav-group__cabecalho');
      const submenu = grupo.querySelector('.nav-submenu');

      cabecalho.addEventListener('mouseenter', () => abrir(grupo));
      submenu.addEventListener('mouseenter', () => clearTimeout(timerFechar));
      cabecalho.addEventListener('mouseleave', agendarFechamento);
      submenu.addEventListener('mouseleave', agendarFechamento);

      cabecalho.addEventListener('click', () => {
        if (grupo.classList.contains('nav-group--aberto')) fecharTodos();
        else abrir(grupo);
      });
      cabecalho.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (grupo.classList.contains('nav-group--aberto')) fecharTodos(); else abrir(grupo);
        } else if (e.key === 'Escape') {
          fecharTodos(); cabecalho.blur();
        }
      });

      // Teclado: manter aberto enquanto o foco estiver em qualquer item do grupo.
      grupo.addEventListener('focusin', () => abrir(grupo));
      grupo.addEventListener('focusout', (e) => {
        if (!grupo.contains(e.relatedTarget)) agendarFechamento();
      });

      submenu.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', fecharTodos));
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nav-group')) fecharTodos();
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
    ramo = ['salao', 'oficina', 'geral'].includes(cfg.ramo_servico) ? cfg.ramo_servico : 'geral';
    aplicarPerfil();
    aplicarAparencia(cfg);
    return cfg;
  }

  // Escurece uma cor hex em ~12% para o estado :hover dos botões.
  function escurecer(hex, fator = 0.85) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return hex;
    const n = parseInt(m[1], 16);
    const r = Math.round(((n >> 16) & 255) * fator);
    const g = Math.round(((n >> 8) & 255) * fator);
    const b = Math.round((n & 255) * fator);
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  // Aplica logo, nome, cor principal e tamanho da fonte (personalização).
  function aplicarAparencia(cfg) {
    const root = document.documentElement;
    if (cfg.cor_primaria) {
      root.style.setProperty('--primaria', cfg.cor_primaria);
      root.style.setProperty('--primaria-escura', escurecer(cfg.cor_primaria));
    }
    const escalas = { pequeno: '14px', normal: '15px', grande: '17px', maior: '19px' };
    document.body.style.fontSize = escalas[cfg.fonte_escala] || '15px';

    const logoEl = document.querySelector('.sidebar__logo');
    if (logoEl) {
      if (cfg.loja_logo) logoEl.innerHTML = `<img src="${cfg.loja_logo}" alt="logo">`;
      else logoEl.textContent = iniciais(cfg.nome_loja) || 'GV';
    }
    const tituloEl = document.querySelector('.sidebar__title');
    if (tituloEl && cfg.nome_loja) tituloEl.textContent = cfg.nome_loja;
    if (cfg.nome_loja) document.title = cfg.nome_loja;
  }

  function iniciais(nome) {
    if (!nome) return '';
    const partes = String(nome).trim().split(/\s+/).slice(0, 2);
    return partes.map((p) => p[0]).join('').toUpperCase();
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
        </div>
        <div class="campo mt-16" id="ob-ramo-wrap" style="display:none">
          <label>Qual o seu ramo de serviço? <span class="dica">(refina o que aparece no menu)</span></label>
          <div id="ob-ramo" class="ob-perfil">
            <button type="button" class="ob-opcao ativa" data-r="salao"><span class="ob-opcao__ic">💇</span><strong>Salão / Barbearia / Estética</strong><span class="dica">Agenda e catálogo de serviços</span></button>
            <button type="button" class="ob-opcao" data-r="oficina"><span class="ob-opcao__ic">🔧</span><strong>Oficina / Assistência técnica</strong><span class="dica">Ordens de serviço, pátio e peças</span></button>
            <button type="button" class="ob-opcao" data-r="geral"><span class="ob-opcao__ic">💼</span><strong>Outros serviços</strong><span class="dica">Consultoria, autônomo, geral</span></button>
          </div>
        </div>`;
      let escolha = 'ambos';
      let ramoEscolha = 'salao';
      Modal.abrir({
        titulo: 'Configuração inicial', tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Concluir',
        aoAbrir: (el) => {
          const ramoWrap = el.querySelector('#ob-ramo-wrap');
          const atualizarRamoWrap = () => { ramoWrap.style.display = (escolha === 'servico' || escolha === 'ambos') ? '' : 'none'; };
          el.querySelectorAll('#ob-perfil .ob-opcao').forEach((b) => b.addEventListener('click', () => {
            escolha = b.dataset.p;
            el.querySelectorAll('#ob-perfil .ob-opcao').forEach((x) => x.classList.toggle('ativa', x === b));
            atualizarRamoWrap();
          }));
          el.querySelectorAll('#ob-ramo .ob-opcao').forEach((b) => b.addEventListener('click', () => {
            ramoEscolha = b.dataset.r;
            el.querySelectorAll('#ob-ramo .ob-opcao').forEach((x) => x.classList.toggle('ativa', x === b));
          }));
          atualizarRamoWrap();
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
              ramo_servico: (escolha === 'servico' || escolha === 'ambos') ? ramoEscolha : 'geral',
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
    configurarSubmenus();
    verificarConexao();
    const cfg = await carregarPerfil();
    if (cfg.onboarding_ok !== '1') {
      await abrirOnboarding();
      await carregarPerfil();
    }
    navegar();
  });
})();
