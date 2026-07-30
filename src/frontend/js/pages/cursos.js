'use strict';

/**
 * Cursos / modalidades do instituto (Violão, Teclado, Informática, Reforço).
 * O curso e o molde; quem tem dia, hora e alunos e a turma.
 */
window.PaginaCursos = (function () {
  const CATEGORIAS = [
    ['musica', '🎵 Música'],
    ['informatica', '💻 Informática'],
    ['reforco', '📖 Reforço escolar'],
    ['outro', '✨ Outro'],
  ];
  const filtro = { categoria: '', incluir_inativos: false };

  function rotuloCategoria(c) {
    const achou = CATEGORIAS.find(([v]) => v === c);
    return achou ? achou[1] : c;
  }

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="campo">
          <label>Categoria</label>
          <select id="cur-categoria">
            <option value="">Todas</option>
            ${CATEGORIAS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
          </select>
        </div>
        <div class="campo">
          <label>Situação</label>
          <select id="cur-ativos">
            <option value="0">Somente ativos</option>
            <option value="1">Incluir inativos</option>
          </select>
        </div>
        <div class="cresce"></div>
        <button class="btn" id="cur-novo">+ Novo curso</button>
      </div>
      <div class="card"><div id="cur-lista">Carregando…</div></div>`;

    container.querySelector('#cur-categoria').addEventListener('change', (e) => { filtro.categoria = e.target.value; listar(); });
    container.querySelector('#cur-ativos').addEventListener('change', (e) => { filtro.incluir_inativos = e.target.value === '1'; listar(); });
    container.querySelector('#cur-novo').addEventListener('click', () => formulario(null));

    listar();
  }

  async function listar() {
    const alvo = document.getElementById('cur-lista');
    if (!alvo) return;
    let cursos = [];
    try {
      const q = new URLSearchParams();
      if (filtro.categoria) q.set('categoria', filtro.categoria);
      if (filtro.incluir_inativos) q.set('incluir_inativos', '1');
      cursos = await API.get('/api/cursos?' + q.toString());
    } catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (!cursos.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Nenhum curso cadastrado</h3>
        <p class="dica">Cadastre as modalidades que o instituto oferece — depois cada uma vira uma ou mais turmas.</p></div>`;
      return;
    }

    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr>
          <th>Curso</th><th>Categoria</th><th>Carga horária</th><th>Turmas abertas</th><th></th>
        </tr></thead>
        <tbody>
          ${cursos.map((c) => `
            <tr ${c.ativo ? '' : 'style="opacity:.55"'}>
              <td>
                <strong>${UI.escapar(c.nome)}</strong>
                ${c.ativo ? '' : ' <span class="badge badge--muted">inativo</span>'}
                ${c.descricao ? `<div class="dica">${UI.escapar(c.descricao)}</div>` : ''}
              </td>
              <td>${rotuloCategoria(c.categoria)}</td>
              <td>${c.carga_horaria ? UI.escapar(String(c.carga_horaria)) + 'h' : '—'}</td>
              <td>${c.turmas_abertas || 0}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-editar="${c.id}">Editar</button>
                <button class="btn btn--perigo" data-excluir="${c.id}">Excluir</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', () => {
      formulario(cursos.find((c) => c.id === Number(b.dataset.editar)));
    }));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', () => excluir(Number(b.dataset.excluir))));
  }

  function formulario(curso) {
    const ed = !!curso;
    Modal.abrir({
      titulo: ed ? 'Editar curso' : 'Novo curso',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Nome do curso *</label>
            <input id="cu-nome" value="${ed ? UI.escapar(curso.nome) : ''}" placeholder="Ex.: Violão Iniciante" /></div>
          <div class="campo"><label>Categoria</label>
            <select id="cu-categoria">
              ${CATEGORIAS.map(([v, t]) => `<option value="${v}" ${ed && curso.categoria === v ? 'selected' : ''}>${t}</option>`).join('')}
            </select></div>
          <div class="campo"><label>Carga horária (horas)</label>
            <input id="cu-carga" type="number" min="0" step="1" value="${ed && curso.carga_horaria != null ? curso.carga_horaria : ''}" placeholder="Ex.: 40" />
            <span class="dica">Usada no certificado de conclusão.</span></div>
          <div class="campo col-2"><label>Descrição</label>
            <textarea id="cu-descricao" rows="2" placeholder="O que o aluno aprende neste curso">${ed ? UI.escapar(curso.descricao || '') : ''}</textarea></div>
          ${ed ? `<div class="campo col-2"><label class="flex gap-12" style="align-items:center">
            <input type="checkbox" id="cu-ativo" ${curso.ativo ? 'checked' : ''} /> Curso ativo
          </label></div>` : ''}
        </div>`,
      aoConfirmar: async (el) => {
        const corpo = {
          nome: el.querySelector('#cu-nome').value,
          categoria: el.querySelector('#cu-categoria').value,
          carga_horaria: el.querySelector('#cu-carga').value,
          descricao: el.querySelector('#cu-descricao').value,
        };
        if (ed) corpo.ativo = el.querySelector('#cu-ativo').checked;
        try {
          if (ed) await API.put(`/api/cursos/${curso.id}`, corpo);
          else await API.post('/api/cursos', corpo);
          UI.sucesso(ed ? 'Curso atualizado.' : 'Curso cadastrado.');
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function excluir(id) {
    const ok = await UI.confirmar('Excluir este curso?', { titulo: 'Excluir curso', textoConfirmar: 'Excluir' });
    if (!ok) return;
    try {
      const r = await API.del(`/api/cursos/${id}`);
      UI.sucesso(r.desativado
        ? `O curso tem ${r.turmas} turma(s) e foi apenas desativado, para preservar o histórico.`
        : 'Curso excluído.');
      listar();
    } catch (e) { UI.erro(e.message); }
  }

  return { titulo: 'Cursos', render };
})();
