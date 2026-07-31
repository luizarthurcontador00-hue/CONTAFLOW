'use strict';

/**
 * Termos de autorização dos alunos (uso de imagem, saída).
 *
 * Aluno menor de idade sem autorização assinada é risco real para o
 * instituto — principalmente na hora de publicar foto de atividade.
 */
window.PaginaAutorizacoes = (function () {
  const TIPOS = [['imagem', 'Uso de imagem'], ['saida', 'Autorização de saída'], ['outro', 'Outro termo']];
  const filtro = { tipo: 'imagem', somente_pendentes: false };

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Termos de autorização</strong>
          <div class="dica">Controle de quem já entregou o termo assinado pelo responsável. Gere o termo em PDF para imprimir e colher a assinatura.</div>
        </div>
        <div class="campo"><label>Tipo de termo</label>
          <select id="au-tipo">${TIPOS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></div>
        <div class="campo"><label>Mostrar</label>
          <select id="au-filtro">
            <option value="">Todos os alunos</option>
            <option value="1">Somente pendentes</option>
          </select></div>
      </div>
      <div class="card"><div id="au-lista">Carregando…</div></div>`;

    container.querySelector('#au-tipo').addEventListener('change', (e) => { filtro.tipo = e.target.value; listar(); });
    container.querySelector('#au-filtro').addEventListener('change', (e) => { filtro.somente_pendentes = e.target.value === '1'; listar(); });
    listar();
  }

  async function listar() {
    const alvo = document.getElementById('au-lista');
    if (!alvo) return;
    let itens = [];
    try {
      const q = new URLSearchParams({ tipo: filtro.tipo });
      if (filtro.somente_pendentes) q.set('somente_pendentes', '1');
      itens = await API.get('/api/instituto/autorizacoes?' + q.toString());
    } catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }

    if (!itens.length) {
      alvo.innerHTML = `<div class="vazio"><h3>Nenhum aluno matriculado</h3>
        <p class="dica">A lista mostra os alunos com matrícula ativa.</p></div>`;
      return;
    }

    const pendentesMenores = itens.filter((i) => !i.entregue && i.menor_de_idade).length;
    alvo.innerHTML = `
      ${pendentesMenores ? `<p><span class="badge badge--alerta">${pendentesMenores} menor(es) de idade sem termo entregue</span></p>` : ''}
      <div class="rolagem"><table class="tabela">
        <thead><tr><th>Aluno</th><th>Idade</th><th>Responsável</th><th>Termo</th><th></th></tr></thead>
        <tbody>
          ${itens.map((i) => `
            <tr>
              <td><strong>${UI.escapar(i.aluno_nome)}</strong></td>
              <td>${i.idade != null ? `${i.idade} anos` : '—'}
                ${i.menor_de_idade ? ' <span class="badge badge--muted">menor</span>' : ''}</td>
              <td class="dica">${UI.escapar(i.responsavel_nome || '—')}
                ${i.responsavel_telefone ? `<div>${UI.escapar(i.responsavel_telefone)}</div>` : ''}</td>
              <td>${i.entregue
                ? `<span class="badge badge--ok">entregue ${UI.escapar(i.data_entrega || '')}</span>`
                : '<span class="badge badge--alerta">pendente</span>'}</td>
              <td style="text-align:right;white-space:nowrap">
                <button class="btn btn--secundario" data-pdf="${i.aluno_id}">📄 Gerar termo</button>
                <label class="flex gap-12" style="align-items:center;display:inline-flex;margin-left:8px">
                  <input type="checkbox" data-entregue="${i.aluno_id}" ${i.entregue ? 'checked' : ''} /> entregue
                </label>
              </td>
            </tr>`).join('')}
        </tbody>
      </table></div>`;

    alvo.querySelectorAll('[data-entregue]').forEach((c) => c.addEventListener('change', async () => {
      try {
        await API.post(`/api/instituto/autorizacoes/${c.dataset.entregue}`, { tipo: filtro.tipo, entregue: c.checked });
        UI.sucesso(c.checked ? 'Termo marcado como entregue.' : 'Termo marcado como pendente.');
        listar();
        if (window.Avisos) Avisos.atualizar();
      } catch (e) { UI.erro(e.message); c.checked = !c.checked; }
    }));
    alvo.querySelectorAll('[data-pdf]').forEach((b) => b.addEventListener('click', () => {
      gerarTermo(itens.find((i) => i.aluno_id === Number(b.dataset.pdf)));
    }));
  }

  async function gerarTermo(aluno) {
    let cfg = {}; let assinante = null;
    try {
      [cfg, assinante] = await Promise.all([
        API.get('/api/config').catch(() => ({})),
        API.get('/api/membros/assinante').catch(() => null),
      ]);
    } catch (_) { cfg = {}; }

    const ehImagem = filtro.tipo === 'imagem';
    // Aluno maior de idade autoriza por si mesmo — nao existe "responsavel
    // legal" pra ele, e o termo nao pode falar "menor" nem pedir assinatura
    // de quem nao vai assinar nada.
    const menor = !!aluno.menor_de_idade;
    const titulo = ehImagem ? 'AUTORIZAÇÃO DE USO DE IMAGEM' : (filtro.tipo === 'saida' ? 'AUTORIZAÇÃO DE SAÍDA' : 'TERMO DE AUTORIZAÇÃO');
    const abertura = menor ? 'Eu, responsável legal acima identificado,' : 'Eu, aluno(a) acima identificado(a),';
    const corpo = ehImagem
      ? (menor
          ? `autorizo o uso da imagem do(a) menor acima identificado(a) em fotografias e vídeos captados durante as
             atividades da instituição, para fins exclusivamente institucionais e de divulgação das ações realizadas,
             sem qualquer ônus e por prazo indeterminado, podendo esta autorização ser revogada a qualquer momento
             mediante comunicação por escrito.`
          : `autorizo o uso da minha imagem em fotografias e vídeos captados durante as atividades da instituição,
             para fins exclusivamente institucionais e de divulgação das ações realizadas, sem qualquer ônus e por
             prazo indeterminado, podendo esta autorização ser revogada a qualquer momento mediante comunicação
             por escrito.`)
      : (menor
          ? `autorizo o(a) menor acima identificado(a) a participar das atividades externas organizadas pela
             instituição, ciente dos horários e locais informados previamente.`
          : `declaro estar ciente e de acordo em participar das atividades externas organizadas pela instituição,
             nos horários e locais informados previamente.`);

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>
      <style>
        body{font-family:Georgia,serif;padding:56px;color:#111;line-height:1.9}
        h1{font-size:19px;text-align:center;margin-bottom:2px}
        .sub{text-align:center;color:#555;font-size:12px;margin-bottom:36px}
        h2{font-size:15px;text-align:center;margin:24px 0}
        .campo{margin:10px 0}
        .linha{display:inline-block;border-bottom:1px solid #333;min-width:280px}
        .assinatura{margin-top:64px;border-top:1px solid #333;width:320px;text-align:center;padding-top:6px;font-size:12px}
        .duplo{display:flex;gap:40px;margin-top:56px}
      </style></head><body>
      <h1>${UI.escapar(cfg.nome_loja || 'Instituto')}</h1>
      <div class="sub">${cfg.loja_cnpj ? 'CNPJ: ' + UI.escapar(cfg.loja_cnpj) : ''}${cfg.loja_endereco ? ' · ' + UI.escapar(cfg.loja_endereco) : ''}</div>
      <h2>${titulo}</h2>
      <div class="campo">Aluno(a): <strong>${UI.escapar(aluno.aluno_nome)}</strong></div>
      <div class="campo">Data de nascimento: ${aluno.data_nascimento ? UI.dataHora(aluno.data_nascimento) : '____/____/______'}</div>
      <div class="campo">Documento: <span class="linha"></span></div>
      ${menor ? `
      <div class="campo">Responsável: <span class="linha">${UI.escapar(aluno.responsavel_nome || '')}</span></div>
      <div class="campo">Documento do responsável: <span class="linha"></span></div>
      ` : ''}
      <p style="margin-top:24px">${abertura} ${corpo}</p>
      <div class="campo" style="margin-top:32px">Local e data: <span class="linha"></span></div>
      <div class="duplo">
        <div class="assinatura">Assinatura d${menor ? 'o responsável' : 'o(a) aluno(a)'}</div>
        <div class="assinatura">
          ${UI.escapar(assinante ? assinante.nome : (cfg.nome_loja || 'Pela instituição'))}
          ${assinante ? `<br><span style="font-size:11px;color:#555">${UI.escapar(assinante.cargo)}</span>` : ''}
        </div>
      </div>
      </body></html>`;

    try { await UI.baixarPDF(html, `termo-${filtro.tipo}-${aluno.aluno_nome.replace(/\s+/g, '-').toLowerCase()}.pdf`); }
    catch (e) { UI.erro(e.message); }
  }

  return { titulo: 'Autorizações', render };
})();
