'use strict';

/**
 * Pagina de Compras: importacao de NF-e (XML) em dois passos (preview ->
 * confirmacao, completando produtos novos) e historico de notas importadas.
 */
window.PaginaCompras = (function () {
  let categorias = [];

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Importar nota fiscal</strong>
          <div class="dica">Selecione o arquivo XML da NF-e de compra para dar entrada no estoque.</div>
        </div>
        <input type="file" id="xml-file" accept=".xml,text/xml,application/xml" style="display:none" />
        <button class="btn" id="btn-importar">📥 Importar NF-e (XML)</button>
      </div>
      <div class="card">
        <h3 style="margin-top:0">Notas importadas</h3>
        <div id="lista-compras">Carregando…</div>
      </div>
    `;

    categorias = await API.get('/api/categorias').catch(() => []);

    const input = container.querySelector('#xml-file');
    container.querySelector('#btn-importar').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      if (!input.files.length) return;
      await importar(input.files[0]);
      input.value = '';
    });

    await listar();
  }

  async function listar() {
    const alvo = document.getElementById('lista-compras');
    if (!alvo) return;
    let compras;
    try { compras = await API.get('/api/compras'); }
    catch (e) { alvo.innerHTML = `<span class="badge badge--erro">Erro</span> ${UI.escapar(e.message)}`; return; }

    if (!compras.length) { alvo.innerHTML = '<p class="muted">Nenhuma nota importada ainda.</p>'; return; }

    alvo.innerHTML = `<table class="tabela">
      <thead><tr><th>NF</th><th>Fornecedor</th><th>Emissão</th><th>Itens</th><th>Valor</th><th></th></tr></thead>
      <tbody>${compras.map((c) => `<tr>
        <td>${UI.escapar(c.numero_nf || '—')}</td>
        <td>${UI.escapar(c.fornecedor_nome || '—')}</td>
        <td>${c.data_emissao ? UI.dataHora(c.data_emissao) : '—'}</td>
        <td>${c.total_itens}</td>
        <td>${UI.moeda(c.valor_total)}</td>
        <td style="text-align:right"><button class="btn btn--secundario" data-ver="${c.id}">Ver itens</button></td>
      </tr>`).join('')}</tbody></table>`;

    alvo.querySelectorAll('[data-ver]').forEach((b) => b.addEventListener('click', () => verCompra(Number(b.dataset.ver))));
  }

  async function importar(arquivo) {
    UI.toast('Lendo XML…', 'info');
    const fd = new FormData();
    fd.append('xml', arquivo);
    let preview;
    try {
      const resp = await fetch('/api/compras/importar-xml', { method: 'POST', body: fd });
      const txt = await resp.text();
      preview = txt ? JSON.parse(txt) : null;
      if (!resp.ok) throw new Error((preview && preview.erro) || 'Falha ao ler o XML.');
    } catch (e) { UI.erro(e.message); return; }
    abrirPreview(preview);
  }

  function abrirPreview(prev) {
    const optCategorias = (sel) => '<option value="">— categoria —</option>' +
      categorias.map((c) => `<option value="${c.id}" ${String(sel) === String(c.id) ? 'selected' : ''}>${UI.escapar(c.nome)}</option>`).join('');

    const linhas = prev.itens.map((it, idx) => {
      if (it.produto_existente) {
        return `<tr data-idx="${idx}" data-tipo="existente">
          <td>${UI.escapar(it.descricao)}<div class="dica">EAN: ${UI.escapar(it.ean || '—')}</div></td>
          <td>${UI.numero(it.quantidade)} ${UI.escapar(it.unidade)}</td>
          <td>${UI.moeda(it.valor_unitario)}</td>
          <td colspan="2"><span class="badge badge--ok">Vinculado</span> ${UI.escapar(it.produto_existente.nome)}
            <div class="dica">Estoque atual: ${UI.numero(it.produto_existente.estoque_atual)} → atualiza custo e soma entrada</div></td>
        </tr>`;
      }
      return `<tr data-idx="${idx}" data-tipo="novo">
        <td>
          <span class="badge badge--alerta">Produto novo</span>
          <div class="dica">NF: ${UI.escapar(it.descricao)} | EAN: ${UI.escapar(it.ean || '—')}</div>
          <input class="mt-16" style="width:100%" data-campo="nome" value="${UI.escapar(it.descricao)}" placeholder="Nome do produto *" />
        </td>
        <td>${UI.numero(it.quantidade)} ${UI.escapar(it.unidade)}</td>
        <td>${UI.moeda(it.valor_unitario)}</td>
        <td><select data-campo="categoria_id">${optCategorias('')}</select></td>
        <td>
          <input type="number" step="0.01" min="0" data-campo="preco_venda" placeholder="Preço venda" style="width:110px" />
          <div class="dica">ou markup %<input type="number" step="0.01" min="0" data-campo="markup" style="width:70px" placeholder="ex: 50"></div>
        </td>
      </tr>`;
    }).join('');

    const corpo = `
      <div class="card mb-16" style="background:#f8fafc">
        <div class="flex flex--between">
          <div><strong>${UI.escapar(prev.fornecedor.nome)}</strong>
            <div class="dica">CNPJ: ${UI.escapar(prev.fornecedor.cnpj || '—')} ${prev.fornecedor_existente ? '· fornecedor já cadastrado' : '· será cadastrado'}</div></div>
          <div style="text-align:right">
            <div>NF ${UI.escapar(prev.numero_nf || '—')}</div>
            <div class="stat__value" style="font-size:20px">${UI.moeda(prev.valor_total)}</div>
          </div>
        </div>
      </div>
      <table class="tabela">
        <thead><tr><th>Produto</th><th>Qtd</th><th>Custo unit.</th><th>Categoria</th><th>Preço venda</th></tr></thead>
        <tbody>${linhas}</tbody>
      </table>
      <div class="card mt-16">
        <label class="flex gap-12" style="align-items:center">
          <input type="checkbox" id="cp-gerar" /> Gerar conta a pagar desta nota
        </label>
        <div class="campo mt-16" id="cp-venc-wrap" style="display:none;max-width:220px">
          <label>Vencimento</label>
          <input type="date" id="cp-venc" />
        </div>
      </div>`;

    Modal.abrir({
      titulo: 'Conferir importação da NF-e',
      tamanho: 'modal--grande',
      corpoHTML: corpo,
      textoConfirmar: 'Confirmar importação',
      aoAbrir: (el) => {
        const chk = el.querySelector('#cp-gerar');
        chk.addEventListener('change', () => {
          el.querySelector('#cp-venc-wrap').style.display = chk.checked ? '' : 'none';
        });
      },
      aoConfirmar: async (el) => {
        // monta itens
        const itens = [];
        for (const tr of el.querySelectorAll('tbody tr')) {
          const idx = Number(tr.dataset.idx);
          const base = prev.itens[idx];
          if (tr.dataset.tipo === 'existente') {
            itens.push({ ...base, produto_id: base.produto_existente.id });
          } else {
            const nome = tr.querySelector('[data-campo="nome"]').value.trim();
            if (!nome) { UI.erro('Informe o nome de todos os produtos novos.'); return false; }
            itens.push({
              ...base,
              novo: {
                nome,
                categoria_id: tr.querySelector('[data-campo="categoria_id"]').value || null,
                preco_venda: tr.querySelector('[data-campo="preco_venda"]').value || null,
                markup: tr.querySelector('[data-campo="markup"]').value || null,
              },
            });
          }
        }
        const gerar = el.querySelector('#cp-gerar').checked;
        const payload = {
          xml_path: prev.xml_path, chave: prev.chave, numero_nf: prev.numero_nf,
          data_emissao: prev.data_emissao, valor_total: prev.valor_total,
          fornecedor: prev.fornecedor_existente ? { id: prev.fornecedor_existente.id, ...prev.fornecedor } : prev.fornecedor,
          itens,
          gerar_conta_pagar: gerar,
          vencimento: gerar ? (el.querySelector('#cp-venc').value || null) : null,
        };
        try {
          await API.post('/api/compras/confirmar', payload);
          UI.sucesso('Nota importada e estoque atualizado.');
          await listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function verCompra(id) {
    let c;
    try { c = await API.get(`/api/compras/${id}`); } catch (e) { UI.erro(e.message); return; }
    const corpo = `
      <div class="mb-16"><strong>${UI.escapar(c.fornecedor_nome || '—')}</strong>
        <div class="dica">NF ${UI.escapar(c.numero_nf || '—')} · Emissão ${c.data_emissao ? UI.dataHora(c.data_emissao) : '—'} · Importada ${UI.dataHora(c.data_importacao)}</div></div>
      <table class="tabela">
        <thead><tr><th>Produto</th><th>NCM</th><th>Qtd</th><th>Custo unit.</th><th>Total</th></tr></thead>
        <tbody>${c.itens.map((i) => `<tr>
          <td>${UI.escapar(i.produto_nome || i.descricao_nf || '—')}</td>
          <td>${UI.escapar(i.ncm || '—')}</td>
          <td>${UI.numero(i.quantidade)}</td>
          <td>${UI.moeda(i.valor_unitario)}</td>
          <td>${UI.moeda(i.valor_total)}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><th colspan="4" style="text-align:right">Total da nota</th><th>${UI.moeda(c.valor_total)}</th></tr></tfoot>
      </table>`;
    Modal.abrir({ titulo: 'Itens da nota', tamanho: 'modal--grande', corpoHTML: corpo, mostrarConfirmar: false });
  }

  return { titulo: 'Compras', render };
})();
