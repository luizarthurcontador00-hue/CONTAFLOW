'use strict';

/**
 * Voluntarios e instrutores do instituto. Alem do cadastro, guarda em que
 * dias/horarios cada pessoa pode ajudar — saber quem cobre qual horario e
 * metade da gestao de uma equipe voluntaria.
 */
window.PaginaVoluntarios = (function () {
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  let filtroTipo = '';

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Equipe do instituto</strong>
          <div class="dica">Voluntários e contratados. A disponibilidade informada aqui ajuda a escalar quem fica em cada turma.</div>
        </div>
        <div class="campo">
          <label>Tipo</label>
          <select id="vol-tipo">
            <option value="">Todos</option>
            <option value="voluntario">Somente voluntários</option>
            <option value="contratado">Somente contratados</option>
          </select>
        </div>
        <button class="btn btn--secundario" id="vol-horas">⏱️ Horas de voluntariado</button>
        <button class="btn" id="vol-novo">+ Nova pessoa</button>
      </div>
      <div class="card"><div id="vol-lista">Carregando…</div></div>`;

    container.querySelector('#vol-tipo').addEventListener('change', (e) => { filtroTipo = e.target.value; listar(); });
    container.querySelector('#vol-novo').addEventListener('click', () => formulario(null));
    container.querySelector('#vol-horas').addEventListener('click', horasVoluntariado);
    listar();
  }

  async function listar() {
    const alvo = document.getElementById('vol-lista');
    if (!alvo) return;
    let pessoas = [];
    try { pessoas = await API.get('/api/agenda/profissionais'); }
    catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (filtroTipo) pessoas = pessoas.filter((p) => (p.tipo || 'contratado') === filtroTipo);

    if (!pessoas.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Ninguém cadastrado ainda</h3>
        <p class="dica">Cadastre os voluntários que dão aula no instituto.</p></div>`;
      return;
    }

    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Nome</th><th>Tipo</th><th>Contato</th><th></th></tr></thead>
        <tbody>
          ${pessoas.map((p) => `
            <tr>
              <td>
                <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${UI.escapar(p.cor || '#2563eb')};margin-right:6px"></span>
                <strong>${UI.escapar(p.nome)}</strong>
              </td>
              <td>${p.tipo === 'voluntario' ? '<span class="badge badge--ok">Voluntário</span>' : '<span class="badge badge--muted">Contratado</span>'}</td>
              <td class="dica">${UI.escapar(p.telefone || p.email || '—')}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-ver="${p.id}">Ver</button>
                <button class="btn btn--secundario" data-editar="${p.id}">Editar</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => {
      try { formulario(await API.get(`/api/agenda/profissionais/${b.dataset.editar}`)); }
      catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', async () => {
      try { detalhe(await API.get(`/api/agenda/profissionais/${b.dataset.ver}`)); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function detalhe(p) {
    Modal.abrir({
      titulo: p.nome,
      mostrarConfirmar: false,
      corpoHTML: `
        <p class="dica" style="margin-top:0">
          ${p.tipo === 'voluntario' ? '🙋 Voluntário' : 'Contratado'}
          ${p.documento ? ' · Documento: ' + UI.escapar(p.documento) : ''}
          ${p.telefone ? ' · ' + UI.escapar(p.telefone) : ''}
          ${p.email ? ' · ' + UI.escapar(p.email) : ''}
        </p>

        <h4>Disponibilidade</h4>
        ${p.disponibilidade && p.disponibilidade.length
          ? `<ul>${p.disponibilidade.map((d) => `<li>${DIAS[d.dia_semana]}, ${UI.escapar(d.hora_inicio)} às ${UI.escapar(d.hora_fim)}</li>`).join('')}</ul>`
          : '<p class="dica">Nenhuma disponibilidade informada.</p>'}

        <h4 class="mt-16">Turmas em que atua</h4>
        ${p.turmas && p.turmas.length
          ? `<ul>${p.turmas.map((t) => `<li>${UI.escapar(t.curso_nome)} — ${UI.escapar(t.nome)} <span class="badge badge--muted">${UI.escapar(t.papel)}</span></li>`).join('')}</ul>`
          : '<p class="dica">Ainda não está em nenhuma turma aberta.</p>'}

        ${p.observacao ? `<h4 class="mt-16">Observação</h4><p class="dica">${UI.escapar(p.observacao)}</p>` : ''}`,
    });
  }

  function formulario(pessoa) {
    const ed = !!pessoa;
    const faixas = (ed && pessoa.disponibilidade) ? pessoa.disponibilidade.slice() : [];

    Modal.abrir({
      titulo: ed ? 'Editar pessoa' : 'Nova pessoa',
      tamanho: 'modal--grande',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Nome *</label>
            <input id="vo-nome" value="${ed ? UI.escapar(pessoa.nome) : ''}" /></div>
          <div class="campo"><label>Tipo</label>
            <select id="vo-tipo">
              <option value="voluntario" ${ed && pessoa.tipo === 'voluntario' ? 'selected' : ''}>Voluntário</option>
              <option value="contratado" ${ed && pessoa.tipo !== 'voluntario' ? 'selected' : ''}>Contratado</option>
            </select></div>
          <div class="campo"><label>Telefone</label>
            <input id="vo-telefone" value="${ed ? UI.escapar(pessoa.telefone || '') : ''}" /></div>
          <div class="campo"><label>E-mail</label>
            <input id="vo-email" value="${ed ? UI.escapar(pessoa.email || '') : ''}" /></div>
          <div class="campo"><label>Documento</label>
            <input id="vo-documento" value="${ed ? UI.escapar(pessoa.documento || '') : ''}" placeholder="CPF ou RG" />
            <span class="dica">Aparece na declaração de horas de voluntariado.</span></div>
          <div class="campo"><label>Cor na agenda</label>
            <input type="color" id="vo-cor" value="${ed ? UI.escapar(pessoa.cor || '#2563eb') : '#2563eb'}" style="width:80px;height:38px;padding:2px" /></div>
          <div class="campo col-2"><label>Observação</label>
            <textarea id="vo-obs" rows="2">${ed ? UI.escapar(pessoa.observacao || '') : ''}</textarea></div>

          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:14px">
            <label>Disponibilidade</label>
            <span class="dica">Em que dias e horários esta pessoa pode ajudar.</span>
            <div id="vo-faixas" class="mt-16"></div>
            <button class="btn btn--secundario mt-16" type="button" id="vo-add-faixa">+ Adicionar horário</button>
          </div>
        </div>`,
      aoAbrir: (el) => {
        function desenhar() {
          const alvo = el.querySelector('#vo-faixas');
          if (!faixas.length) {
            alvo.innerHTML = '<p class="dica">Nenhum horário informado.</p>';
            return;
          }
          alvo.innerHTML = faixas.map((f, i) => `
            <div class="flex gap-12 mt-16" style="align-items:center;flex-wrap:wrap">
              <select data-dia="${i}" style="max-width:150px">
                ${DIAS.map((d, n) => `<option value="${n}" ${Number(f.dia_semana) === n ? 'selected' : ''}>${d}</option>`).join('')}
              </select>
              <input type="time" data-ini="${i}" value="${UI.escapar(f.hora_inicio || '')}" style="max-width:120px" />
              <span class="dica">às</span>
              <input type="time" data-fim="${i}" value="${UI.escapar(f.hora_fim || '')}" style="max-width:120px" />
              <button class="btn btn--perigo" type="button" data-remover="${i}">Remover</button>
            </div>`).join('');

          alvo.querySelectorAll('[data-dia]').forEach((s) => s.addEventListener('change', () => { faixas[Number(s.dataset.dia)].dia_semana = Number(s.value); }));
          alvo.querySelectorAll('[data-ini]').forEach((s) => s.addEventListener('change', () => { faixas[Number(s.dataset.ini)].hora_inicio = s.value; }));
          alvo.querySelectorAll('[data-fim]').forEach((s) => s.addEventListener('change', () => { faixas[Number(s.dataset.fim)].hora_fim = s.value; }));
          alvo.querySelectorAll('[data-remover]').forEach((b) => b.addEventListener('click', () => { faixas.splice(Number(b.dataset.remover), 1); desenhar(); }));
        }

        el.querySelector('#vo-add-faixa').addEventListener('click', () => {
          faixas.push({ dia_semana: 1, hora_inicio: '19:00', hora_fim: '20:00' });
          desenhar();
        });
        desenhar();
      },
      aoConfirmar: async (el) => {
        const corpo = {
          nome: el.querySelector('#vo-nome').value,
          tipo: el.querySelector('#vo-tipo').value,
          telefone: el.querySelector('#vo-telefone').value,
          email: el.querySelector('#vo-email').value,
          documento: el.querySelector('#vo-documento').value,
          cor: el.querySelector('#vo-cor').value,
          observacao: el.querySelector('#vo-obs').value,
          disponibilidade: faixas,
        };
        try {
          if (ed) await API.put(`/api/agenda/profissionais/${pessoa.id}`, corpo);
          else await API.post('/api/agenda/profissionais', corpo);
          UI.sucesso(ed ? 'Cadastro atualizado.' : 'Pessoa cadastrada.');
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  /**
   * Horas doadas por cada voluntario no periodo, com a declaracao em PDF que
   * eles costumam precisar (faculdade, empresa, comprovacao de horas).
   */
  async function horasVoluntariado() {
    const hoje = new Date().toISOString().slice(0, 10);
    const inicioAno = hoje.slice(0, 4) + '-01-01';

    Modal.abrir({
      titulo: 'Horas de voluntariado',
      tamanho: 'modal--grande',
      mostrarConfirmar: false,
      corpoHTML: `
        <div class="barra-ferramentas">
          <div class="campo"><label>De</label><input type="date" id="hv-de" value="${inicioAno}" /></div>
          <div class="campo"><label>Até</label><input type="date" id="hv-ate" value="${hoje}" /></div>
        </div>
        <div id="hv-lista" class="mt-16">Carregando…</div>`,
      aoAbrir: (el) => {
        async function carregar() {
          const de = el.querySelector('#hv-de').value;
          const ate = el.querySelector('#hv-ate').value;
          const alvo = el.querySelector('#hv-lista');
          let dados = [];
          try {
            dados = await API.get(`/api/turmas/horas-voluntariado?de=${de}&ate=${ate}`);
          } catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

          alvo.innerHTML = !dados.length
            ? '<p class="dica">Nenhuma aula realizada no período. As horas contam a partir das chamadas registradas.</p>'
            : `<div class="rolagem"><table class="tabela">
                <thead><tr><th>Voluntário</th><th>Aulas dadas</th><th>Horas</th><th></th></tr></thead>
                <tbody>
                  ${dados.map((d, i) => `
                    <tr>
                      <td>${UI.escapar(d.nome)}${d.tipo === 'voluntario' ? ' <span class="badge badge--ok">voluntário</span>' : ''}</td>
                      <td>${d.aulas_dadas}</td>
                      <td><strong>${UI.escapar(String(d.horas || 0))}h</strong></td>
                      <td style="text-align:right">
                        <button class="btn btn--secundario" data-decl="${i}">📄 Declaração</button>
                      </td>
                    </tr>`).join('')}
                </tbody>
              </table></div>`;

          alvo.querySelectorAll('[data-decl]').forEach((b) => b.addEventListener('click', () => {
            declaracao(dados[Number(b.dataset.decl)], de, ate);
          }));
        }
        el.querySelector('#hv-de').addEventListener('change', carregar);
        el.querySelector('#hv-ate').addEventListener('change', carregar);
        carregar();
      },
    });
  }

  async function declaracao(pessoa, de, ate) {
    let cfg = {}; let assinante = null;
    try {
      [cfg, assinante] = await Promise.all([
        API.get('/api/config').catch(() => ({})),
        API.get('/api/membros/assinante').catch(() => null),
      ]);
    } catch (_) { cfg = {}; }
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Declaração de voluntariado</title>
      <style>
        body{font-family:Georgia,serif;padding:56px;color:#111;line-height:1.9}
        h1{font-size:19px;text-align:center;margin-bottom:2px}
        .sub{text-align:center;color:#555;font-size:12px;margin-bottom:40px}
        h2{font-size:16px;text-align:center;margin:28px 0}
        .assinatura{margin-top:72px;border-top:1px solid #333;width:300px;text-align:center;padding-top:6px;font-size:12px;margin-left:auto;margin-right:auto}
      </style></head><body>
      <h1>${UI.escapar(cfg.nome_loja || 'Instituto')}</h1>
      <div class="sub">
        ${cfg.loja_cnpj ? 'CNPJ: ' + UI.escapar(cfg.loja_cnpj) : ''}
        ${cfg.loja_endereco ? ' · ' + UI.escapar(cfg.loja_endereco) : ''}
      </div>
      <h2>DECLARAÇÃO DE TRABALHO VOLUNTÁRIO</h2>
      <p>Declaramos, para os devidos fins, que <strong>${UI.escapar(pessoa.nome)}</strong>${pessoa.documento ? `, portador(a) do documento ${UI.escapar(pessoa.documento)},` : ''}
      prestou serviço voluntário nesta instituição no período de ${UI.escapar(de)} a ${UI.escapar(ate)},
      tendo ministrado <strong>${pessoa.aulas_dadas} aula(s)</strong>, totalizando
      <strong>${UI.escapar(String(pessoa.horas || 0))} hora(s)</strong> de atividade.</p>
      <p>O trabalho voluntário aqui declarado não gera vínculo empregatício nem obrigação de natureza
      trabalhista, previdenciária ou afim, nos termos da Lei nº 9.608/1998.</p>
      <p>Por ser expressão da verdade, firmamos a presente declaração.</p>
      <div class="assinatura">
        ${UI.escapar(assinante ? assinante.nome : (cfg.nome_loja || 'Responsável pela instituição'))}
        ${assinante ? `<br><span style="font-size:11px;color:#555">${UI.escapar(assinante.cargo)}</span>` : ''}
      </div>
      </body></html>`;

    try { await UI.baixarPDF(html, `declaracao-voluntariado-${pessoa.nome.replace(/\s+/g, '-').toLowerCase()}.pdf`); }
    catch (e) { UI.erro(e.message); }
  }

  return { titulo: 'Voluntários', render };
})();
