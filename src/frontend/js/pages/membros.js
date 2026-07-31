'use strict';

/**
 * Diretoria e equipe administrativa do instituto: presidente, tesoureiro,
 * secretario, conselho fiscal.
 *
 * O mandato importa: em entidade sem fins lucrativos o cargo tem prazo, e
 * quem assina recibo e declaracao muda quando a diretoria troca.
 */
window.PaginaMembros = (function () {
  const CARGOS = [
    ['presidente', 'Presidente'],
    ['vice_presidente', 'Vice-presidente'],
    ['tesoureiro', 'Tesoureiro(a)'],
    ['vice_tesoureiro', 'Vice-tesoureiro(a)'],
    ['secretario', 'Secretário(a)'],
    ['vice_secretario', 'Vice-secretário(a)'],
    ['conselho_fiscal', 'Conselho fiscal'],
    ['diretor', 'Diretor(a)'],
    ['coordenador', 'Coordenador(a)'],
    ['outro', 'Outro'],
  ];
  let incluirInativos = false;

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Diretoria e administração</strong>
          <div class="dica">Quem responde pelo instituto. Quem estiver marcado para assinar aparece nos recibos de doação e nas declarações de voluntariado.</div>
        </div>
        <div class="campo"><label>Situação</label>
          <select id="mb-ativos">
            <option value="0">Somente ativos</option>
            <option value="1">Incluir inativos</option>
          </select></div>
        <button class="btn" id="mb-novo">+ Novo membro</button>
      </div>
      <div class="card"><div id="mb-lista">Carregando…</div></div>`;

    container.querySelector('#mb-ativos').addEventListener('change', (e) => { incluirInativos = e.target.value === '1'; listar(); });
    container.querySelector('#mb-novo').addEventListener('click', () => formulario(null));
    listar();
  }

  async function listar() {
    const alvo = document.getElementById('mb-lista');
    if (!alvo) return;
    let membros = [];
    try { membros = await API.get('/api/membros' + (incluirInativos ? '?incluir_inativos=1' : '')); }
    catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (!membros.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Nenhum membro cadastrado</h3>
        <p class="dica">Cadastre presidente, tesoureiro e demais responsáveis pelo instituto.</p></div>`;
      return;
    }

    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Nome</th><th>Cargo</th><th>Mandato</th><th>Contato</th><th></th></tr></thead>
        <tbody>
          ${membros.map((m) => `
            <tr ${m.ativo ? '' : 'style="opacity:.55"'}>
              <td><strong>${UI.escapar(m.nome)}</strong>
                ${m.assina_documentos ? ' <span class="badge badge--ok">assina documentos</span>' : ''}
                ${m.ativo ? '' : ' <span class="badge badge--muted">inativo</span>'}
                ${m.documento ? `<div class="dica">Doc.: ${UI.escapar(m.documento)}</div>` : ''}</td>
              <td>${UI.escapar(m.cargo_rotulo || m.cargo)}</td>
              <td class="dica">
                ${m.mandato_inicio ? UI.escapar(m.mandato_inicio) : '—'}
                ${m.mandato_fim ? ' até ' + UI.escapar(m.mandato_fim) : ''}
                ${m.mandato_vencido ? ' <span class="badge badge--erro">vencido</span>' : ''}
              </td>
              <td class="dica">${UI.escapar(m.telefone || m.email || '—')}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-editar="${m.id}">Editar</button>
                <button class="btn btn--perigo" data-excluir="${m.id}">Excluir</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
      formulario(membros.find((m) => m.id === Number(b.dataset.editar)));
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir este membro da diretoria?', { titulo: 'Excluir membro', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/membros/${b.dataset.excluir}`); UI.sucesso('Membro excluído.'); listar(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formulario(membro) {
    const ed = !!membro;
    Modal.abrir({
      titulo: ed ? 'Editar membro' : 'Novo membro da diretoria',
      tamanho: 'modal--grande',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Nome *</label>
            <input id="mf-nome" value="${ed ? UI.escapar(membro.nome) : ''}" /></div>
          <div class="campo"><label>Cargo</label>
            <select id="mf-cargo">
              ${CARGOS.map(([v, t]) => `<option value="${v}" ${ed && membro.cargo === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="campo"><label>Documento</label>
            <input id="mf-doc" value="${ed ? UI.escapar(membro.documento || '') : ''}" placeholder="CPF" /></div>
          <div class="campo"><label>Telefone</label>
            <input id="mf-tel" value="${ed ? UI.escapar(membro.telefone || '') : ''}" /></div>
          <div class="campo"><label>E-mail</label>
            <input id="mf-email" value="${ed ? UI.escapar(membro.email || '') : ''}" /></div>
          <div class="campo"><label>Início do mandato</label>
            <input type="date" id="mf-ini" value="${ed ? UI.escapar(membro.mandato_inicio || '') : ''}" /></div>
          <div class="campo"><label>Fim do mandato</label>
            <input type="date" id="mf-fim" value="${ed ? UI.escapar(membro.mandato_fim || '') : ''}" />
            <span class="dica">Deixe vazio se não houver prazo definido.</span></div>
          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:14px">
            <label class="flex gap-12" style="align-items:center">
              <input type="checkbox" id="mf-assina" ${ed && membro.assina_documentos ? 'checked' : ''} />
              Assina os documentos do instituto
            </label>
            <span class="dica">O nome e o cargo aparecem na assinatura dos recibos de doação e das declarações de voluntariado. Mandato vencido deixa de assinar automaticamente.</span>
          </div>
          <div class="campo col-2"><label>Observação</label>
            <textarea id="mf-obs" rows="2">${ed ? UI.escapar(membro.observacao || '') : ''}</textarea></div>
          ${ed ? `<div class="campo col-2"><label class="flex gap-12" style="align-items:center">
            <input type="checkbox" id="mf-ativo" ${membro.ativo ? 'checked' : ''} /> Membro ativo
          </label></div>` : ''}
        </div>`,
      aoAbrir: (el) => UI.ligarMascaraDocumento(el.querySelector('#mf-doc')),
      aoConfirmar: async (el) => {
        const corpo = {
          nome: el.querySelector('#mf-nome').value,
          cargo: el.querySelector('#mf-cargo').value,
          documento: el.querySelector('#mf-doc').value,
          telefone: el.querySelector('#mf-tel').value,
          email: el.querySelector('#mf-email').value,
          mandato_inicio: el.querySelector('#mf-ini').value,
          mandato_fim: el.querySelector('#mf-fim').value,
          assina_documentos: el.querySelector('#mf-assina').checked,
          observacao: el.querySelector('#mf-obs').value,
        };
        if (ed) corpo.ativo = el.querySelector('#mf-ativo').checked;
        try {
          if (ed) await API.put(`/api/membros/${membro.id}`, corpo);
          else await API.post('/api/membros', corpo);
          UI.sucesso(ed ? 'Membro atualizado.' : 'Membro cadastrado.');
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  return { titulo: 'Diretoria', render };
})();
