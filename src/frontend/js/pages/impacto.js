'use strict';

/**
 * Relatório de impacto: o retrato do que o instituto entregou no período.
 *
 * É o documento que se mostra a mantenedor, parceiro e edital — quantas
 * pessoas foram atendidas, quantas aulas aconteceram, quantas horas foram
 * doadas e como isso se distribui por curso e faixa etária.
 */
window.PaginaImpacto = (function () {
  const hoje = () => new Date().toISOString().slice(0, 10);
  const periodo = { de: hoje().slice(0, 4) + '-01-01', ate: hoje() };

  async function render(container) {
    container.innerHTML = `
      <div class="barra-ferramentas">
        <div class="cresce">
          <strong>Relatório de impacto</strong>
          <div class="dica">Baseado nas chamadas registradas. Se a equipe não fizer a chamada, os números saem menores do que a realidade.</div>
        </div>
        <div class="campo"><label>De</label><input type="date" id="im-de" value="${periodo.de}" /></div>
        <div class="campo"><label>Até</label><input type="date" id="im-ate" value="${periodo.ate}" /></div>
        <button class="btn btn--secundario" id="im-pdf">⬇️ Baixar PDF</button>
      </div>
      <div id="im-corpo">Carregando…</div>`;

    container.querySelector('#im-de').addEventListener('change', (e) => { periodo.de = e.target.value; carregar(); });
    container.querySelector('#im-ate').addEventListener('change', (e) => { periodo.ate = e.target.value; carregar(); });
    container.querySelector('#im-pdf').addEventListener('click', baixarPdf);
    carregar();
  }

  function buscar() {
    return API.get(`/api/instituto/impacto?de=${periodo.de}&ate=${periodo.ate}`);
  }

  async function carregar() {
    const alvo = document.getElementById('im-corpo');
    if (!alvo) return;
    let d;
    try { d = await buscar(); }
    catch (e) { alvo.innerHTML = `<p class="dica">${UI.escapar(e.message)}</p>`; return; }
    alvo.innerHTML = corpo(d);
  }

  function faixasDe(d) {
    const f = d.faixa_etaria || {};
    return [
      ['Até 11 anos', f.ate_11], ['12 a 17 anos', f.de_12_a_17],
      ['18 a 59 anos', f.de_18_a_59], ['60 anos ou mais', f.de_60_ou_mais],
      ['Sem data de nascimento', f.sem_data_nascimento],
    ].filter(([, v]) => v > 0);
  }

  function corpo(d) {
    const faixas = faixasDe(d);
    return `
      <div class="flex gap-12" style="flex-wrap:wrap;margin-bottom:16px">
        <div class="card stat" style="flex:1;min-width:170px">
          <span class="stat__label">Pessoas atendidas</span>
          <span class="stat__value">${d.alunos_atendidos}</span>
        </div>
        <div class="card stat" style="flex:1;min-width:170px">
          <span class="stat__label">Aulas realizadas</span>
          <span class="stat__value">${d.aulas_realizadas}</span>
        </div>
        <div class="card stat" style="flex:1;min-width:170px">
          <span class="stat__label">Turmas ativas</span>
          <span class="stat__value">${d.turmas_ativas}</span>
        </div>
        <div class="card stat" style="flex:1;min-width:170px">
          <span class="stat__label">Horas de voluntariado</span>
          <span class="stat__value">${d.voluntarios.horas_totais}h</span>
          <span class="dica">${d.voluntarios.quantidade} voluntário(s)</span>
        </div>
        <div class="card stat" style="flex:1;min-width:170px">
          <span class="stat__label">Frequência média</span>
          <span class="stat__value">${d.frequencia_media != null ? d.frequencia_media + '%' : '—'}</span>
        </div>
      </div>

      <div class="card">
        <h3 style="margin-top:0">Atendimento por curso</h3>
        ${d.por_curso.length
          ? `<div class="rolagem"><table class="tabela">
              <thead><tr><th>Curso</th><th>Categoria</th><th>Pessoas</th><th>Aulas</th></tr></thead>
              <tbody>${d.por_curso.map((c) => `
                <tr><td>${UI.escapar(c.curso)}</td><td class="dica">${UI.escapar(c.categoria)}</td>
                <td>${c.alunos}</td><td>${c.aulas}</td></tr>`).join('')}</tbody>
            </table></div>`
          : '<p class="dica">Nenhuma aula com chamada registrada no período.</p>'}
      </div>

      <div class="card mt-16">
        <h3 style="margin-top:0">Faixa etária das pessoas atendidas</h3>
        ${faixas.length
          ? `<div class="rolagem"><table class="tabela">
              <thead><tr><th>Faixa</th><th>Pessoas</th></tr></thead>
              <tbody>${faixas.map(([r, v]) => `<tr><td>${r}</td><td>${v}</td></tr>`).join('')}</tbody>
            </table></div>`
          : '<p class="dica">Sem dados de faixa etária. Preencha a data de nascimento no cadastro dos alunos.</p>'}
      </div>

      <div class="card mt-16">
        <h3 style="margin-top:0">Voluntariado</h3>
        ${d.voluntarios.lista.length
          ? `<div class="rolagem"><table class="tabela">
              <thead><tr><th>Voluntário</th><th>Aulas dadas</th><th>Horas</th></tr></thead>
              <tbody>${d.voluntarios.lista.map((v) => `
                <tr><td>${UI.escapar(v.nome)}</td><td>${v.aulas_dadas}</td><td>${v.horas}h</td></tr>`).join('')}</tbody>
            </table></div>`
          : '<p class="dica">Nenhuma aula registrada com instrutor no período.</p>'}
      </div>`;
  }

  function corpoTabelas(d) {
    const faixas = faixasDe(d).filter(([r]) => r !== 'Sem data de nascimento');
    return `
      <h3>Atendimento por curso</h3>
      ${d.por_curso.length
        ? `<table><thead><tr><th>Curso</th><th>Pessoas</th><th>Aulas</th></tr></thead><tbody>
            ${d.por_curso.map((c) => `<tr><td>${UI.escapar(c.curso)}</td><td>${c.alunos}</td><td>${c.aulas}</td></tr>`).join('')}
          </tbody></table>`
        : '<p class="dica">Sem dados no período.</p>'}
      ${faixas.length ? `<h3>Faixa etária</h3><table><thead><tr><th>Faixa</th><th>Pessoas</th></tr></thead><tbody>
        ${faixas.map(([r, v]) => `<tr><td>${r}</td><td>${v}</td></tr>`).join('')}</tbody></table>` : ''}
      ${d.voluntarios.lista.length ? `<h3>Voluntariado</h3><table><thead><tr><th>Voluntário</th><th>Aulas</th><th>Horas</th></tr></thead><tbody>
        ${d.voluntarios.lista.map((v) => `<tr><td>${UI.escapar(v.nome)}</td><td>${v.aulas_dadas}</td><td>${v.horas}h</td></tr>`).join('')}</tbody></table>` : ''}`;
  }

  async function baixarPdf() {
    let d; let cfg = {}; let assinante = null;
    try {
      [d, cfg, assinante] = await Promise.all([
        buscar(),
        API.get('/api/config').catch(() => ({})),
        API.get('/api/membros/assinante').catch(() => null),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Relatório de impacto</title>
      <style>
        body{font-family:Arial,sans-serif;padding:32px;color:#111}
        h1{font-size:20px;margin-bottom:2px}
        h3{font-size:15px;margin-top:22px}
        table{width:100%;border-collapse:collapse;margin-top:8px;font-size:13px}
        th,td{border-bottom:1px solid #ddd;padding:6px;text-align:left}
        .dica{color:#666;font-size:12px}
        .card{display:inline-block;border:1px solid #ddd;border-radius:6px;padding:10px 16px;margin:4px 6px 4px 0}
        .card b{display:block;font-size:20px}
        .assinatura{margin-top:56px;border-top:1px solid #333;width:280px;text-align:center;padding-top:6px;font-size:12px}
      </style></head><body>
      <h1>${UI.escapar(cfg.nome_loja || 'Instituto')}</h1>
      <div class="dica">Relatório de impacto · Período: ${UI.escapar(d.periodo.de || 'início')} a ${UI.escapar(d.periodo.ate || 'hoje')}</div>
      <div style="margin-top:16px">
        <span class="card"><b>${d.alunos_atendidos}</b> pessoas atendidas</span>
        <span class="card"><b>${d.aulas_realizadas}</b> aulas realizadas</span>
        <span class="card"><b>${d.voluntarios.horas_totais}h</b> de voluntariado</span>
        <span class="card"><b>${d.frequencia_media != null ? d.frequencia_media + '%' : '—'}</b> frequência média</span>
      </div>
      ${corpoTabelas(d)}
      <div class="assinatura">
        ${UI.escapar(assinante ? assinante.nome : (cfg.nome_loja || 'Responsável'))}
        ${assinante ? `<br><span style="font-size:11px;color:#555">${UI.escapar(assinante.cargo)}</span>` : ''}
      </div>
      </body></html>`;

    try { await UI.baixarPDF(html, 'relatorio-de-impacto.pdf'); } catch (e) { UI.erro(e.message); }
  }

  return { titulo: 'Relatório de impacto', render };
})();
