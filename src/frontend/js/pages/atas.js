'use strict';

/**
 * Atas de reunião da diretoria. Associação precisa registrar o que foi
 * deliberado — e a ata guarda o NOME de quem participou, para continuar
 * íntegra mesmo se a pessoa sair da diretoria depois.
 */
window.PaginaAtas = (function () {
  let membros = [];

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Atas de reunião</strong>
          <div class="dica">Registro das reuniões e do que foi deliberado. Pode ser gerado em PDF para assinatura e arquivo.</div>
        </div>
        <button class="btn" id="at-nova">+ Nova ata</button>
      </div>
      <div class="card"><div id="at-lista">Carregando…</div></div>`;

    try { membros = await API.get('/api/membros'); } catch (_) { membros = []; }
    container.querySelector('#at-nova').addEventListener('click', () => formulario(null));
    listar();
  }

  async function listar() {
    const alvo = document.getElementById('at-lista');
    if (!alvo) return;
    let atas = [];
    try { atas = await API.get('/api/instituto/atas'); }
    catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (!atas.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Nenhuma ata registrada</h3>
        <p class="dica">Registre as reuniões da diretoria: pauta, participantes e deliberações.</p></div>`;
      return;
    }

    alvo.innerHTML = `
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Reunião</th><th>Data</th><th>Local</th><th>Presentes</th><th></th></tr></thead>
        <tbody>
          ${atas.map((a) => `
            <tr>
              <td><strong>${UI.escapar(a.titulo)}</strong></td>
              <td>${UI.escapar(a.data)}${a.hora ? ' ' + UI.escapar(a.hora) : ''}</td>
              <td class="dica">${UI.escapar(a.local || '—')}</td>
              <td>${a.presentes || 0}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-pdf="${a.id}">📄 PDF</button>
                <button class="btn btn--secundario" data-editar="${a.id}">Editar</button>
                <button class="btn btn--perigo" data-excluir="${a.id}">Excluir</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-editar]').forEach((b) => b.addEventListener('click', async () => {
      try { formulario(await API.get(`/api/instituto/atas/${b.dataset.editar}`)); }
      catch (e) { UI.erro(e.message); }
    }));
    alvo.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', () => gerarPdf(Number(b.dataset.pdf))));
    alvo.querySelectorAll('[data-excluir]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await UI.confirmar('Excluir esta ata?', { titulo: 'Excluir ata', textoConfirmar: 'Excluir' });
      if (!ok) return;
      try { await API.del(`/api/instituto/atas/${b.dataset.excluir}`); UI.sucesso('Ata excluída.'); listar(); }
      catch (e) { UI.erro(e.message); }
    }));
  }

  function formulario(ata) {
    const ed = !!ata;
    const presentes = new Set((ed ? ata.participantes : []).filter((p) => p.presente && p.membro_id).map((p) => p.membro_id));
    const extras = (ed ? ata.participantes : []).filter((p) => !p.membro_id).map((p) => p.nome);

    Modal.abrir({
      titulo: ed ? 'Editar ata' : 'Nova ata',
      tamanho: 'modal--grande',
      textoConfirmar: 'Salvar',
      corpoHTML: `
        <div class="form-grid">
          <div class="campo col-2"><label>Título da reunião *</label>
            <input id="af-titulo" value="${ed ? UI.escapar(ata.titulo) : ''}" placeholder="Ex.: Reunião ordinária de agosto" /></div>
          <div class="campo"><label>Data *</label>
            <input type="date" id="af-data" value="${ed ? UI.escapar(ata.data) : new Date().toISOString().slice(0, 10)}" /></div>
          <div class="campo"><label>Hora</label>
            <input type="time" id="af-hora" value="${ed ? UI.escapar(ata.hora || '') : ''}" /></div>
          <div class="campo col-2"><label>Local</label>
            <input id="af-local" value="${ed ? UI.escapar(ata.local || '') : ''}" placeholder="Ex.: Sede do instituto" /></div>
          <div class="campo col-2"><label>Pauta</label>
            <textarea id="af-pauta" rows="3">${ed ? UI.escapar(ata.pauta || '') : ''}</textarea></div>
          <div class="campo col-2"><label>Deliberações</label>
            <textarea id="af-delib" rows="4" placeholder="O que ficou decidido na reunião">${ed ? UI.escapar(ata.deliberacoes || '') : ''}</textarea></div>
          <div class="campo col-2" style="border-top:1px solid var(--borda);padding-top:14px">
            <label>Participantes da diretoria</label>
            ${membros.length
              ? membros.map((m) => `
                <label class="flex gap-12" style="align-items:center;padding:4px 0;cursor:pointer">
                  <input type="checkbox" class="af-membro" value="${m.id}" data-nome="${UI.escapar(m.nome)}" ${presentes.has(m.id) ? 'checked' : ''} />
                  <span>${UI.escapar(m.nome)} <span class="dica">${UI.escapar(m.cargo_rotulo || '')}</span></span>
                </label>`).join('')
              : '<span class="dica">Nenhum membro cadastrado em Diretoria.</span>'}
          </div>
          <div class="campo col-2"><label>Outros participantes</label>
            <textarea id="af-extras" rows="2" placeholder="Um nome por linha (convidados, voluntários)">${UI.escapar(extras.join('\n'))}</textarea></div>
          <div class="campo col-2"><label>Observação</label>
            <textarea id="af-obs" rows="2">${ed ? UI.escapar(ata.observacao || '') : ''}</textarea></div>
        </div>`,
      aoConfirmar: async (el) => {
        const participantes = Array.from(el.querySelectorAll('.af-membro:checked'))
          .map((c) => ({ membro_id: Number(c.value), nome: c.dataset.nome, presente: true }));
        el.querySelector('#af-extras').value.split('\n').map((n) => n.trim()).filter(Boolean)
          .forEach((nome) => participantes.push({ nome, presente: true }));

        const corpo = {
          titulo: el.querySelector('#af-titulo').value,
          data: el.querySelector('#af-data').value,
          hora: el.querySelector('#af-hora').value,
          local: el.querySelector('#af-local').value,
          pauta: el.querySelector('#af-pauta').value,
          deliberacoes: el.querySelector('#af-delib').value,
          observacao: el.querySelector('#af-obs').value,
          participantes,
        };
        try {
          if (ed) await API.put(`/api/instituto/atas/${ata.id}`, corpo);
          else await API.post('/api/instituto/atas', corpo);
          UI.sucesso(ed ? 'Ata atualizada.' : 'Ata registrada.');
          listar();
        } catch (e) { UI.erro(e.message); return false; }
      },
    });
  }

  async function gerarPdf(id) {
    let ata; let cfg = {}; let assinante = null;
    try {
      [ata, cfg, assinante] = await Promise.all([
        API.get(`/api/instituto/atas/${id}`),
        API.get('/api/config').catch(() => ({})),
        API.get('/api/membros/assinante').catch(() => null),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${UI.escapar(ata.titulo)}</title>
      <style>
        body{font-family:Georgia,serif;padding:48px;color:#111;line-height:1.8}
        h1{font-size:18px;text-align:center;margin-bottom:2px}
        .sub{text-align:center;color:#555;font-size:12px;margin-bottom:32px}
        h2{font-size:16px;margin:24px 0 8px}
        h3{font-size:14px;margin:20px 0 6px}
        ul{margin:6px 0}
        .texto{white-space:pre-wrap}
        .assinatura{margin-top:64px;border-top:1px solid #333;width:300px;text-align:center;padding-top:6px;font-size:12px;margin-left:auto;margin-right:auto}
      </style></head><body>
      <h1>${UI.escapar(cfg.nome_loja || 'Instituto')}</h1>
      <div class="sub">${cfg.loja_cnpj ? 'CNPJ: ' + UI.escapar(cfg.loja_cnpj) : ''}</div>
      <h2 style="text-align:center">ATA DE REUNIÃO</h2>
      <p><strong>${UI.escapar(ata.titulo)}</strong><br>
      Data: ${UI.escapar(ata.data)}${ata.hora ? ` às ${UI.escapar(ata.hora)}` : ''}
      ${ata.local ? ` · Local: ${UI.escapar(ata.local)}` : ''}</p>

      <h3>Participantes</h3>
      ${ata.participantes.length
        ? `<ul>${ata.participantes.map((p) => `<li>${UI.escapar(p.nome)}${p.presente ? '' : ' (ausente)'}</li>`).join('')}</ul>`
        : '<p>—</p>'}

      ${ata.pauta ? `<h3>Pauta</h3><div class="texto">${UI.escapar(ata.pauta)}</div>` : ''}
      ${ata.deliberacoes ? `<h3>Deliberações</h3><div class="texto">${UI.escapar(ata.deliberacoes)}</div>` : ''}
      ${ata.observacao ? `<h3>Observações</h3><div class="texto">${UI.escapar(ata.observacao)}</div>` : ''}

      <div class="assinatura">
        ${UI.escapar(assinante ? assinante.nome : (cfg.nome_loja || 'Responsável'))}
        ${assinante ? `<br><span style="font-size:11px;color:#555">${UI.escapar(assinante.cargo)}</span>` : ''}
      </div>
      </body></html>`;

    try { await UI.baixarPDF(html, `ata-${ata.data}.pdf`); } catch (e) { UI.erro(e.message); }
  }

  return { titulo: 'Atas', render };
})();
