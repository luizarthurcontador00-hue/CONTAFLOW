'use strict';

/**
 * Pagina de Clientes: cadastro, busca, saldo devedor (fiado) e detalhe com
 * historico de compras e contas a receber. Para o ramo "professor" (aulas
 * particulares), a mesma tela e os mesmos dados aparecem como "Alunos".
 */
window.PaginaClientes = (function () {
  const ehProfessor = () => window.__ramoServico === 'professor';
  const rotulo = (maiusc) => (ehProfessor() ? (maiusc ? 'Aluno' : 'aluno') : (maiusc ? 'Cliente' : 'cliente'));

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <input type="search" id="cl-busca" class="cresce" placeholder="Buscar por nome, CPF ou telefone…" />
        <button class="btn" id="cl-novo">+ Novo ${rotulo()}</button>
      </div>
      <div class="card"><div id="cl-lista">Carregando…</div></div>`;
    container.querySelector('#cl-busca').addEventListener('input', debounce(listar, 250));
    container.querySelector('#cl-novo').addEventListener('click', () => formCliente());
    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('cl-lista');
    if (!alvo) return;
    const busca = document.getElementById('cl-busca').value;
    let clientes;
    try { clientes = await API.get('/api/clientes' + (busca ? '?busca=' + encodeURIComponent(busca) : '')); }
    catch (e) { alvo.innerHTML = UI.escapar(e.message); return; }
    if (!clientes.length) { alvo.innerHTML = `<p class="muted">Nenhum ${rotulo()} cadastrado.</p>`; return; }
    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>Nome</th><th>Telefone</th><th>CPF</th><th>Deve (fiado)</th><th></th></tr></thead>
      <tbody>${clientes.map((c) => `<tr>
        <td>${UI.escapar(c.nome)}</td><td>${UI.escapar(c.telefone || '—')}</td><td>${UI.escapar(c.cpf || '—')}</td>
        <td>${Number(c.saldo_devedor) > 0 ? `<span class="badge badge--alerta">${UI.moeda(c.saldo_devedor)}</span>` : '<span class="muted">—</span>'}</td>
        <td style="text-align:right"><button class="btn btn--secundario" data-ver="${c.id}">Ver</button></td>
      </tr>`).join('')}</tbody></table>`;
    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => detalhe(Number(b.dataset.ver))));
  }

  function formCliente(cliente) {
    const c = cliente || {};
    const ed = !!cliente;
    Modal.abrir({
      titulo: ed ? `Editar ${rotulo()}` : `Novo ${rotulo()}`, tamanho: 'modal--grande',
      corpoHTML: `<form id="fc" class="form-grid">
        <div class="campo col-2"><label>Nome *</label><input name="nome" value="${UI.escapar(c.nome || '')}" required /></div>
        <div class="campo"><label>Telefone</label><input name="telefone" value="${UI.escapar(c.telefone || '')}" /></div>
        <div class="campo"><label>CPF</label><input name="cpf" value="${UI.escapar(c.cpf || '')}" /></div>
        <div class="campo"><label>E-mail</label><input name="email" type="email" value="${UI.escapar(c.email || '')}" /></div>
        <div class="campo"><label>Limite de crédito (fiado) R$</label><input name="limite_credito" type="number" step="0.01" min="0" value="${c.limite_credito != null ? c.limite_credito : 0}" /></div>
        <div class="campo col-2"><label>Endereço</label><input name="endereco" value="${UI.escapar(c.endereco || '')}" /></div>
        <div class="campo col-2"><label>Observação</label><textarea name="observacao">${UI.escapar(c.observacao || '')}</textarea></div>
      </form>`,
      textoConfirmar: 'Salvar',
      aoConfirmar: async (el) => {
        const f = el.querySelector('#fc');
        if (!f.nome.value.trim()) { UI.erro('Informe o nome.'); return false; }
        const body = Object.fromEntries(new FormData(f).entries());
        try {
          if (ed) await API.put('/api/clientes/' + cliente.id, body);
          else await API.post('/api/clientes', body);
          UI.sucesso(`${rotulo(true)} salvo.`); await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function detalhe(id) {
    let c;
    try { c = await API.get('/api/clientes/' + id); } catch (e) { UI.erro(e.message); return; }
    const corpo = `
      <div class="grid grid--cards mb-16">
        <div class="card stat"><span class="stat__label">Deve (fiado)</span><span class="stat__value" style="font-size:22px;color:${Number(c.saldo_devedor) > 0 ? 'var(--alerta)' : 'var(--sucesso)'}">${UI.moeda(c.saldo_devedor)}</span></div>
        <div class="card stat"><span class="stat__label">Limite de crédito</span><span class="stat__value" style="font-size:22px">${UI.moeda(c.limite_credito)}</span></div>
        <div class="card stat"><span class="stat__label">Compras</span><span class="stat__value" style="font-size:22px">${c.compras.length}</span></div>
      </div>
      <table class="tabela mb-16">
        <tr><th>Telefone</th><td>${UI.escapar(c.telefone || '—')}</td><th>CPF</th><td>${UI.escapar(c.cpf || '—')}</td></tr>
        <tr><th>E-mail</th><td>${UI.escapar(c.email || '—')}</td><th>Endereço</th><td>${UI.escapar(c.endereco || '—')}</td></tr>
      </table>
      <h3>Contas a receber (fiado)</h3>
      ${c.contas.length ? `<table class="tabela"><thead><tr><th>Descrição</th><th>Venc.</th><th>Valor</th><th>Situação</th></tr></thead>
        <tbody>${c.contas.map((ct) => `<tr><td>${UI.escapar(ct.descricao)}</td><td>${ct.vencimento || '—'}</td><td>${UI.moeda(ct.valor)}</td>
          <td>${ct.status === 'pendente' ? '<span class="badge badge--alerta">Pendente</span>' : ct.status === 'recebido' ? '<span class="badge badge--ok">Recebido</span>' : '<span class="badge badge--muted">Cancelada</span>'}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Nenhuma conta.</p>'}
      <h3 class="mt-16">Últimas compras</h3>
      ${c.compras.length ? `<table class="tabela"><thead><tr><th>#</th><th>Data</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${c.compras.map((v) => `<tr><td>${v.id}</td><td>${UI.dataHora(v.data)}</td><td>${UI.moeda(v.valor_total)}</td><td>${v.status}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted">Nenhuma compra.</p>'}`;

    Modal.abrir({
      titulo: c.nome, tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false,
      aoAbrir: (el) => {
        const foot = el.querySelector('.modal__foot');
        const bEdit = document.createElement('button');
        bEdit.className = 'btn'; bEdit.textContent = 'Editar';
        bEdit.addEventListener('click', () => { el.remove(); formCliente(c); });
        const bDel = document.createElement('button');
        bDel.className = 'btn btn--perigo'; bDel.textContent = 'Excluir';
        bDel.addEventListener('click', async () => {
          const ok = await UI.confirmar(`Excluir o ${rotulo()} "${c.nome}"? Se tiver histórico, será apenas inativado.`, { titulo: `Excluir ${rotulo()}`, textoConfirmar: 'Excluir' });
          if (!ok) return;
          try { const r = await API.del('/api/clientes/' + c.id); UI.sucesso(r.inativado ? `${rotulo(true)} inativado.` : `${rotulo(true)} excluído.`); el.remove(); await listar(); }
          catch (e) { UI.erro(e.message); }
        });
        foot.insertBefore(bDel, foot.firstChild);
        foot.insertBefore(bEdit, foot.firstChild);
      },
    });
  }

  function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  return { titulo: 'Clientes', render };
})();
