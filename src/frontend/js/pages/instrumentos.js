'use strict';

/**
 * Acervo de instrumentos. A quantidade cadastrada aqui e o que limita as
 * vagas das turmas de musica — por isso a tela mostra, para cada instrumento,
 * quantas turmas ja dependem dele.
 */
window.PaginaInstrumentos = (function () {
  let incluirInativos = false;

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Acervo de instrumentos</strong>
          <div class="dica">A quantidade aqui limita as vagas das turmas: não dá para abrir turma de violão com 12 alunos se o instituto tem 8 violões.</div>
        </div>
        <div class="campo">
          <label>Situação</label>
          <select id="ins-ativos">
            <option value="0">Somente ativos</option>
            <option value="1">Incluir inativos</option>
          </select>
        </div>
        <button class="btn" id="ins-novo">+ Novo instrumento</button>
      </div>
      <div class="card"><div id="ins-lista">Carregando…</div></div>`;

    container.querySelector('#ins-ativos').addEventListener('change', (e) => { incluirInativos = e.target.value === '1'; listar(); });
    container.querySelector('#ins-novo').addEventListener('click', () => formulario(null));
    listar();
  }

  async function listar() {
    const alvo = document.getElementById('ins-lista');
    if (!alvo) return;
    let itens = [];
    try {
      itens = await API.get('/api/instrumentos' + (incluirInativos ? '?incluir_inativos=1' : ''));
    } catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (!itens.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Nenhum instrumento cadastrado</h3>
        <p class="dica">Cadastre quantos violões, teclados e flautas o instituto tem. Depois, ao criar uma turma, o sistema já avisa quantas vagas cabem.</p></div>`;
      return;
    }

    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Instrumento</th><th>Quantidade</th><th>Turmas usando</th><th>Observação</th><th></th></tr></thead>
        <tbody>
          ${itens.map((i) => `
            <tr ${i.ativo ? '' : 'style="opacity:.55"'}>
              <td><strong>${UI.escapar(i.nome)}</strong>${i.ativo ? '' : ' <span class="badge badge--muted">inativo</span>'}</td>
              <td><span class="badge ${i.quantidade_total > 0 ? 'badge--ok' : 'badge--alerta'}">${i.quantidade_total}</span></td>
              <td>${i.turmas_usando || 0}</td>
              <td class="dica">${UI.escapar(i.observacao || '—')}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-editar="${i.id}">Editar</button>
                <button class="btn btn--perigo" data-excluir="${i.id}">Excluir</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
      formulario(itens.find((i) => i.id === Number(b.dataset.editar)));
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', () => excluir(Number(b.dataset.excluir))));
  }

  function formulario(inst) {
    const ed = !!inst;
    Modal.abrir({
      titulo: ed ? 'Editar instrumento' : 'Novo instrumento',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo"><label>Nome *</label>
            <input id="in-nome" value="${ed ? UI.escapar(inst.nome) : ''}" placeholder="Ex.: Violão" /></div>
          <div class="campo"><label>Quantidade total *</label>
            <input id="in-qtd" type="number" min="0" step="1" value="${ed ? inst.quantidade_total : ''}" placeholder="Ex.: 8" />
            <span class="dica">Quantos o instituto tem hoje.</span></div>
          <div class="campo col-2"><label>Observação</label>
            <textarea id="in-obs" rows="2" placeholder="Ex.: 2 precisam de troca de cordas">${ed ? UI.escapar(inst.observacao || '') : ''}</textarea></div>
          ${ed ? `<div class="campo col-2"><label class="flex gap-12" style="align-items:center">
            <input type="checkbox" id="in-ativo" ${inst.ativo ? 'checked' : ''} /> Instrumento ativo
          </label></div>` : ''}
        </div>`,
      aoConfirmar: async (el) => {
        const corpo = {
          nome: el.querySelector('#in-nome').value,
          quantidade_total: el.querySelector('#in-qtd').value,
          observacao: el.querySelector('#in-obs').value,
        };
        if (ed) corpo.ativo = el.querySelector('#in-ativo').checked;
        try {
          if (ed) await API.put(`/api/instrumentos/${inst.id}`, corpo);
          else await API.post('/api/instrumentos', corpo);
          UI.sucesso(ed ? 'Instrumento atualizado.' : 'Instrumento cadastrado.');
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function excluir(id) {
    const ok = await UI.confirmar('Excluir este instrumento do acervo?', { titulo: 'Excluir instrumento', textoConfirmar: 'Excluir' });
    if (!ok) return;
    try {
      await API.del(`/api/instrumentos/${id}`);
      UI.sucesso('Instrumento excluído.');
      listar();
    } catch (e) { UI.erro(e.message); }
  }

  return { titulo: 'Instrumentos', render };
})();
