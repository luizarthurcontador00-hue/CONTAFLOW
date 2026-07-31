'use strict';

/**
 * Roteador simples baseado em hash (#/rota). Cada pagina registra-se aqui.
 * Paginas de fases futuras aparecem como "em construcao" ate serem criadas.
 */
(function () {
  const rotas = {
    inicio: { titulo: 'Central de Gestão', pagina: () => window.PaginaInicio },
    produtos: { titulo: 'Produtos', pagina: () => window.PaginaProdutos },
    servicos: { titulo: 'Serviços', pagina: () => window.PaginaServicos },
    agenda: { titulo: 'Agenda', pagina: () => window.PaginaAgenda },
    cursos: { titulo: 'Cursos', pagina: () => window.PaginaCursos },
    instrumentos: { titulo: 'Instrumentos', pagina: () => window.PaginaInstrumentos },
    voluntarios: { titulo: 'Voluntários', pagina: () => window.PaginaVoluntarios },
    membros: { titulo: 'Diretoria', pagina: () => window.PaginaMembros },
    'lista-espera': { titulo: 'Lista de espera', pagina: () => window.PaginaListaEspera },
    autorizacoes: { titulo: 'Autorizações', pagina: () => window.PaginaAutorizacoes },
    atas: { titulo: 'Atas', pagina: () => window.PaginaAtas },
    impacto: { titulo: 'Relatório de impacto', pagina: () => window.PaginaImpacto },
    turmas: { titulo: 'Turmas', pagina: () => window.PaginaTurmas },
    chamada: { titulo: 'Chamada', pagina: () => window.PaginaChamada },
    ordens: { titulo: 'Ordens & Orçamentos', pagina: () => window.PaginaOrdens },
    lote: { titulo: 'Cadastro em Lote', pagina: () => window.PaginaLote },
    clientes: { titulo: 'Clientes', pagina: () => window.PaginaClientes },
    fornecedores: { titulo: 'Fornecedores', pagina: () => window.PaginaFornecedores },
    etiquetas: { titulo: 'Etiquetas', pagina: () => window.PaginaEtiquetas },
    catalogo: { titulo: 'Catálogo', pagina: () => window.PaginaCatalogo },
    compras: { titulo: 'Compras', pagina: () => window.PaginaCompras },
    vendas: { titulo: 'Vendas', pagina: () => window.PaginaVendas },
    sacolas: { titulo: 'Sacolas de venda', pagina: () => window.PaginaSacolas },
    pdv: { titulo: 'PDV', pagina: () => window.PaginaPDV },
    precificacao: { titulo: 'Precificação', pagina: () => window.PaginaPrecificacao },
    financeiro: { titulo: 'Financeiro', pagina: () => window.PaginaFinanceiro },
    comissoes: { titulo: 'Comissões', pagina: () => window.PaginaComissoes },
    crm: { titulo: 'CRM', pagina: () => window.PaginaCRM },
    viagens: { titulo: 'Calendário de Viagens', pagina: () => window.PaginaViagens },
    lembretes: { titulo: 'Lembretes', pagina: () => window.PaginaLembretes },
    tarefas: { titulo: 'Tarefas', pagina: () => window.PaginaTarefas },
    atendimento: { titulo: 'Atendimento', pagina: () => window.PaginaAtendimento },
    dashboard: { titulo: 'Dashboard', pagina: () => window.PaginaDashboard },
    relatorios: { titulo: 'Relatórios', pagina: () => window.PaginaRelatorios },
    configuracoes: { titulo: 'Configurações', pagina: () => window.PaginaConfiguracoes },
    backup: { titulo: 'Backup', pagina: () => window.PaginaBackup },
  };

  const view = () => document.getElementById('view');
  const titulo = () => document.getElementById('titulo-pagina');

  // Perfil do negócio: 'comercio' | 'servico' | 'ambos' | 'instituto'.
  // Controla quais itens do menu (e rotas) ficam visíveis.
  //
  // "instituto" é uma categoria própria, não um ramo de serviço: uma ONG não
  // presta serviço nem vende, ela atende. Por trás ele continua implicando
  // ramo = 'instituto', que é o que as telas já leem.
  let perfil = 'ambos';
  // Ramo de atividade (só importa quando perfil inclui 'servico'):
  // 'salao' | 'oficina' | 'geral'. Refina ainda mais o que aparece —
  // ex.: Ordens de Serviço/Pátio (foco oficina) não faz sentido num salão.
  let ramo = 'geral';
  const PERFIS = ['comercio', 'servico', 'ambos', 'instituto'];
  const rotaPerfil = {
    produtos: 'comercio', compras: 'comercio', fornecedores: 'comercio', precificacao: 'comercio', sacolas: 'comercio',
    servicos: 'servico', agenda: 'servico', ordens: 'servico', comissoes: 'servico', crm: 'servico', viagens: 'servico',
    cursos: 'servico', instrumentos: 'servico', voluntarios: 'servico', turmas: 'servico', chamada: 'servico',
    membros: 'servico', 'lista-espera': 'servico', autorizacoes: 'servico', atas: 'servico', impacto: 'servico',
  };
  // Rotas exclusivas de um ramo especifico (so aparecem alem do filtro de perfil).
  const rotaRamo = {
    crm: 'agencia_viagem', viagens: 'agencia_viagem',
    cursos: 'instituto', instrumentos: 'instituto', voluntarios: 'instituto',
    turmas: 'instituto', chamada: 'instituto', membros: 'instituto',
    'lista-espera': 'instituto', autorizacoes: 'instituto', atas: 'instituto', impacto: 'instituto',
  };
  // Num instituto sem fins lucrativos nao existe venda: o que entra e oferta,
  // e o que sai e despesa. Estes modulos saem do menu por completo.
  // O Dashboard tambem sai: ele e inteiro sobre venda, faturamento e curva ABC
  // de produto. Quem faz esse papel aqui e o panorama da tela inicial e o
  // Relatorio de impacto.
  const ESCONDIDAS_NO_INSTITUTO = ['pdv', 'vendas', 'sacolas', 'precificacao', 'comissoes', 'ordens', 'compras', 'produtos', 'catalogo', 'etiquetas', 'lote', 'dashboard', 'servicos'];

  // O instituto usa as telas de "serviço" (agenda, turmas, chamada...), então
  // conta como serviço na hora de filtrar rota por perfil.
  function perfilAtende(p) {
    if (!p) return true;
    if (perfil === 'ambos') return true;
    if (perfil === 'instituto') return p === 'servico';
    return perfil === p;
  }

  // Um instituto não compra mercadoria, mas paga fornecedor (cordas, aluguel,
  // gráfica) — e a despesa se amarra a ele. Por isso o cadastro fica visível
  // mesmo sendo, na origem, um módulo de comércio.
  const EXTRAS_NO_INSTITUTO = ['fornecedores'];

  function rotaVisivel(nome) {
    if (ramo === 'instituto' && ESCONDIDAS_NO_INSTITUTO.includes(nome)) return false;
    if (ramo === 'instituto' && EXTRAS_NO_INSTITUTO.includes(nome)) return true;
    if (nome === 'ordens' && (perfil === 'servico' || perfil === 'ambos') && (ramo === 'salao' || ramo === 'agencia_viagem' || ramo === 'professor')) return false;
    if (nome === 'agenda' && (perfil === 'servico' || perfil === 'ambos') && ramo === 'agencia_viagem') return false;
    if ((nome === 'pdv' || nome === 'vendas' || nome === 'comissoes' || nome === 'dashboard') && (perfil === 'servico' || perfil === 'ambos') && ramo === 'professor') return false;
    if (rotaRamo[nome] && ramo !== rotaRamo[nome]) return false;
    return perfilAtende(rotaPerfil[nome]);
  }

  function aplicarPerfil() {
    document.querySelectorAll('.nav-item[data-perfil]').forEach((a) => {
      a.style.display = perfilAtende(a.dataset.perfil) ? '' : 'none';
    });
    // Regras compostas (dependem tambem do ramo, nao so do perfil).
    ['ordens', 'agenda', 'crm', 'viagens', 'pdv', 'vendas', 'comissoes', 'dashboard',
      'cursos', 'instrumentos', 'voluntarios', 'turmas', 'chamada', 'membros',
      'lista-espera', 'autorizacoes', 'atas', 'impacto',
      'produtos', 'sacolas', 'precificacao', 'compras', 'fornecedores',
      'servicos', 'catalogo', 'etiquetas', 'lote'].forEach((nome) => {
      const link = document.querySelector(`.nav-item[data-rota="${nome}"]`);
      if (link) link.style.display = rotaVisivel(nome) ? '' : 'none';
    });
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

  // ----------------------- Submenus do menu lateral (sanfona: expande abaixo do titulo ao clicar) -----------------------
  function configurarSubmenus() {
    const grupos = Array.from(document.querySelectorAll('.nav-group'));

    function fecharTodos() {
      grupos.forEach((g) => g.classList.remove('nav-group--aberto'));
    }

    function alternar(grupo) {
      const jaAberto = grupo.classList.contains('nav-group--aberto');
      fecharTodos();
      if (!jaAberto) grupo.classList.add('nav-group--aberto');
    }

    grupos.forEach((grupo) => {
      const cabecalho = grupo.querySelector('.nav-group__cabecalho');
      const submenu = grupo.querySelector('.nav-submenu');

      cabecalho.addEventListener('click', () => alternar(grupo));
      cabecalho.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          alternar(grupo);
        } else if (e.key === 'Escape') {
          fecharTodos(); cabecalho.blur();
        }
      });

      submenu.querySelectorAll('.nav-item').forEach((a) => a.addEventListener('click', fecharTodos));
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.nav-group')) fecharTodos();
    });
  }

  function rotuloRota(nome, tituloPadrao) {
    if (ramo === 'instituto') {
      if (nome === 'clientes') return 'Alunos e mantenedores';
      if (nome === 'financeiro') return 'Financeiro do instituto';
      if (nome === 'inicio') return 'Panorama do instituto';
      return tituloPadrao;
    }
    if (ramo !== 'professor') return tituloPadrao;
    if (nome === 'clientes') return 'Alunos';
    if (nome === 'agenda') return 'Aulas';
    return tituloPadrao;
  }

  async function navegar() {
    const nome = rotaAtual();
    const def = rotas[nome];
    marcarMenu(nome);
    titulo().textContent = rotuloRota(nome, def.titulo);

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

  // Os lembretes agora entram no sino de avisos do topo, junto com tudo o
  // mais que precisa de atencao (instrumento nao devolvido, chamada pendente,
  // aluno sumindo...). Mantemos o nome da funcao porque outras telas chamam.
  async function atualizarAvisoLembretes() {
    if (window.Avisos) await Avisos.atualizar();
  }
  window.__atualizarAvisoLembretes = atualizarAvisoLembretes;

  // ----------------------- Onboarding / perfil do negócio -----------------------
  async function carregarPerfil() {
    let cfg = {};
    try { cfg = await API.get('/api/config'); } catch (_) { cfg = {}; }
    perfil = PERFIS.includes(cfg.perfil_negocio) ? cfg.perfil_negocio : 'ambos';
    ramo = ['salao', 'oficina', 'agencia_viagem', 'professor', 'instituto', 'geral'].includes(cfg.ramo_servico) ? cfg.ramo_servico : 'geral';
    // A categoria "instituto" define o ramo sozinha — não existe ONG de salão.
    if (perfil === 'instituto') ramo = 'instituto';
    else if (ramo === 'instituto') perfil = 'instituto';
    window.__perfilNegocio = perfil;
    window.__ramoServico = ramo;
    aplicarPerfil();
    aplicarRotulosRamo();
    aplicarAparencia(cfg);
    return cfg;
  }

  // Ajusta os rotulos do menu conforme o ramo (ex.: professor particular chama
  // "Clientes" de "Alunos" e "Agenda" de "Aulas", que fala mais perto do dia a dia).
  function aplicarRotulosRamo() {
    const clientesTxt = document.querySelector('.nav-item[data-rota="clientes"] .nav-item__texto');
    const clientesIc = document.querySelector('.nav-item[data-rota="clientes"] .nav-item__icone');
    const agendaTxt = document.querySelector('.nav-item[data-rota="agenda"] .nav-item__texto');
    if (ramo === 'instituto') {
      if (clientesTxt) clientesTxt.textContent = 'Pessoas';
      if (clientesIc) clientesIc.textContent = '🧑‍🤝‍🧑';
      if (agendaTxt) agendaTxt.textContent = 'Calendário';
    } else if (ramo === 'professor') {
      if (clientesTxt) clientesTxt.textContent = 'Alunos';
      if (clientesIc) clientesIc.textContent = '🎓';
      if (agendaTxt) agendaTxt.textContent = 'Aulas';
    } else {
      if (clientesTxt) clientesTxt.textContent = 'Clientes';
      if (clientesIc) clientesIc.textContent = '👥';
      if (agendaTxt) agendaTxt.textContent = 'Agenda';
    }
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
    root.dataset.tema = cfg.tema === 'escuro' ? 'escuro' : 'claro';

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

  /** Qual ramo gravar para cada categoria (o instituto define o seu sozinho). */
  function ramoDoPerfil(perfilEscolhido, ramoEscolhido) {
    if (perfilEscolhido === 'instituto') return 'instituto';
    if (perfilEscolhido === 'servico' || perfilEscolhido === 'ambos') return ramoEscolhido;
    return 'geral';
  }
  window.__ramoDoPerfil = ramoDoPerfil;

  function abrirOnboarding() {
    return new Promise((resolve) => {
      const corpo = `
        <p class="dica" style="margin-top:0">Bem-vindo! Vamos configurar o sistema para a sua atividade. Você pode alterar tudo depois em <strong>Configurações</strong>.</p>
        <div class="campo"><label id="ob-nome-label">Nome da empresa *</label><input id="ob-nome" placeholder="Ex.: Barbearia do João" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Telefone</label><input id="ob-tel" /></div>
          <div class="campo"><label>CNPJ / CPF</label><input id="ob-doc" /></div>
        </div>
        <div class="campo mt-16"><label>Tipo de atividade *</label>
          <div id="ob-perfil" class="ob-perfil">
            <button type="button" class="ob-opcao" data-p="comercio"><span class="ob-opcao__ic">📦</span><strong>Comércio</strong><span class="dica">Venda de produtos, estoque, compras/NF-e</span></button>
            <button type="button" class="ob-opcao" data-p="servico"><span class="ob-opcao__ic">🧰</span><strong>Serviço</strong><span class="dica">Prestação de serviços (sem estoque)</span></button>
            <button type="button" class="ob-opcao ativa" data-p="ambos"><span class="ob-opcao__ic">🧩</span><strong>Comércio e Serviço</strong><span class="dica">Os dois no mesmo sistema</span></button>
            <button type="button" class="ob-opcao" data-p="instituto"><span class="ob-opcao__ic">🎼</span><strong>Instituto / ONG</strong><span class="dica">Sem fins lucrativos: turmas, voluntários, ofertas e prestação de contas</span></button>
          </div>
        </div>
        <div class="campo mt-16" id="ob-ramo-wrap" style="display:none">
          <label>Qual o seu ramo de serviço? <span class="dica">(refina o que aparece no menu)</span></label>
          <div id="ob-ramo" class="ob-perfil">
            <button type="button" class="ob-opcao ativa" data-r="salao"><span class="ob-opcao__ic">💇</span><strong>Salão / Barbearia / Estética</strong><span class="dica">Agenda e catálogo de serviços</span></button>
            <button type="button" class="ob-opcao" data-r="oficina"><span class="ob-opcao__ic">🔧</span><strong>Oficina / Assistência técnica</strong><span class="dica">Ordens de serviço, pátio e peças</span></button>
            <button type="button" class="ob-opcao" data-r="agencia_viagem"><span class="ob-opcao__ic">✈️</span><strong>Agência de viagem</strong><span class="dica">CRM de leads e calendário de viagens</span></button>
            <button type="button" class="ob-opcao" data-r="professor"><span class="ob-opcao__ic">🎓</span><strong>Professor particular / Aulas</strong><span class="dica">Alunos, aula fixa recorrente e mensalidade</span></button>
            <button type="button" class="ob-opcao" data-r="geral"><span class="ob-opcao__ic">💼</span><strong>Outros serviços</strong><span class="dica">Consultoria, autônomo, geral</span></button>
          </div>
        </div>
        <div class="dica mt-16" id="ob-instituto-aviso" style="display:none">
          🎼 No modo Instituto o sistema não mostra venda, PDV, estoque nem lucro:
          as entradas são <strong>ofertas</strong>, as saídas são <strong>despesas</strong> e o
          resultado vira <strong>prestação de contas</strong>.
        </div>`;
      let escolha = 'ambos';
      let ramoEscolha = 'salao';
      Modal.abrir({
        titulo: 'Configuração inicial', tamanho: 'modal--grande', corpoHTML: corpo, textoConfirmar: 'Concluir',
        aoAbrir: (el) => {
          const ramoWrap = el.querySelector('#ob-ramo-wrap');
          const aviso = el.querySelector('#ob-instituto-aviso');
          const nomeLabel = el.querySelector('#ob-nome-label');
          const nomeInput = el.querySelector('#ob-nome');
          const atualizarRamoWrap = () => {
            ramoWrap.style.display = (escolha === 'servico' || escolha === 'ambos') ? '' : 'none';
            aviso.style.display = escolha === 'instituto' ? '' : 'none';
            nomeLabel.textContent = escolha === 'instituto' ? 'Nome do instituto *' : 'Nome da empresa *';
            nomeInput.placeholder = escolha === 'instituto' ? 'Ex.: Instituto Harmonia' : 'Ex.: Barbearia do João';
          };
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
          if (!nome) { UI.erro(escolha === 'instituto' ? 'Informe o nome do instituto.' : 'Informe o nome da empresa.'); return false; }
          try {
            await API.put('/api/config', {
              nome_loja: nome,
              loja_telefone: el.querySelector('#ob-tel').value,
              loja_cnpj: el.querySelector('#ob-doc').value,
              perfil_negocio: escolha,
              ramo_servico: ramoDoPerfil(escolha, ramoEscolha),
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
    configurarSubmenus();
    await window.__verificarLicenca();
    if (!location.hash) location.hash = '#/inicio';
    verificarConexao();
    if (window.Avisos) Avisos.iniciar();
    const cfg = await carregarPerfil();
    if (cfg.onboarding_ok !== '1') {
      await abrirOnboarding();
      await carregarPerfil();
    }
    navegar();
  });
})();
