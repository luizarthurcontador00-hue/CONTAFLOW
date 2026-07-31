'use strict';

/**
 * Documentos em PDF do instituto: ficha do aluno, folha de chamada para
 * preencher a mao, declaracao de matricula, declaracao de voluntariado e
 * certificado de conclusao.
 *
 * Ficam juntos porque compartilham o mesmo cabecalho (dados do instituto) e
 * a mesma assinatura (o membro marcado para assinar documentos) — e porque
 * quem mexe num costuma mexer nos outros.
 */
window.Documentos = (function () {
  const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

  const esc = (v) => UI.escapar(v == null ? '' : String(v));

  const ROTULO_MATRICULA = {
    ativa: 'Ativa', espera: 'Fila de espera', trancada: 'Trancada',
    concluida: 'Concluída', desistente: 'Desistente',
  };

  /** "31 de julho de 2026" — como se escreve num documento, não "2026-07-31". */
  function porExtenso(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '—';
    const [a, m, d] = iso.split('-').map(Number);
    return `${d} de ${MESES[m - 1]} de ${a}`;
  }

  function dataBR(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return '—';
    const [a, m, d] = iso.split('-');
    return `${d}/${m}/${a}`;
  }

  async function contexto() {
    const [cfg, assinante] = await Promise.all([
      API.get('/api/config').catch(() => ({})),
      API.get('/api/membros/assinante').catch(() => null),
    ]);
    return { cfg: cfg || {}, assinante };
  }

  const ESTILO_BASE = `
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color:#111; padding:32px; }
    .cabecalho { display:flex; align-items:center; gap:14px; border-bottom:2px solid #333; padding-bottom:10px; margin-bottom:18px; }
    .cabecalho img { max-height:54px; max-width:120px; object-fit:contain; }
    .cabecalho h1 { font-size:17px; margin:0; }
    .cabecalho .sub { font-size:11px; color:#555; margin-top:2px; }
    h2 { font-size:15px; margin:20px 0 6px; }
    table { width:100%; border-collapse:collapse; font-size:12px; margin-top:6px; }
    th, td { border:1px solid #bbb; padding:5px 7px; text-align:left; vertical-align:top; }
    th { background:#eef2f7; font-weight:bold; }
    .dica { color:#666; font-size:11px; }
    .rodape { margin-top:26px; font-size:10px; color:#777; text-align:right; }
    .assinatura { margin-top:60px; border-top:1px solid #333; width:300px; text-align:center; padding-top:6px; font-size:12px; margin-left:auto; margin-right:auto; }
  `;

  function cabecalho(cfg, titulo, subtitulo) {
    const dados = [cfg.loja_cnpj ? 'CNPJ: ' + esc(cfg.loja_cnpj) : '', cfg.loja_endereco ? esc(cfg.loja_endereco) : '',
      cfg.loja_telefone ? 'Tel.: ' + esc(cfg.loja_telefone) : ''].filter(Boolean).join(' · ');
    return `
      <div class="cabecalho">
        ${cfg.loja_logo ? `<img src="${cfg.loja_logo}" alt="">` : ''}
        <div>
          <h1>${esc(cfg.nome_loja || 'Instituto')}</h1>
          ${dados ? `<div class="sub">${dados}</div>` : ''}
        </div>
      </div>
      <h2 style="margin-top:0">${titulo}</h2>
      ${subtitulo ? `<p class="dica" style="margin-top:0">${subtitulo}</p>` : ''}`;
  }

  function assinaturaHTML(cfg, assinante) {
    return `<div class="assinatura">
      ${esc(assinante ? assinante.nome : (cfg.nome_loja || 'Responsável pela instituição'))}
      ${assinante ? `<br><span style="font-size:11px;color:#555">${esc(assinante.cargo)}</span>` : ''}
    </div>`;
  }

  function pagina(titulo, cfg, corpo, extraCss = '') {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${titulo}</title>
      <style>${ESTILO_BASE}${extraCss}</style></head><body>${corpo}</body></html>`;
  }

  function nomeArquivo(prefixo, nome) {
    const limpo = String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
    return `${prefixo}${limpo ? '-' + limpo : ''}.pdf`;
  }

  // ============================ Ficha do aluno ============================

  async function fichaDoAluno(alunoId) {
    let d; let ctx;
    try { [d, ctx] = await Promise.all([API.get(`/api/instituto/ficha-aluno/${alunoId}`), contexto()]); }
    catch (e) { UI.erro(e.message); return; }

    const a = d.aluno;
    const emAberto = d.emprestimos.filter((e) => e.em_aberto);
    const devolvidos = d.emprestimos.filter((e) => !e.em_aberto);

    const corpo = `
      ${cabecalho(ctx.cfg, 'Ficha do aluno', `Emitida em ${dataBR(d.emitido_em)}`)}

      <table>
        <tr><th style="width:110px">Nome</th><td colspan="3"><strong>${esc(a.nome)}</strong></td></tr>
        <tr>
          <th>Nascimento</th><td>${dataBR(a.data_nascimento)}${a.idade != null ? ` <span class="dica">(${a.idade} anos)</span>` : ''}</td>
          <th style="width:110px">CPF</th><td>${esc(a.cpf || '—')}</td>
        </tr>
        <tr><th>Telefone</th><td>${esc(a.telefone || '—')}</td><th>E-mail</th><td>${esc(a.email || '—')}</td></tr>
        <tr><th>Endereço</th><td colspan="3">${esc(a.endereco || '—')}</td></tr>
        <tr>
          <th>Responsável</th><td>${esc(a.responsavel_nome || '—')}</td>
          <th>Telefone</th><td>${esc(a.responsavel_telefone || '—')}</td>
        </tr>
      </table>

      <h2>Turmas</h2>
      ${d.matriculas.length ? `<table>
        <thead><tr><th>Curso / turma</th><th>Horário</th><th>Instrutor</th><th>Período</th><th>Situação</th><th>Frequência</th></tr></thead>
        <tbody>${d.matriculas.map((m) => `<tr>
          <td><strong>${esc(m.curso_nome)}</strong><div class="dica">${esc(m.turma_nome)}${m.sala ? ' · ' + esc(m.sala) : ''}</div></td>
          <td>${esc(m.horarios || '—')}</td>
          <td>${esc(m.instrutores || '—')}</td>
          <td>${dataBR(m.periodo_inicio)}${m.periodo_fim ? ' a ' + dataBR(m.periodo_fim) : ''}${m.periodo_rotulo ? `<div class="dica">${esc(m.periodo_rotulo)}</div>` : ''}</td>
          <td>${esc(ROTULO_MATRICULA[m.status] || m.status)}</td>
          <td>${m.frequencia.percentual != null
            ? `<strong>${m.frequencia.percentual}%</strong><div class="dica">${m.frequencia.presencas}/${m.frequencia.encontros} presenças</div>`
            : '<span class="dica">sem chamada</span>'}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="dica">Sem matrícula registrada.</p>'}

      <h2>Instrumentos</h2>
      ${emAberto.length ? `<table>
        <thead><tr><th>Instrumento</th><th>Nº</th><th>Saiu em</th><th>Devolver até</th></tr></thead>
        <tbody>${emAberto.map((e) => `<tr>
          <td>${esc(e.instrumento_nome)}</td><td>${esc(e.numero)}</td>
          <td>${dataBR(e.data_emprestimo)}</td><td>${e.previsao_devolucao ? dataBR(e.previsao_devolucao) : '—'}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="dica">Nenhum instrumento do acervo com o aluno no momento.</p>'}
      ${d.instrumentos_proprios.length
        ? `<p class="dica">Instrumento próprio: ${d.instrumentos_proprios.map((i) => esc(i.instrumento_nome)).join(', ')} — não ocupa vaga do acervo.</p>`
        : ''}
      ${devolvidos.length ? `<p class="dica">${devolvidos.length} empréstimo(s) já devolvido(s) no histórico.</p>` : ''}

      <h2>Termos e autorizações</h2>
      ${d.autorizacoes.length ? `<table>
        <thead><tr><th>Termo</th><th>Entregue?</th><th>Data</th><th>Observação</th></tr></thead>
        <tbody>${d.autorizacoes.map((t) => `<tr>
          <td>${esc(t.tipo)}</td><td>${t.entregue ? 'Sim' : 'Não'}</td>
          <td>${t.data_entrega ? dataBR(t.data_entrega) : '—'}</td><td>${esc(t.observacao || '')}</td>
        </tr>`).join('')}</tbody></table>`
        : '<p class="dica">Nenhum termo registrado.</p>'}

      <h2>Resumo</h2>
      <table>
        <tr>
          <th>Turmas ativas</th><td>${d.resumo.turmas_ativas}</td>
          <th>No histórico</th><td>${d.resumo.turmas_no_historico}</td>
          <th>Frequência geral</th><td>${d.resumo.frequencia_geral != null ? d.resumo.frequencia_geral + '%' : '—'}</td>
        </tr>
      </table>

      <div class="rodape">Documento de uso interno · ${esc(ctx.cfg.nome_loja || 'Instituto')}</div>`;

    try { await UI.baixarPDF(pagina('Ficha do aluno', ctx.cfg, corpo), nomeArquivo('ficha', a.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  // ==================== Folha de chamada para preencher ====================

  /**
   * A folha que o instrutor leva impressa: alunos nas linhas, datas nas
   * colunas, quadradinhos em branco. Sempre com linhas vazias no fim — aluno
   * novo aparece na aula antes de aparecer no sistema.
   */
  async function folhaDeChamada(turmaId, mes) {
    let d; let ctx;
    try {
      [d, ctx] = await Promise.all([
        API.get(`/api/turmas/${turmaId}/folha-impressao?mes=${encodeURIComponent(mes || '')}`),
        contexto(),
      ]);
    } catch (e) { UI.erro(e.message); return; }

    const colunas = d.encontros.length;
    const linhasExtras = 4;
    const [ano, mesNum] = d.periodo.de.split('-').map(Number);

    const corpo = `
      ${cabecalho(ctx.cfg, 'Folha de chamada', `${MESES[mesNum - 1]} de ${ano}`)}

      <table class="ficha-turma">
        <tr>
          <th style="width:90px">Turma</th><td><strong>${esc(d.turma.nome)}</strong> <span class="dica">${esc(d.turma.curso_nome)}</span></td>
          <th style="width:90px">Sala</th><td>${esc(d.turma.sala || '—')}</td>
        </tr>
        <tr>
          <th>Horário</th><td>${esc(d.horarios.join(' · ') || '—')}</td>
          <th>Instrutor</th><td>${esc(d.instrutores.map((i) => i.nome).join(', ') || '—')}</td>
        </tr>
      </table>

      ${colunas ? `
      <table class="chamada">
        <thead>
          <tr>
            <th class="col-n">#</th>
            <th class="col-nome">Aluno</th>
            ${d.encontros.map((e) => `<th class="col-dia">${e.dia}/${e.mes_curto}<div class="dia-semana">${e.dia_semana}</div></th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${d.alunos.map((al, i) => `<tr>
            <td class="col-n">${i + 1}</td>
            <td class="col-nome">${esc(al.nome)}</td>
            ${d.encontros.map(() => '<td class="col-dia"></td>').join('')}
          </tr>`).join('')}
          ${Array.from({ length: linhasExtras }).map((_, i) => `<tr class="extra">
            <td class="col-n">${d.alunos.length + i + 1}</td>
            <td class="col-nome"></td>
            ${d.encontros.map(() => '<td class="col-dia"></td>').join('')}
          </tr>`).join('')}
        </tbody>
      </table>
      <p class="legenda">Marque <strong>P</strong> para presente, <strong>F</strong> para falta e <strong>J</strong> para falta justificada.
      As linhas em branco são para quem chegar durante o mês.</p>

      <table class="assinaturas">
        <thead><tr>${d.encontros.map((e) => `<th>${e.dia}/${e.mes_curto}</th>`).join('')}</tr></thead>
        <tbody><tr>${d.encontros.map(() => '<td class="rubrica"></td>').join('')}</tr></tbody>
      </table>
      <p class="legenda">Rubrica de quem deu a aula.</p>
      ` : `<p class="dica">Não há aula marcada para esta turma em ${MESES[mesNum - 1]} de ${ano}.</p>`}

      <div class="rodape">
        ${d.alunos.length} aluno(s) matriculado(s) · ${colunas} encontro(s) no mês ·
        emitido em ${dataBR(new Date().toISOString().slice(0, 10))}
      </div>`;

    const css = `
      @page { size: A4 landscape; margin: 12mm; }
      body { padding: 0; }
      /* width:auto deixa a grade do tamanho do conteúdo: com poucas datas no
         mês ela não estica os quadradinhos pela folha toda. */
      table.chamada, table.assinaturas { width:auto; min-width:55%; }
      table.chamada td, table.chamada th { text-align:center; }
      table.chamada .col-n { width:26px; color:#666; }
      table.chamada .col-nome { text-align:left; min-width:220px; }
      table.chamada .col-dia { width:38px; height:26px; }
      table.chamada .dia-semana { font-weight:normal; font-size:9px; color:#666; }
      table.chamada tr.extra .col-nome { background:repeating-linear-gradient(180deg,#fff,#fff 22px,#eee 22px,#eee 23px); }
      table.assinaturas { margin-top:14px; }
      table.assinaturas th { text-align:center; }
      table.assinaturas .rubrica { height:40px; min-width:110px; }
      .legenda { font-size:11px; color:#555; margin:6px 0 0; }
      .ficha-turma th { width:90px; }
    `;

    try { await UI.baixarPDF(pagina('Folha de chamada', ctx.cfg, corpo, css), nomeArquivo(`chamada-${d.periodo.de.slice(0, 7)}`, d.turma.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  // ============================= Declarações =============================

  const ESTILO_DECLARACAO = `
    body { font-family: Georgia, serif; padding:56px; line-height:1.9; }
    .cabecalho { border-bottom:none; justify-content:center; text-align:center; display:block; margin-bottom:34px; }
    .cabecalho h1 { font-size:19px; }
    h2 { font-size:16px; text-align:center; margin:26px 0; letter-spacing:.5px; }
    p { text-align: justify; }
    .local-data { margin-top:34px; text-align:center; font-size:13px; }
  `;

  async function declaracaoMatricula(alunoId) {
    let d; let ctx;
    try { [d, ctx] = await Promise.all([API.get(`/api/instituto/declaracao-matricula/${alunoId}`), contexto()]); }
    catch (e) { UI.erro(e.message); return; }

    const a = d.aluno;
    const turmas = d.matriculas.map((m) => {
      const carga = m.carga_horaria ? `, com carga horária de ${m.carga_horaria} hora(s)` : '';
      return `<li><strong>${esc(m.curso_nome)}</strong> — turma ${esc(m.turma_nome)}${m.horarios ? `, ${esc(m.horarios)}` : ''}${carga}, desde ${porExtenso(m.data_matricula || m.periodo_inicio)}.</li>`;
    }).join('');

    const corpo = `
      ${cabecalho(ctx.cfg, '')}
      <h2>DECLARAÇÃO DE MATRÍCULA</h2>
      <p>Declaramos, para os devidos fins, que <strong>${esc(a.nome)}</strong>${a.cpf ? `, inscrito(a) no CPF sob o nº ${esc(a.cpf)}` : ''}${a.data_nascimento ? `, nascido(a) em ${porExtenso(a.data_nascimento)}` : ''}${a.responsavel_nome ? `, sob a responsabilidade de ${esc(a.responsavel_nome)}` : ''},
      encontra-se regularmente matriculado(a) nesta instituição, participando das seguintes atividades:</p>
      <ul>${turmas}</ul>
      <p>As atividades são oferecidas gratuitamente, sem qualquer custo para o(a) participante ou sua família.</p>
      <p>Por ser expressão da verdade, firmamos a presente declaração.</p>
      <div class="local-data">${porExtenso(d.emitido_em)}.</div>
      ${assinaturaHTML(ctx.cfg, ctx.assinante)}`;

    try { await UI.baixarPDF(pagina('Declaração de matrícula', ctx.cfg, corpo, ESTILO_DECLARACAO), nomeArquivo('declaracao-matricula', a.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  /**
   * Declaração de trabalho voluntário. Separa aulas de atividades porque a
   * pessoa que montou o palco doou o tempo dela igual a quem deu aula.
   */
  async function declaracaoVoluntariado(pessoa, de, ate) {
    const ctx = await contexto();
    const partes = [];
    if (pessoa.aulas_dadas > 0) partes.push(`ministrado <strong>${pessoa.aulas_dadas} aula(s)</strong>`);
    if (pessoa.atividades > 0) partes.push(`participado de <strong>${pessoa.atividades} atividade(s)</strong> de apoio (eventos, manutenção e organização)`);
    const feito = partes.length ? partes.join(' e ') : 'colaborado com as atividades da instituição';

    const corpo = `
      ${cabecalho(ctx.cfg, '')}
      <h2>DECLARAÇÃO DE TRABALHO VOLUNTÁRIO</h2>
      <p>Declaramos, para os devidos fins, que <strong>${esc(pessoa.nome)}</strong>${pessoa.documento ? `, portador(a) do documento ${esc(pessoa.documento)},` : ''}
      prestou serviço voluntário nesta instituição no período de ${porExtenso(de)} a ${porExtenso(ate)},
      tendo ${feito}, totalizando <strong>${esc(String(pessoa.horas || 0))} hora(s)</strong> de dedicação.</p>
      <p>O trabalho voluntário aqui declarado não gera vínculo empregatício nem obrigação de natureza
      trabalhista, previdenciária ou afim, nos termos da Lei nº 9.608/1998.</p>
      <p>Por ser expressão da verdade, firmamos a presente declaração.</p>
      <div class="local-data">${porExtenso(new Date().toISOString().slice(0, 10))}.</div>
      ${assinaturaHTML(ctx.cfg, ctx.assinante)}`;

    try { await UI.baixarPDF(pagina('Declaração de voluntariado', ctx.cfg, corpo, ESTILO_DECLARACAO), nomeArquivo('declaracao-voluntariado', pessoa.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  async function certificado(alunoId, turmaId) {
    let d; let ctx;
    try { [d, ctx] = await Promise.all([API.get(`/api/instituto/certificado/${alunoId}/${turmaId}`), contexto()]); }
    catch (e) { UI.erro(e.message); return; }

    const m = d.matricula;
    const carga = m.carga_horaria ? `, com carga horária de <strong>${m.carga_horaria} hora(s)</strong>` : '';
    const freq = m.frequencia.percentual != null ? `, com frequência de <strong>${m.frequencia.percentual}%</strong>` : '';

    const corpo = `
      ${cabecalho(ctx.cfg, '')}
      <h2>CERTIFICADO</h2>
      <p style="text-align:center;font-size:15px">Certificamos que</p>
      <p style="text-align:center;font-size:22px;margin:10px 0"><strong>${esc(d.aluno.nome)}</strong></p>
      <p>concluiu o curso de <strong>${esc(m.curso_nome)}</strong>, turma ${esc(m.turma_nome)}${carga}${freq},
      realizado no período de ${porExtenso(m.periodo_inicio)}${m.periodo_fim ? ` a ${porExtenso(m.periodo_fim)}` : ''}${m.instrutores ? `, sob orientação de ${esc(m.instrutores)}` : ''}.</p>
      <div class="local-data">${porExtenso(d.emitido_em)}.</div>
      ${assinaturaHTML(ctx.cfg, ctx.assinante)}`;

    const css = ESTILO_DECLARACAO + '@page { size: A4 landscape; margin: 18mm; } body { padding:34px; }';
    try { await UI.baixarPDF(pagina('Certificado', ctx.cfg, corpo, css), nomeArquivo('certificado', d.aluno.nome)); }
    catch (e) { UI.erro(e.message); }
  }

  return { fichaDoAluno, folhaDeChamada, declaracaoMatricula, declaracaoVoluntariado, certificado, porExtenso, dataBR };
})();
