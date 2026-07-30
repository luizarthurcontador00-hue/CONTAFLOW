'use strict';

/**
 * Acervo de instrumentos. A quantidade cadastrada aqui e o que limita as
 * vagas das turmas de musica — por isso a tela mostra, para cada instrumento,
 * quantas turmas ja dependem dele.
 */
window.PaginaInstrumentos = (function () {
  let incluirInativos = false;
  let aba = 'acervo';
  const ESTADOS = {
    disponivel: ['Disponível', 'ok'], emprestado: ['Emprestado', 'alerta'],
    manutencao: ['Manutenção', 'alerta'], baixado: ['Baixado', 'muted'],
  };

  async function render(container) {
    container.innerHTML = `
      <div class="tabs">
        <div class="tab ativo" data-aba="acervo">🎸 Acervo</div>
        <div class="tab" data-aba="emprestimos">📤 Empréstimos</div>
      </div>
      <div id="ins-conteudo"></div>`;

    container.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
      aba = t.dataset.aba;
      container.querySelectorAll('.tab').forEach((x) => x.classList.toggle('ativo', x === t));
      trocarAba();
    }));
    trocarAba();
  }

  function trocarAba() {
    if (aba === 'emprestimos') renderEmprestimos();
    else renderAcervo();
  }

  function renderAcervo() {
    const alvo = document.getElementById('ins-conteudo');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Acervo de instrumentos</strong>
          <div class="dica">A quantidade aqui limita quantos alunos podem usar instrumento do instituto numa turma. Instrumento emprestado ou em manutenção sai da conta, e aluno com instrumento próprio não ocupa vaga do acervo.</div>
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

    alvo.querySelector('#ins-ativos').addEventListener('change', (e) => { incluirInativos = e.target.value === '1'; listar(); });
    alvo.querySelector('#ins-novo').addEventListener('click', () => formulario(null));
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
        <thead><tr>
          <th>Instrumento</th><th>No instituto</th><th>Total</th><th>Emprestados</th>
          <th>Manutenção</th><th>Turmas</th><th></th>
        </tr></thead>
        <tbody>
          ${itens.map((i) => `
            <tr ${i.ativo ? '' : 'style="opacity:.55"'}>
              <td><strong>${UI.escapar(i.nome)}</strong>${i.ativo ? '' : ' <span class="badge badge--muted">inativo</span>'}
                ${i.observacao ? `<div class="dica">${UI.escapar(i.observacao)}</div>` : ''}</td>
              <td><span class="badge ${i.disponivel_para_turmas > 0 ? 'badge--ok' : 'badge--alerta'}">${i.disponivel_para_turmas}</span>
                <div class="dica">disponíveis p/ aula</div></td>
              <td>${i.quantidade_total}</td>
              <td>${i.emprestados || 0}</td>
              <td>${i.fora_de_uso || 0}</td>
              <td>${i.turmas_usando || 0}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-unidades="${i.id}">Unidades</button>
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
    alvo.querySelectorAll('[data-unidades]').forEach((b) => b.addEventListener('click', () => {
      verUnidades(itens.find((i) => i.id === Number(b.dataset.unidades)));
    }));
  }

  // ---------------------- Unidades (patrimônio) ----------------------
  async function verUnidades(instrumento) {
    Modal.abrir({
      titulo: `Unidades — ${instrumento.nome}`,
      tamanho: 'modal--grande',
      mostrarConfirmar: false,
      corpoHTML: `
        <p class="dica" style="margin-top:0">Cadastre as unidades para poder emprestar um instrumento específico ("violão nº 3 está com a Ana") e saber onde cada um está.</p>
        <div class="flex gap-12" style="flex-wrap:wrap">
          <button class="btn btn--secundario" type="button" id="un-nova">+ Adicionar unidade</button>
          <button class="btn btn--secundario" type="button" id="un-gerar">Gerar numeradas (01, 02…)</button>
        </div>
        <div id="un-lista" class="mt-16">Carregando…</div>`,
      aoAbrir: (el) => {
        async function carregar() {
          const alvo = el.querySelector('#un-lista');
          let unidades = [];
          try { unidades = await API.get(`/api/instrumentos/${instrumento.id}/unidades`); }
          catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

          alvo.innerHTML = !unidades.length
            ? '<p class="dica">Nenhuma unidade cadastrada. Sem unidades você ainda controla a quantidade, mas não consegue emprestar.</p>'
            : `<div class="rolagem"><table class="tabela">
                <thead><tr><th>Nº</th><th>Estado</th><th>Com quem está</th><th>Observação</th><th></th></tr></thead>
                <tbody>
                  ${unidades.map((u) => {
                    const [rot, cor] = ESTADOS[u.estado] || [u.estado, 'muted'];
                    return `<tr>
                      <td><strong>${UI.escapar(u.numero)}</strong></td>
                      <td><span class="badge badge--${cor}">${rot}</span></td>
                      <td class="dica">${u.aluno_nome ? UI.escapar(u.aluno_nome) + (u.previsao_devolucao ? ` <br>devolver até ${UI.escapar(u.previsao_devolucao)}` : '') : '—'}</td>
                      <td class="dica">${UI.escapar(u.observacao || '—')}</td>
                      <td style="text-align:right;white-space:nowrap">
                        ${u.estado === 'disponivel' ? `<button class="btn btn--secundario" data-emprestar="${u.id}">Emprestar</button>` : ''}
                        ${u.estado === 'emprestado' ? `<button class="btn" data-devolver="${u.emprestimo_id}">Devolver</button>` : ''}
                        ${u.estado === 'manutencao' ? `<button class="btn btn--secundario" data-liberar="${u.id}">Liberar</button>` : ''}
                        ${u.estado !== 'emprestado' ? `<button class="btn btn--perigo" data-rm="${u.id}">Excluir</button>` : ''}
                      </td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table></div>`;

          alvo.querySelectorAll('[data-emprestar]').forEach((b) => b.addEventListener('click', () => formEmprestimo(Number(b.dataset.emprestar), instrumento, carregar)));
          alvo.querySelectorAll('[data-devolver]').forEach((b) => b.addEventListener('click', () => formDevolucao(Number(b.dataset.devolver), carregar)));
          alvo.querySelectorAll('[data-liberar]').forEach((b) => b.addEventListener('click', async () => {
            try { await API.put(`/api/instrumentos/unidades/${b.dataset.liberar}`, { estado: 'disponivel' }); UI.sucesso('Unidade liberada.'); carregar(); listar(); }
            catch (e) { UI.erro(e.message); }
          }));
          alvo.querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', async () => {
            const okc = await UI.confirmar('Excluir esta unidade?', { titulo: 'Excluir unidade', textoConfirmar: 'Excluir' });
            if (!okc) return;
            try {
              const r = await API.del(`/api/instrumentos/unidades/${b.dataset.rm}`);
              UI.sucesso(r.baixado ? 'A unidade já teve empréstimos e foi baixada, preservando o histórico.' : 'Unidade excluída.');
              carregar(); listar();
            } catch (e) { UI.erro(e.message); }
          }));
        }

        el.querySelector('#un-nova').addEventListener('click', () => {
          Modal.abrir({
            titulo: 'Nova unidade', textoConfirmar: 'Adicionar',
            corpoHTML: `<div class="campo"><label>Número / identificação *</label>
                <input id="unv-num" placeholder="Ex.: 05 ou tombo 1234" /></div>
              <div class="campo mt-16"><label>Observação</label><input id="unv-obs" placeholder="Ex.: doado pela Igreja Central" /></div>`,
            aoConfirmar: async (e2) => {
              try {
                await API.post(`/api/instrumentos/${instrumento.id}/unidades`, {
                  numero: e2.querySelector('#unv-num').value,
                  observacao: e2.querySelector('#unv-obs').value,
                });
                UI.sucesso('Unidade adicionada.'); carregar(); listar();
              } catch (er) { UI.erro(er.message); return false; }
            },
          });
        });

        el.querySelector('#un-gerar').addEventListener('click', () => {
          Modal.abrir({
            titulo: 'Gerar unidades numeradas', textoConfirmar: 'Gerar',
            corpoHTML: `<div class="campo"><label>Quantas unidades?</label>
                <input id="ung-qtd" type="number" min="1" step="1" value="${instrumento.quantidade_total || 1}" />
                <span class="dica">Cria 01, 02, 03… pulando os números que já existem.</span></div>`,
            aoConfirmar: async (e2) => {
              try {
                const r = await API.post(`/api/instrumentos/${instrumento.id}/unidades/gerar`, { quantidade: e2.querySelector('#ung-qtd').value });
                UI.sucesso(`${r.criadas} unidade(s) criada(s).`); carregar(); listar();
              } catch (er) { UI.erro(er.message); return false; }
            },
          });
        });

        carregar();
      },
    });
  }

  function formEmprestimo(unidadeId, instrumento, aoSalvar) {
    const hoje = new Date().toISOString().slice(0, 10);
    Modal.abrir({
      titulo: 'Emprestar instrumento',
      textoConfirmar: 'Registrar empréstimo',
      corpoHTML: `
        <div class="campo"><label>Aluno *</label>
          <input type="search" id="em-busca" placeholder="Buscar aluno pelo nome" />
          <div id="em-resultados" class="mt-16"><p class="dica">Digite para buscar.</p></div>
          <input type="hidden" id="em-aluno" /></div>
        <div class="form-grid mt-16">
          <div class="campo"><label>Data do empréstimo</label><input type="date" id="em-data" value="${hoje}" /></div>
          <div class="campo"><label>Previsão de devolução</label><input type="date" id="em-previsao" />
            <span class="dica">Usada para avisar de atraso.</span></div>
          <div class="campo col-2"><label>Estado na saída</label>
            <textarea id="em-obs" rows="2" placeholder="Ex.: com capa, cordas novas"></textarea></div>
        </div>`,
      aoAbrir: (el) => {
        const busca = el.querySelector('#em-busca');
        let timer = null;
        busca.addEventListener('input', () => {
          el.querySelector('#em-aluno').value = '';
          clearTimeout(timer);
          timer = setTimeout(async () => {
            const termo = busca.value.trim();
            const alvo = el.querySelector('#em-resultados');
            if (!termo) { alvo.innerHTML = '<p class="dica">Digite para buscar.</p>'; return; }
            let pessoas = [];
            try { pessoas = await API.get('/api/clientes?busca=' + encodeURIComponent(termo)); } catch (_) { return; }
            alvo.innerHTML = pessoas.slice(0, 10).map((p) => `
              <label class="flex gap-12" style="align-items:center;padding:5px 0;cursor:pointer">
                <input type="radio" name="em-al" value="${p.id}" />
                <span>${UI.escapar(p.nome)}</span>
              </label>`).join('') || '<p class="dica">Nenhum aluno encontrado.</p>';
            alvo.querySelectorAll('input[name="em-al"]').forEach((r) => r.addEventListener('change', () => {
              el.querySelector('#em-aluno').value = r.value;
            }));
          }, 300);
        });
      },
      aoConfirmar: async (el) => {
        const aluno = el.querySelector('#em-aluno').value;
        if (!aluno) { UI.erro('Selecione o aluno que vai levar o instrumento.'); return false; }
        try {
          await API.post('/api/instrumentos/emprestimos', {
            unidade_id: unidadeId, aluno_id: aluno,
            data_emprestimo: el.querySelector('#em-data').value,
            previsao_devolucao: el.querySelector('#em-previsao').value,
            observacao_saida: el.querySelector('#em-obs').value,
          });
          UI.sucesso('Empréstimo registrado.');
          if (aoSalvar) aoSalvar();
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  function formDevolucao(emprestimoId, aoSalvar) {
    const hoje = new Date().toISOString().slice(0, 10);
    Modal.abrir({
      titulo: 'Registrar devolução',
      textoConfirmar: 'Confirmar devolução',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Data da devolução</label><input type="date" id="dv-data" value="${hoje}" /></div>
          <div class="campo col-2"><label>Estado na volta</label>
            <textarea id="dv-obs" rows="2" placeholder="Ex.: corda arrebentada"></textarea></div>
          <div class="campo col-2"><label class="flex gap-12" style="align-items:center">
            <input type="checkbox" id="dv-manutencao" /> Voltou precisando de manutenção
          </label>
          <span class="dica">Marcado, o instrumento fica fora do acervo de aula até ser liberado.</span></div>
        </div>`,
      aoConfirmar: async (el) => {
        try {
          await API.post(`/api/instrumentos/emprestimos/${emprestimoId}/devolver`, {
            data_devolucao: el.querySelector('#dv-data').value,
            observacao_retorno: el.querySelector('#dv-obs').value,
            para_manutencao: el.querySelector('#dv-manutencao').checked,
          });
          UI.sucesso('Devolução registrada.');
          if (aoSalvar) aoSalvar();
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  // -------------------------- Empréstimos --------------------------
  async function renderEmprestimos() {
    const alvo = document.getElementById('ins-conteudo');
    alvo.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce"><strong>Instrumentos emprestados</strong>
          <div class="dica">Quem está com cada instrumento e quando deve devolver.</div></div>
        <div class="campo"><label>Mostrar</label>
          <select id="ep-filtro">
            <option value="1">Somente em aberto</option>
            <option value="">Todo o histórico</option>
          </select></div>
      </div>
      <div class="card"><div id="ep-lista">Carregando…</div></div>`;

    async function carregar() {
      const abertos = alvo.querySelector('#ep-filtro').value;
      let lista = [];
      try { lista = await API.get('/api/instrumentos/emprestimos' + (abertos ? '?abertos=1' : '')); }
      catch (e) { alvo.querySelector('#ep-lista').innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

      const atrasados = lista.filter((e) => e.atrasado).length;
      alvo.querySelector('#ep-lista').innerHTML = !lista.length
        ? '<div class="vazio"><h3>Nenhum empréstimo</h3><p class="dica">Empreste um instrumento pela aba Acervo → Unidades.</p></div>'
        : `${atrasados ? `<p><span class="badge badge--erro">${atrasados} em atraso</span></p>` : ''}
          <div class="rolagem"><table class="tabela">
            <thead><tr><th>Instrumento</th><th>Com quem</th><th>Saída</th><th>Devolver até</th><th>Situação</th><th></th></tr></thead>
            <tbody>
              ${lista.map((e) => `
                <tr>
                  <td><strong>${UI.escapar(e.instrumento_nome)} nº ${UI.escapar(e.numero)}</strong></td>
                  <td>${UI.escapar(e.aluno_nome)}
                    <div class="dica">${UI.escapar(e.responsavel_telefone || e.aluno_telefone || '')}</div></td>
                  <td class="dica">${UI.escapar(e.data_emprestimo)}</td>
                  <td class="dica">${UI.escapar(e.previsao_devolucao || '—')}</td>
                  <td>${e.data_devolucao
                    ? `<span class="badge badge--muted">devolvido ${UI.escapar(e.data_devolucao)}</span>`
                    : (e.atrasado ? '<span class="badge badge--erro">atrasado</span>' : '<span class="badge badge--alerta">em aberto</span>')}</td>
                  <td style="text-align:right">
                    ${e.data_devolucao ? '' : `<button class="btn" data-dev="${e.id}">Devolver</button>`}
                  </td>
                </tr>`).join('')}
            </tbody>
          </table></div>`;

      alvo.querySelectorAll('[data-dev]').forEach((b) => b.addEventListener('click', () => formDevolucao(Number(b.dataset.dev), carregar)));
    }

    alvo.querySelector('#ep-filtro').addEventListener('change', carregar);
    carregar();
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
