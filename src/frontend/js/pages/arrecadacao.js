'use strict';

/**
 * Arrecadacao do instituto: ofertas, doacoes em especie, mantenedores,
 * projetos e a prestacao de contas do periodo.
 *
 * Aqui nao existe venda: o que entra e doacao, o que sai e despesa do
 * projeto, e o resultado nao e lucro — e saldo para prestar contas.
 */
window.PaginaArrecadacao = (function () {
  const FORMAS = [['pix', 'PIX'], ['dinheiro', 'Dinheiro'], ['transferencia', 'Transferência'],
    ['boleto', 'Boleto'], ['cartao', 'Cartão'], ['outro', 'Outro']];
  let aba = 'ofertas';
  let projetos = [];
  const hoje = () => new Date().toISOString().slice(0, 10);
  const inicioDoMes = () => hoje().slice(0, 8) + '01';
  const periodo = { de: inicioDoMes(), ate: hoje(), projeto_id: '' };

  async function render(container) {
    container.innerHTML = `
      <div class="tabs">
        <div class="tab ativo" data-aba="ofertas">🤝 Ofertas</div>
        <div class="tab" data-aba="especie">🎁 Doações em espécie</div>
        <div class="tab" data-aba="mantenedores">💚 Mantenedores</div>
        <div class="tab" data-aba="projetos">📁 Projetos</div>
        <div class="tab" data-aba="contas">📊 Prestação de contas</div>
      </div>
      <div id="ar-conteudo"></div>`;

    container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      aba = t.dataset.aba;
      container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('ativo', x === t));
      trocarAba();
    }));

    try { projetos = await API.get('/api/arrecadacao/projetos'); } catch (_) { projetos = []; }
    trocarAba();
  }

  function trocarAba() {
    if (aba === 'especie') renderEspecie();
    else if (aba === 'mantenedores') renderMantenedores();
    else if (aba === 'projetos') renderProjetos();
    else if (aba === 'contas') renderContas();
    else renderOfertas();
  }

  function barraPeriodo(idPrefixo) {
    return `
      <div class="barra-ferramentas">
        <div class="campo"><label>De</label><input type="date" id="${idPrefixo}-de" value="${periodo.de}" /></div>
        <div class="campo"><label>Até</label><input type="date" id="${idPrefixo}-ate" value="${periodo.ate}" /></div>
        <div class="campo"><label>Projeto</label>
          <select id="${idPrefixo}-projeto">
            <option value="">Todos</option>
            ${projetos.map((p) => `<option value="${p.id}" ${periodo.projeto_id == p.id ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
          </select></div>
        <div class="cresce"></div>
        <slot id="${idPrefixo}-acoes"></slot>
      </div>`;
  }

  function ligarPeriodo(prefixo, aoMudar) {
    const de = document.getElementById(`${prefixo}-de`);
    const ate = document.getElementById(`${prefixo}-ate`);
    const proj = document.getElementById(`${prefixo}-projeto`);
    if (de) de.addEventListener('change', (e) => { periodo.de = e.target.value; aoMudar(); });
    if (ate) ate.addEventListener('change', (e) => { periodo.ate = e.target.value; aoMudar(); });
    if (proj) proj.addEventListener('change', (e) => { periodo.projeto_id = e.target.value; aoMudar(); });
  }

  function query() {
    const q = new URLSearchParams();
    if (periodo.de) q.set('de', periodo.de);
    if (periodo.ate) q.set('ate', periodo.ate);
    if (periodo.projeto_id) q.set('projeto_id', periodo.projeto_id);
    return q.toString();
  }

  // ------------------------------- Ofertas -------------------------------
  async function renderOfertas() {
    const alvo = document.getElementById('ar-conteudo');
    alvo.innerHTML = barraPeriodo('of') + '<div class="card"><div id="of-lista">Carregando…</div></div>';
    document.getElementById('of-acoes').outerHTML = '<button class="btn" id="of-nova">+ Registrar oferta</button>';
    document.getElementById('of-nova').addEventListener('click', () => formOferta(null));
    ligarPeriodo('of', renderOfertas);

    let ofertas = [];
    try { ofertas = await API.get('/api/arrecadacao/ofertas?' + query()); }
    catch (e) { document.getElementById('of-lista').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    const total = ofertas.reduce((s, o) => s + Number(o.valor || 0), 0);
    document.getElementById('of-lista').innerHTML = !ofertas.length
      ? `<div class="vazio"><h3>Nenhuma oferta no período</h3><p class="dica">Registre as doações recebidas para acompanhar a arrecadação.</p></div>`
      : `<p><strong>Total do período: ${UI.moeda(total)}</strong> · ${ofertas.length} oferta(s)</p>
        <div class="rolagem"><table class="tabela">
          <thead><tr><th>Data</th><th>Doador</th><th>Valor</th><th>Forma</th><th>Projeto</th><th></th></tr></thead>
          <tbody>
            ${ofertas.map((o) => `
              <tr>
                <td>${UI.escapar(o.data)}</td>
                <td>${UI.escapar(o.mantenedor_nome || o.doador_nome || '—')}
                  ${o.recibo_emitido ? ' <span class="badge badge--muted">recibo emitido</span>' : ''}</td>
                <td>${UI.moeda(o.valor)}</td>
                <td class="dica">${UI.escapar(o.forma || '—')}</td>
                <td class="dica">${UI.escapar(o.projeto_nome || '—')}</td>
                <td style="text-align:right;white-space:nowrap">
                  <button class="btn btn--secundario" data-recibo="${o.id}">Recibo</button>
                  <button class="btn btn--secundario" data-editar="${o.id}">Editar</button>
                  <button class="btn btn--perigo" data-excluir="${o.id}">Excluir</button>
                </td>
              </tr>`).join('')}
          </tbody>
        </table></div>`;

    document.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => formOferta(ofertas.find((o) => o.id === Number(b.dataset.editar)))));
    document.querySelectorAll('[data-recibo]').forEach((b) => b.addEventListener('click', () => gerarRecibo(Number(b.dataset.recibo))));
    document.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta oferta?', { titulo: 'Excluir oferta', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/arrecadacao/ofertas/${b.dataset.excluir}`); UI.sucesso('Oferta excluída.'); renderOfertas(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formOferta(oferta) {
    const ed = !!oferta;
    Modal.abrir({
      titulo: ed ? 'Editar oferta' : 'Registrar oferta',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Doador</label>
            <input type="search" id="ofd-busca" placeholder="Buscar mantenedor cadastrado (opcional)"
              value="${ed ? UI.escapar(oferta.mantenedor_nome || '') : ''}" />
            <div id="ofd-resultados"></div>
            <input type="hidden" id="ofd-cliente" value="${ed && oferta.cliente_id ? oferta.cliente_id : ''}" />
          </div>
          <div class="campo col-2"><label>Ou nome do doador (avulso/anônimo)</label>
            <input id="ofd-nome" value="${ed ? UI.escapar(oferta.doador_nome || '') : ''}" placeholder="Ex.: Doador anônimo" /></div>
          <div class="campo"><label>Valor *</label>
            <input id="ofd-valor" type="number" step="0.01" min="0" value="${ed ? oferta.valor : ''}" /></div>
          <div class="campo"><label>Data *</label>
            <input id="ofd-data" type="date" value="${ed ? UI.escapar(oferta.data) : hoje()}" /></div>
          <div class="campo"><label>Forma</label>
            <select id="ofd-forma">
              ${FORMAS.map(([v, t]) => `<option value="${v}" ${ed && oferta.forma === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="campo"><label>Projeto</label>
            <select id="ofd-projeto">
              <option value="">Nenhum (uso geral)</option>
              ${projetos.map((p) => `<option value="${p.id}" ${ed && oferta.projeto_id === p.id ? 'selected' : ''}>${UI.escapar(p.nome)}</option>`).join('')}
            </select>
            <span class="dica">Verba carimbada: separa esta entrada na prestação de contas.</span></div>
          <div class="campo col-2"><label>Observação</label>
            <textarea id="ofd-obs" rows="2">${ed ? UI.escapar(oferta.observacao || '') : ''}</textarea></div>
        </div>`,
      aoAbrir: (el) => {
        const busca = el.querySelector('#ofd-busca');
        let timer = null;
        busca.addEventListener('input', () => {
          el.querySelector('#ofd-cliente').value = '';
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const termo = busca.value.trim();
            const alvo = el.querySelector('#ofd-resultados');
            if (!termo) { alvo.innerHTML = ''; return; }
            let pessoas = [];
            try { pessoas = await API.get('/api/clientes?busca=' + encodeURIComponent(termo)); } catch (_) { return; }
            alvo.innerHTML = pessoas.slice(0, 8).map((p) => `
              <div class="dica" style="padding:4px 0;cursor:pointer" data-pessoa="${p.id}" data-nome="${UI.escapar(p.nome)}">👤 ${UI.escapar(p.nome)}</div>`).join('');
            alvo.querySelectorAll('[data-pessoa]').forEach((d) => d.addEventListener('click', () => {
              el.querySelector('#ofd-cliente').value = d.dataset.pessoa;
              busca.value = d.dataset.nome;
              el.querySelector('#ofd-nome').value = '';
              alvo.innerHTML = '<span class="dica">✅ Mantenedor selecionado.</span>';
            }));
          }, 300);
        });
      },
      aoConfirmar: async (el) => {
        const corpo = {
          cliente_id: el.querySelector('#ofd-cliente').value || null,
          doador_nome: el.querySelector('#ofd-nome').value,
          valor: el.querySelector('#ofd-valor').value,
          data: el.querySelector('#ofd-data').value,
          forma: el.querySelector('#ofd-forma').value,
          projeto_id: el.querySelector('#ofd-projeto').value || null,
          observacao: el.querySelector('#ofd-obs').value,
        };
        try {
          if (ed) await API.put(`/api/arrecadacao/ofertas/${oferta.id}`, corpo);
          else await API.post('/api/arrecadacao/ofertas', corpo);
          UI.sucesso(ed ? 'Oferta atualizada.' : 'Oferta registrada.');
          renderOfertas();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function gerarRecibo(id) {
    let o; let cfg = {}; let assinante = null;
    try {
      [o, cfg, assinante] = await Promise.all([
        API.get(`/api/arrecadacao/ofertas/${id}`),
        API.get('/api/config').catch(() => ({})),
        API.get('/api/membros/assinante').catch(() => null),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const doador = o.mantenedor_nome || o.doador_nome || '—';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Recibo de doação</title>
      <style>
        body{font-family:Georgia,serif;padding:48px;color:#111;line-height:1.7}
        h1{font-size:20px;text-align:center;margin-bottom:4px}
        .sub{text-align:center;color:#555;font-size:13px;margin-bottom:32px}
        .valor{font-size:24px;font-weight:bold;margin:24px 0}
        .assinatura{margin-top:64px;border-top:1px solid #333;width:280px;text-align:center;padding-top:6px;font-size:13px}
      </style></head><body>
      <h1>${UI.escapar(cfg.nome_loja || 'Instituto')}</h1>
      <div class="sub">
        ${UI.escapar(cfg.loja_cnpj ? 'CNPJ: ' + cfg.loja_cnpj : '')}
        ${cfg.loja_endereco ? ' · ' + UI.escapar(cfg.loja_endereco) : ''}
      </div>
      <h2>RECIBO DE DOAÇÃO</h2>
      <div class="valor">${UI.moeda(o.valor)}</div>
      <p>Recebemos de <strong>${UI.escapar(doador)}</strong>${o.cpf ? ` (CPF/CNPJ ${UI.escapar(o.cpf)})` : ''}
      a importância de <strong>${UI.moeda(o.valor)}</strong>, a título de doação
      ${o.projeto_nome ? `destinada ao projeto <strong>${UI.escapar(o.projeto_nome)}</strong>` : 'para manutenção das atividades da instituição'},
      recebida em ${UI.escapar(o.data)}${o.forma ? ` via ${UI.escapar(o.forma)}` : ''}.</p>
      <p>Por ser expressão da verdade, firmamos o presente recibo.</p>
      <div class="assinatura">
        ${UI.escapar(assinante ? assinante.nome : (cfg.nome_loja || 'Responsável'))}
        ${assinante ? `<br><span style="font-size:11px;color:#555">${UI.escapar(assinante.cargo)}</span>` : ''}
      </div>
      </body></html>`;

    try {
      await UI.baixarPDF(html, `recibo-doacao-${id}.pdf`);
      await API.post(`/api/arrecadacao/ofertas/${id}/recibo-emitido`);
      renderOfertas();
    } catch (e) { UI.erro(e.message); }
  }

  // -------------------------- Doações em espécie --------------------------
  async function renderEspecie() {
    const alvo = document.getElementById('ar-conteudo');
    alvo.innerHTML = barraPeriodo('es') + '<div class="card"><div id="es-lista">Carregando…</div></div>';
    document.getElementById('es-acoes').outerHTML = '<button class="btn" id="es-nova">+ Registrar doação</button>';
    document.getElementById('es-nova').addEventListener('click', formEspecie);
    ligarPeriodo('es', renderEspecie);

    let itens = [];
    try { itens = await API.get('/api/arrecadacao/doacoes-especie?' + query()); }
    catch (e) { document.getElementById('es-lista').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    document.getElementById('es-lista').innerHTML = !itens.length
      ? `<div class="vazio"><h3>Nenhuma doação em espécie</h3>
          <p class="dica">Um violão doado não entra no caixa, mas precisa ser registrado — para agradecer, prestar contas e saber o que o instituto tem.</p></div>`
      : `<div class="rolagem"><table class="tabela">
          <thead><tr><th>Data</th><th>Doador</th><th>O que foi doado</th><th>Qtd.</th><th>Valor estimado</th><th></th></tr></thead>
          <tbody>
            ${itens.map((d) => `
              <tr>
                <td>${UI.escapar(d.data)}</td>
                <td>${UI.escapar(d.mantenedor_nome || d.doador_nome || '—')}</td>
                <td>${UI.escapar(d.descricao)}
                  ${d.instrumento_nome ? ` <span class="badge badge--ok">${UI.escapar(d.instrumento_nome)}</span>` : ''}</td>
                <td>${UI.escapar(String(d.quantidade))}</td>
                <td>${d.valor_estimado ? UI.moeda(d.valor_estimado) : '—'}</td>
                <td style="text-align:right"><button class="btn btn--perigo" data-rm="${d.id}">Excluir</button></td>
              </tr>`).join('')}
          </tbody>
        </table></div>`;

    document.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir este registro de doação?', { titulo: 'Excluir', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/arrecadacao/doacoes-especie/${b.dataset.rm}`); UI.sucesso('Registro excluído.'); renderEspecie(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  async function formEspecie() {
    let instrumentos = [];
    try { instrumentos = await API.get('/api/instrumentos'); } catch (_) { instrumentos = []; }

    Modal.abrir({
      titulo: 'Registrar doação em espécie',
      textoConfirmar: 'Registrar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Nome do doador *</label>
            <input id="esd-nome" placeholder="Ex.: Igreja Central" /></div>
          <div class="campo col-2"><label>O que foi doado *</label>
            <input id="esd-descricao" placeholder="Ex.: Violão infantil" /></div>
          <div class="campo"><label>Quantidade</label>
            <input id="esd-qtd" type="number" min="1" step="1" value="1" /></div>
          <div class="campo"><label>Valor estimado</label>
            <input id="esd-valor" type="number" min="0" step="0.01" placeholder="Opcional" /></div>
          <div class="campo"><label>Data *</label>
            <input id="esd-data" type="date" value="${hoje()}" /></div>
          <div class="campo"><label>Projeto</label>
            <select id="esd-projeto">
              <option value="">Nenhum</option>
              ${projetos.map((p) => `<option value="${p.id}">${UI.escapar(p.nome)}</option>`).join('')}
            </select></div>
          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:14px">
            <label>É um instrumento do acervo?</label>
            <select id="esd-instrumento">
              <option value="">Não é instrumento</option>
              ${instrumentos.map((i) => `<option value="${i.id}">${UI.escapar(i.nome)} (hoje: ${i.quantidade_total})</option>`).join('')}
            </select>
            <label class="flex gap-12 mt-16" style="align-items:center">
              <input type="checkbox" id="esd-somar" checked /> Somar ao acervo (aumenta as vagas possíveis nas turmas)
            </label>
          </div>
          <div class="campo col-2"><label>Observação</label><textarea id="esd-obs" rows="2"></textarea></div>
        </div>`,
      aoConfirmar: async (el) => {
        try {
          await API.post('/api/arrecadacao/doacoes-especie', {
            doador_nome: el.querySelector('#esd-nome').value,
            descricao: el.querySelector('#esd-descricao').value,
            quantidade: el.querySelector('#esd-qtd').value,
            valor_estimado: el.querySelector('#esd-valor').value || null,
            data: el.querySelector('#esd-data').value,
            projeto_id: el.querySelector('#esd-projeto').value || null,
            instrumento_id: el.querySelector('#esd-instrumento').value || null,
            somar_ao_acervo: el.querySelector('#esd-somar').checked,
            observacao: el.querySelector('#esd-obs').value,
          });
          UI.sucesso('Doação registrada.');
          renderEspecie();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // ----------------------------- Mantenedores -----------------------------
  async function renderMantenedores() {
    const alvo = document.getElementById('ar-conteudo');
    alvo.innerHTML = '<div class="card"><div id="mn-lista">Carregando…</div></div>';
    let lista = [];
    try { lista = await API.get('/api/arrecadacao/mantenedores'); }
    catch (e) { document.getElementById('mn-lista').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    document.getElementById('mn-lista').innerHTML = !lista.length
      ? `<div class="vazio"><h3>Nenhum mantenedor</h3>
          <p class="dica">Marque uma pessoa como "mantenedor" no cadastro de Pessoas para ela aparecer aqui.</p></div>`
      : `<div class="rolagem"><table class="tabela">
          <thead><tr><th>Mantenedor</th><th>Contribuição mensal</th><th>Total doado</th><th>Última doação</th><th>Contato</th></tr></thead>
          <tbody>
            ${lista.map((m) => `
              <tr>
                <td><strong>${UI.escapar(m.nome)}</strong></td>
                <td>${m.contribuicao_mensal
                  ? `${UI.moeda(m.contribuicao_mensal)} <span class="dica">(dia ${m.dia_vencimento})</span>`
                  : '<span class="dica">avulso</span>'}</td>
                <td>${UI.moeda(m.total_doado || 0)}</td>
                <td class="dica">${UI.escapar(m.ultima_doacao || '—')}</td>
                <td class="dica">${UI.escapar(m.telefone || m.email || '—')}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>`;
  }

  // ------------------------------- Projetos -------------------------------
  async function renderProjetos() {
    const alvo = document.getElementById('ar-conteudo');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce"><strong>Projetos</strong>
          <div class="dica">Verba carimbada: amarrar entradas e despesas a um projeto é o que torna a prestação de contas possível.</div></div>
        <button class="btn" id="pj-novo">+ Novo projeto</button>
      </div>
      <div class="card"><div id="pj-lista">Carregando…</div></div>`;

    document.getElementById('pj-novo').addEventListener('click', () => {
      Modal.abrir({
        titulo: 'Novo projeto', textoConfirmar: 'Criar',
        corpoHTML: `<div class="campo"><label>Nome *</label><input id="pj-nome" placeholder="Ex.: Projeto Música na Escola" /></div>
          <div class="campo mt-16"><label>Descrição</label><textarea id="pj-desc" rows="2"></textarea></div>`,
        aoConfirmar: async (el) => {
          try {
            await API.post('/api/arrecadacao/projetos', {
              nome: el.querySelector('#pj-nome').value,
              descricao: el.querySelector('#pj-desc').value,
            });
            projetos = await API.get('/api/arrecadacao/projetos');
            UI.sucesso('Projeto criado.');
            renderProjetos();
          } catch (e) { UI.erro(e.message); return false; }
        },
      });
    });

    let lista = [];
    try { lista = await API.get('/api/arrecadacao/projetos?incluir_inativos=1'); }
    catch (e) { document.getElementById('pj-lista').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    document.getElementById('pj-lista').innerHTML = !lista.length
      ? '<div class="vazio"><h3>Nenhum projeto</h3><p class="dica">Se a arrecadação vier de editais, cadastre cada projeto aqui.</p></div>'
      : `<div class="rolagem"><table class="tabela">
          <thead><tr><th>Projeto</th><th>Arrecadado</th><th>Gasto</th><th>Saldo</th></tr></thead>
          <tbody>
            ${lista.map((p) => {
              const saldo = Number(p.arrecadado || 0) - Number(p.gasto || 0);
              return `<tr ${p.ativo ? '' : 'style="opacity:.55"'}>
                <td><strong>${UI.escapar(p.nome)}</strong>${p.ativo ? '' : ' <span class="badge badge--muted">inativo</span>'}
                  ${p.descricao ? `<div class="dica">${UI.escapar(p.descricao)}</div>` : ''}</td>
                <td>${UI.moeda(p.arrecadado || 0)}</td>
                <td>${UI.moeda(p.gasto || 0)}</td>
                <td><span class="badge ${saldo >= 0 ? 'badge--ok' : 'badge--erro'}">${UI.moeda(saldo)}</span></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>`;
  }

  // -------------------------- Prestação de contas --------------------------
  async function renderContas() {
    const alvo = document.getElementById('ar-conteudo');
    alvo.innerHTML = barraPeriodo('pc') + '<div class="card"><div id="pc-corpo">Carregando…</div></div>';
    document.getElementById('pc-acoes').outerHTML = '<button class="btn btn--secundario" id="pc-pdf">⬇️ Baixar PDF</button>';
    ligarPeriodo('pc', renderContas);

    let d;
    try { d = await API.get('/api/arrecadacao/prestacao-de-contas?' + query()); }
    catch (e) { document.getElementById('pc-corpo').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    document.getElementById('pc-corpo').innerHTML = corpoContas(d);
    document.getElementById('pc-pdf').addEventListener('click', async () => {
      let cfg = {};
      try { cfg = await API.get('/api/config'); } catch (_) { cfg = {}; }
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Prestação de contas</title>
        <style>body{font-family:Arial,sans-serif;padding:32px;color:#111}
        h1{font-size:20px;margin-bottom:2px}h2{font-size:15px;margin-top:24px}
        table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
        th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}
        .dica{color:#666;font-size:12px}</style></head><body>
        <h1>${UI.escapar(cfg.nome_loja || 'Instituto')}</h1>
        <div class="dica">Prestação de contas${d.projeto ? ' — ' + UI.escapar(d.projeto.nome) : ''}
          · Período: ${UI.escapar(d.periodo.de || 'início')} a ${UI.escapar(d.periodo.ate || 'hoje')}</div>
        ${corpoContas(d)}</body></html>`;
      try { await UI.baixarPDF(html, 'prestacao-de-contas.pdf'); } catch (e) { UI.erro(e.message); }
    });
  }

  function corpoContas(d) {
    return `
      <div class="flex gap-12" style="flex-wrap:wrap;margin-bottom:16px">
        <div class="card" style="flex:1;min-width:180px">
          <div class="dica">Entradas (ofertas)</div>
          <h3 style="margin:4px 0">${UI.moeda(d.entradas.total)}</h3>
          <div class="dica">${d.entradas.quantidade} doação(ões)</div>
        </div>
        <div class="card" style="flex:1;min-width:180px">
          <div class="dica">Despesas</div>
          <h3 style="margin:4px 0">${UI.moeda(d.despesas.total)}</h3>
          <div class="dica">${d.despesas.quantidade} lançamento(s)</div>
        </div>
        <div class="card" style="flex:1;min-width:180px">
          <div class="dica">Saldo do período</div>
          <h3 style="margin:4px 0;color:${d.saldo >= 0 ? 'var(--sucesso)' : 'var(--perigo)'}">${UI.moeda(d.saldo)}</h3>
        </div>
        <div class="card" style="flex:1;min-width:180px">
          <div class="dica">Alcance social</div>
          <h3 style="margin:4px 0">${d.alcance.alunos_atendidos} aluno(s)</h3>
          <div class="dica">${d.alcance.aulas_realizadas} aula(s) realizada(s)</div>
        </div>
      </div>

      <h4>Entradas por forma de recebimento</h4>
      ${d.entradas.por_forma.length
        ? `<table class="tabela"><thead><tr><th>Forma</th><th>Quantidade</th><th>Total</th></tr></thead><tbody>
            ${d.entradas.por_forma.map((f) => `<tr><td>${UI.escapar(f.forma)}</td><td>${f.quantidade}</td><td>${UI.moeda(f.total)}</td></tr>`).join('')}
          </tbody></table>`
        : '<p class="dica">Nenhuma entrada no período.</p>'}

      <h4 class="mt-16">Despesas por categoria</h4>
      ${d.despesas.por_categoria.length
        ? `<table class="tabela"><thead><tr><th>Categoria</th><th>Total</th></tr></thead><tbody>
            ${d.despesas.por_categoria.map((c) => `<tr><td>${UI.escapar(c.categoria)}</td><td>${UI.moeda(c.total)}</td></tr>`).join('')}
          </tbody></table>`
        : '<p class="dica">Nenhuma despesa no período.</p>'}

      <h4 class="mt-16">Doações em espécie</h4>
      <p class="dica">${d.doacoes_especie.quantidade} doação(ões) de bens, valor estimado ${UI.moeda(d.doacoes_especie.valor_estimado || 0)}.
      Não entram no caixa — são registradas à parte.</p>`;
  }

  return { titulo: 'Arrecadação', render };
})();
