'use strict';

/**
 * Turmas do instituto: a oferta concreta de um curso, com periodo, dias da
 * semana, instrutores e alunos matriculados.
 *
 * Duas regras que o modulo faz questao de garantir:
 * - As vagas nunca passam do que o acervo de instrumentos aguenta naquele
 *   horario (nao adianta abrir turma de violao com 12 vagas se so ha 8).
 * - Quando a turma lota, a matricula nao e recusada: o aluno entra na fila de
 *   espera, que e o comportamento util no dia a dia de um instituto.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');
const instrumentos = require('./instrumentosService');

const STATUS_TURMA = ['planejada', 'aberta', 'encerrada', 'cancelada'];
const STATUS_MATRICULA = ['ativa', 'espera', 'trancada', 'concluida', 'desistente'];
const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function listar({ curso_id, status, instrumento_id } = {}) {
  const where = [];
  if (curso_id) where.push('t.curso_id = @curso_id');
  if (status) where.push('t.status = @status');
  if (instrumento_id) where.push('t.instrumento_id = @instrumento_id');

  const turmas = getDb().prepare(`
    SELECT t.*, c.nome AS curso_nome, c.categoria AS curso_categoria, i.nome AS instrumento_nome,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'ativa') AS matriculados,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status = 'espera') AS na_espera
    FROM turmas t
    JOIN cursos c ON c.id = t.curso_id
    LEFT JOIN instrumentos i ON i.id = t.instrumento_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY t.status, c.nome, t.nome
  `).all({ curso_id, status, instrumento_id });

  const db = getDb();
  turmas.forEach((t) => {
    t.horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ? ORDER BY dia_semana, hora_inicio').all(t.id);
    t.instrutores = db.prepare(`
      SELECT ti.papel, p.id, p.nome
      FROM turmas_instrutores ti JOIN profissionais p ON p.id = ti.profissional_id
      WHERE ti.turma_id = ? ORDER BY ti.papel, p.nome
    `).all(t.id);
  });
  return turmas;
}

function obter(id) {
  const db = getDb();
  const turma = db.prepare(`
    SELECT t.*, c.nome AS curso_nome, c.categoria AS curso_categoria, i.nome AS instrumento_nome
    FROM turmas t
    JOIN cursos c ON c.id = t.curso_id
    LEFT JOIN instrumentos i ON i.id = t.instrumento_id
    WHERE t.id = ?
  `).get(id);
  if (!turma) throw new AppError('Turma não encontrada.', 404);

  turma.horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ? ORDER BY dia_semana, hora_inicio').all(id);
  turma.instrutores = db.prepare(`
    SELECT ti.*, p.nome, p.telefone, p.cor, p.tipo
    FROM turmas_instrutores ti JOIN profissionais p ON p.id = ti.profissional_id
    WHERE ti.turma_id = ? ORDER BY ti.papel, p.nome
  `).all(id);
  turma.matriculas = db.prepare(`
    SELECT m.*, a.nome AS aluno_nome, a.telefone, a.data_nascimento, a.responsavel_nome, a.responsavel_telefone
    FROM matriculas m JOIN clientes a ON a.id = m.aluno_id
    WHERE m.turma_id = ? ORDER BY (m.status != 'ativa'), a.nome
  `).all(id);
  turma.matriculados = turma.matriculas.filter((m) => m.status === 'ativa').length;
  turma.na_espera = turma.matriculas.filter((m) => m.status === 'espera').length;
  return turma;
}

function validarHorarios(horarios) {
  const lista = (horarios || []).map((h) => {
    const dia = Number(h.dia_semana);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) throw new AppError('Dia da semana inválido no horário da turma.');
    const ini = String(h.hora_inicio || '').trim();
    const fim = String(h.hora_fim || '').trim();
    if (!/^\d{2}:\d{2}$/.test(ini) || !/^\d{2}:\d{2}$/.test(fim)) throw new AppError('Informe as horas no formato HH:MM.');
    if (fim <= ini) throw new AppError(`No ${DIAS[dia]}, a hora de término precisa ser depois da hora de início.`);
    return { dia_semana: dia, hora_inicio: ini, hora_fim: fim };
  });
  if (!lista.length) throw new AppError('Informe ao menos um dia e horário para a turma.');
  return lista;
}

function validar(dados) {
  const db = getDb();
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome da turma.');

  const cursoId = Number(dados.curso_id);
  const curso = db.prepare('SELECT * FROM cursos WHERE id = ?').get(cursoId);
  if (!curso) throw new AppError('Selecione um curso válido para a turma.');

  const vagas = Number(dados.vagas);
  if (!Number.isInteger(vagas) || vagas < 0) throw new AppError('Informe um número de vagas válido.');

  const inicio = String(dados.periodo_inicio || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new AppError('Informe a data de início do período da turma.');
  const fim = String(dados.periodo_fim || '').trim() || null;
  if (fim && fim < inicio) throw new AppError('O fim do período não pode ser antes do início.');

  const instrumentoId = dados.instrumento_id ? Number(dados.instrumento_id) : null;
  const porAluno = Math.max(1, Number(dados.instrumentos_por_aluno) || 1);
  const status = STATUS_TURMA.includes(dados.status) ? dados.status : 'aberta';

  return {
    curso_id: cursoId,
    nome,
    instrumento_id: instrumentoId,
    instrumentos_por_aluno: porAluno,
    vagas,
    sala: (dados.sala || '').trim() || null,
    periodo_inicio: inicio,
    periodo_fim: fim,
    status,
    observacao: (dados.observacao || '').trim() || null,
  };
}

/**
 * Impede abrir/editar turma pedindo mais instrumentos do que existem livres
 * naquele horario. Explica o limite com nomes, para dar para agir.
 */
/** Quantos matriculados ativos da turma trazem o proprio instrumento. */
function comInstrumentoProprio(turmaId, instrumentoId) {
  if (!turmaId || !instrumentoId) return 0;
  return getDb().prepare(`
    SELECT COUNT(*) c FROM matriculas m
    JOIN alunos_instrumentos_proprios p ON p.aluno_id = m.aluno_id AND p.instrumento_id = @instrumentoId
    WHERE m.turma_id = @turmaId AND m.status = 'ativa'
  `).get({ turmaId, instrumentoId }).c;
}

/**
 * Confere o acervo ao abrir/editar a turma.
 *
 * As vagas NAO sao travadas pelo tamanho do acervo, e isso e proposital: um
 * instituto com 4 violoes pode abrir turma de 8 quando metade dos alunos
 * traz o proprio instrumento — travar aqui impediria de criar a turma antes
 * de existir qualquer matricula (o ovo e a galinha). O limite de verdade e
 * cobrado na MATRICULA, onde da para saber exatamente quem precisa de
 * instrumento emprestado.
 *
 * O unico caso barrado aqui e o impossivel: turma que depende de instrumento
 * quando nao ha nenhum livre naquele horario.
 */
function conferirAcervo(d, horarios, turmaIdIgnorar) {
  if (!d.instrumento_id || d.vagas === 0) return null;
  const disp = instrumentos.vagasDisponiveis(d.instrumento_id, horarios, {
    turmaIdIgnorar,
    instrumentosPorAluno: d.instrumentos_por_aluno,
  });

  if (disp.vagas_maximas === 0) {
    const ocupando = disp.turmas_no_mesmo_horario.map((t) => t.nome).join(', ');
    throw new AppError(
      `Não há ${disp.instrumento} livre neste horário`
      + (ocupando ? ` (todos comprometidos com: ${ocupando})` : '')
      + (disp.emprestados ? `, ${disp.emprestados} emprestado(s)` : '')
      + (disp.fora_de_uso ? `, ${disp.fora_de_uso} em manutenção/baixado` : '')
      + '. Escolha outro horário, ou matricule apenas alunos que tenham o próprio instrumento.'
    );
  }
  return disp;
}

function criar(dados) {
  const db = getDb();
  const d = validar(dados);
  const horarios = validarHorarios(dados.horarios);
  conferirAcervo(d, horarios, null);

  const criarTudo = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO turmas (curso_id, nome, instrumento_id, instrumentos_por_aluno, vagas, sala,
        periodo_inicio, periodo_fim, status, observacao)
      VALUES (@curso_id, @nome, @instrumento_id, @instrumentos_por_aluno, @vagas, @sala,
        @periodo_inicio, @periodo_fim, @status, @observacao)
    `).run(d);
    const turmaId = info.lastInsertRowid;
    gravarHorarios(db, turmaId, horarios);
    gravarInstrutores(db, turmaId, dados.instrutores);
    return turmaId;
  });

  const id = criarTudo();
  gerarEncontros(id);
  return obter(id);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = obter(id);
  const d = validar({ ...atual, ...dados });
  const horarios = dados.horarios ? validarHorarios(dados.horarios) : atual.horarios;
  conferirAcervo(d, horarios, id);

  // Reduzir vagas abaixo de quem ja esta matriculado deixaria aluno sem lugar.
  const ativos = db.prepare("SELECT COUNT(*) c FROM matriculas WHERE turma_id = ? AND status = 'ativa'").get(id).c;
  if (d.vagas < ativos) {
    throw new AppError(`Esta turma já tem ${ativos} aluno(s) matriculado(s). Não dá para reduzir para ${d.vagas} vagas.`);
  }

  const salvar = db.transaction(() => {
    db.prepare(`
      UPDATE turmas SET curso_id=@curso_id, nome=@nome, instrumento_id=@instrumento_id,
        instrumentos_por_aluno=@instrumentos_por_aluno, vagas=@vagas, sala=@sala,
        periodo_inicio=@periodo_inicio, periodo_fim=@periodo_fim, status=@status, observacao=@observacao
      WHERE id=@id
    `).run({ ...d, id });
    if (dados.horarios) gravarHorarios(db, id, horarios);
    if (dados.instrutores) gravarInstrutores(db, id, dados.instrutores);
  });
  salvar();

  // Mudou dia/horario? Os encontros futuros do horario ANTIGO ficariam
  // orfaos no calendario (trocar terça por quarta deixaria os dois).
  if (dados.horarios) limparEncontrosForaDoHorario(id);
  if (d.status === 'aberta' || d.status === 'planejada') gerarEncontros(id);
  return obter(id);
}

function gravarHorarios(db, turmaId, horarios) {
  db.prepare('DELETE FROM turmas_horarios WHERE turma_id = ?').run(turmaId);
  const ins = db.prepare('INSERT INTO turmas_horarios (turma_id, dia_semana, hora_inicio, hora_fim) VALUES (?, ?, ?, ?)');
  horarios.forEach((h) => ins.run(turmaId, h.dia_semana, h.hora_inicio, h.hora_fim));
}

function gravarInstrutores(db, turmaId, instrutores) {
  db.prepare('DELETE FROM turmas_instrutores WHERE turma_id = ?').run(turmaId);
  const ins = db.prepare('INSERT INTO turmas_instrutores (turma_id, profissional_id, papel) VALUES (?, ?, ?)');
  (instrutores || []).forEach((i) => {
    const pid = Number(i.profissional_id || i);
    if (!pid) return;
    const papel = ['titular', 'auxiliar', 'suplente'].includes(i.papel) ? i.papel : 'titular';
    ins.run(turmaId, pid, papel);
  });
}

function excluir(id) {
  const db = getDb();
  const turma = obter(id);
  const comPresenca = db.prepare(`
    SELECT COUNT(*) c FROM presencas p
    JOIN agendamentos a ON a.id = p.agendamento_id WHERE a.turma_id = ?
  `).get(id).c;
  if (comPresenca > 0) {
    throw new AppError('Esta turma já tem chamadas registradas e não pode ser excluída. Marque-a como encerrada para preservar o histórico.');
  }
  db.prepare('DELETE FROM turmas WHERE id = ?').run(id);
  return { ok: true, nome: turma.nome };
}

// ====================== Encerramento e renovacao ======================

/**
 * Encerra a turma no fim do periodo: as matriculas ativas viram "concluida"
 * e a fila de espera e dispensada (a turma nao existe mais para chamar
 * ninguem). Os encontros futuros sem chamada saem do calendario; os
 * passados ficam, porque sao o historico do que aconteceu.
 */
function encerrar(id, { data_fim } = {}) {
  const db = getDb();
  const turma = obter(id);
  if (turma.status === 'encerrada') throw new AppError('Esta turma já está encerrada.');

  const fim = String(data_fim || '').trim() || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fim)) throw new AppError('Informe uma data de encerramento válida.');

  const fechar = db.transaction(() => {
    db.prepare("UPDATE turmas SET status = 'encerrada', periodo_fim = ? WHERE id = ?").run(fim, id);
    db.prepare(`
      UPDATE matriculas SET status = 'concluida', data_saida = ?
      WHERE turma_id = ? AND status = 'ativa'
    `).run(fim, id);
    db.prepare("UPDATE matriculas SET status = 'desistente', data_saida = ? WHERE turma_id = ? AND status = 'espera'").run(fim, id);
    db.prepare(`
      DELETE FROM agendamentos WHERE turma_id = ? AND date(data) > date(?)
        AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = agendamentos.id)
    `).run(id, fim);
  });
  fechar();
  return obter(id);
}

/**
 * Renova a turma para o periodo seguinte: cria uma turma nova com o mesmo
 * curso, horarios, instrutores e acervo, e leva junto os alunos escolhidos.
 *
 * A turma anterior e encerrada (a nao ser que se peca o contrario), para o
 * historico de cada semestre ficar separado — que e o ponto de ter periodo.
 */
function renovar(id, dados = {}) {
  const db = getDb();
  const origem = obter(id);

  const inicio = String(dados.periodo_inicio || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new AppError('Informe a data de início do novo período.');
  const fim = String(dados.periodo_fim || '').trim() || null;
  if (fim && fim < inicio) throw new AppError('O fim do período não pode ser antes do início.');

  // Quem vai junto: por padrao, todo mundo que estava ativo.
  const ativos = origem.matriculas.filter((m) => m.status === 'ativa').map((m) => m.aluno_id);
  const levar = Array.isArray(dados.alunos) ? dados.alunos.map(Number).filter((a) => ativos.includes(a)) : ativos;

  const vagas = dados.vagas !== undefined && dados.vagas !== '' ? Number(dados.vagas) : origem.vagas;
  if (levar.length > vagas) {
    throw new AppError(`Você escolheu ${levar.length} aluno(s) para continuar, mas a turma nova tem ${vagas} vaga(s).`);
  }

  // A ORDEM importa: a turma velha precisa fechar ANTES de a nova nascer.
  // Enquanto ela estiver aberta no mesmo dia e horario, ela segura os
  // instrumentos do acervo e a turma nova nao teria violao para ninguem.
  // Tudo numa transacao so: se a criacao falhar, a origem nao fica encerrada
  // sem substituta.
  const executar = db.transaction(() => {
    if (dados.encerrar_origem !== false) {
      const fimOrigem = (dados.data_fim_origem || '').trim() || inicio;
      db.prepare("UPDATE turmas SET status = 'encerrada', periodo_fim = ? WHERE id = ?").run(fimOrigem, id);
      db.prepare("UPDATE matriculas SET status = 'concluida', data_saida = ? WHERE turma_id = ? AND status = 'ativa'").run(fimOrigem, id);
      db.prepare("UPDATE matriculas SET status = 'desistente', data_saida = ? WHERE turma_id = ? AND status = 'espera'").run(fimOrigem, id);
      db.prepare(`
        DELETE FROM agendamentos WHERE turma_id = ? AND date(data) >= date(?)
          AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = agendamentos.id)
      `).run(id, inicio);
    }

    const nova = criar({
      curso_id: origem.curso_id,
      nome: (dados.nome || '').trim() || origem.nome,
      instrumento_id: origem.instrumento_id,
      instrumentos_por_aluno: origem.instrumentos_por_aluno,
      vagas,
      sala: dados.sala !== undefined ? dados.sala : origem.sala,
      periodo_inicio: inicio,
      periodo_fim: fim,
      status: 'aberta',
      observacao: origem.observacao,
      horarios: origem.horarios.map((h) => ({ dia_semana: h.dia_semana, hora_inicio: h.hora_inicio, hora_fim: h.hora_fim })),
      instrutores: origem.instrutores.map((i) => ({ profissional_id: i.profissional_id, papel: i.papel })),
    });

    db.prepare('UPDATE turmas SET turma_origem_id = ?, periodo_rotulo = ? WHERE id = ?')
      .run(id, (dados.periodo_rotulo || '').trim() || null, nova.id);

    const naoCouberam = [];
    levar.forEach((alunoId) => {
      try { matricular(nova.id, { aluno_id: alunoId }); }
      catch (e) {
        const p = db.prepare('SELECT nome FROM clientes WHERE id = ?').get(alunoId);
        naoCouberam.push({ aluno_id: alunoId, nome: p && p.nome, motivo: e.message });
      }
    });
    return { novaId: nova.id, naoCouberam };
  });

  const { novaId, naoCouberam } = executar();

  return {
    turma: obter(novaId),
    origem: obter(id),
    alunos_levados: levar.length - naoCouberam.length,
    nao_couberam: naoCouberam,
  };
}

/** As gerações da turma: de onde ela veio e o que veio dela. */
function historicoDaTurma(id) {
  const db = getDb();
  obter(id);
  const linha = db.prepare(`
    WITH RECURSIVE anteriores(id) AS (
      SELECT turma_origem_id FROM turmas WHERE id = @id AND turma_origem_id IS NOT NULL
      UNION
      SELECT t.turma_origem_id FROM turmas t JOIN anteriores a ON t.id = a.id WHERE t.turma_origem_id IS NOT NULL
    ),
    seguintes(id) AS (
      SELECT id FROM turmas WHERE turma_origem_id = @id
      UNION
      SELECT t.id FROM turmas t JOIN seguintes s ON t.turma_origem_id = s.id
    )
    SELECT t.id, t.nome, t.periodo_inicio, t.periodo_fim, t.periodo_rotulo, t.status,
      (SELECT COUNT(*) FROM matriculas m WHERE m.turma_id = t.id AND m.status IN ('ativa','concluida')) AS alunos
    FROM turmas t
    WHERE t.id = @id OR t.id IN (SELECT id FROM anteriores) OR t.id IN (SELECT id FROM seguintes)
    ORDER BY date(t.periodo_inicio), t.id
  `).all({ id: Number(id) });
  return linha.map((t) => ({ ...t, atual: Number(t.id) === Number(id) }));
}

// ============================== Matriculas ==============================

/**
 * Matricula o aluno. Se a turma estiver cheia, entra na fila de espera em vez
 * de dar erro — recusar seria perder o aluno que procurou o instituto.
 */
function matricular(turmaId, { aluno_id, observacao }) {
  const db = getDb();
  const turma = obter(turmaId);
  if (turma.status === 'encerrada' || turma.status === 'cancelada') {
    throw new AppError('Esta turma está encerrada e não aceita novas matrículas.');
  }

  const aluno = db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(aluno_id));
  if (!aluno) throw new AppError('Selecione um aluno válido.');

  const jaTem = db.prepare("SELECT * FROM matriculas WHERE turma_id = ? AND aluno_id = ? AND status IN ('ativa','espera')").get(turmaId, aluno.id);
  if (jaTem) throw new AppError(`${aluno.nome} já está ${jaTem.status === 'espera' ? 'na fila de espera' : 'matriculado'} nesta turma.`);

  // Aluno sem instrumento proprio precisa de um do acervo: confere se sobra
  // algum naquele horario antes de deixar entrar como ativo.
  const traiOProprio = instrumentos.alunoTemInstrumentoProprio(aluno.id, turma.instrumento_id);
  if (turma.instrumento_id && !traiOProprio) {
    const disp = instrumentos.vagasDisponiveis(turma.instrumento_id, turma.horarios, {
      turmaIdIgnorar: turmaId,
      instrumentosPorAluno: turma.instrumentos_por_aluno,
    });
    const usandoAcervo = turma.matriculas.filter((m) => m.status === 'ativa'
      && !instrumentos.alunoTemInstrumentoProprio(m.aluno_id, turma.instrumento_id)).length;
    if (usandoAcervo >= disp.vagas_maximas) {
      throw new AppError(
        `Não há ${disp.instrumento} disponível neste horário para ${aluno.nome}. `
        + `Os ${disp.vagas_maximas} do acervo já estão com outros alunos. `
        + 'Se o aluno tiver o próprio instrumento, marque isso no cadastro dele.'
      );
    }
  }

  const status = turma.matriculados >= turma.vagas ? 'espera' : 'ativa';
  const info = db.prepare(
    'INSERT INTO matriculas (turma_id, aluno_id, status, observacao) VALUES (?, ?, ?, ?)'
  ).run(turmaId, aluno.id, status, (observacao || '').trim() || null);

  return {
    matricula: db.prepare('SELECT * FROM matriculas WHERE id = ?').get(info.lastInsertRowid),
    entrou_na_espera: status === 'espera',
    turma: obter(turmaId),
  };
}

/**
 * Muda a situacao do aluno na turma. Ao liberar uma vaga (saida/desistencia),
 * chama automaticamente o primeiro da fila de espera.
 */
function mudarStatusMatricula(matriculaId, status, observacao) {
  const db = getDb();
  if (!STATUS_MATRICULA.includes(status)) throw new AppError('Situação de matrícula inválida.');
  const m = db.prepare('SELECT * FROM matriculas WHERE id = ?').get(matriculaId);
  if (!m) throw new AppError('Matrícula não encontrada.', 404);

  const saiu = ['desistente', 'concluida', 'trancada'].includes(status);
  db.prepare(`
    UPDATE matriculas SET status = ?, observacao = COALESCE(?, observacao),
      data_saida = CASE WHEN ? THEN date('now','localtime') ELSE NULL END
    WHERE id = ?
  `).run(status, (observacao || '').trim() || null, saiu ? 1 : 0, matriculaId);

  let promovido = null;
  if (saiu && m.status === 'ativa') promovido = chamarPrimeiroDaEspera(db, m.turma_id);

  return { turma: obter(m.turma_id), promovido };
}

/** Puxa o primeiro da fila de espera para uma vaga que abriu. */
function chamarPrimeiroDaEspera(db, turmaId) {
  const turma = db.prepare('SELECT vagas FROM turmas WHERE id = ?').get(turmaId);
  const ativos = db.prepare("SELECT COUNT(*) c FROM matriculas WHERE turma_id = ? AND status = 'ativa'").get(turmaId).c;
  if (ativos >= turma.vagas) return null;

  const proximo = db.prepare(`
    SELECT m.*, c.nome AS aluno_nome FROM matriculas m JOIN clientes c ON c.id = m.aluno_id
    WHERE m.turma_id = ? AND m.status = 'espera' ORDER BY m.id LIMIT 1
  `).get(turmaId);
  if (!proximo) return null;

  db.prepare("UPDATE matriculas SET status = 'ativa' WHERE id = ?").run(proximo.id);
  return { id: proximo.id, aluno_nome: proximo.aluno_nome };
}

function removerMatricula(matriculaId) {
  const db = getDb();
  const m = db.prepare('SELECT * FROM matriculas WHERE id = ?').get(matriculaId);
  if (!m) throw new AppError('Matrícula não encontrada.', 404);
  const temPresenca = db.prepare(`
    SELECT COUNT(*) c FROM presencas p JOIN agendamentos a ON a.id = p.agendamento_id
    WHERE a.turma_id = ? AND p.aluno_id = ?
  `).get(m.turma_id, m.aluno_id).c;
  if (temPresenca > 0) {
    throw new AppError('Este aluno já tem presença registrada nesta turma. Marque como desistente para preservar o histórico.');
  }
  db.prepare('DELETE FROM matriculas WHERE id = ?').run(matriculaId);
  const promovido = m.status === 'ativa' ? chamarPrimeiroDaEspera(db, m.turma_id) : null;
  return { turma: obter(m.turma_id), promovido };
}

// ============================ Encontros ============================

/**
 * Cria no calendario os encontros da turma para os proximos 90 dias,
 * respeitando o periodo dela. Idempotente: so cria o que ainda nao existe,
 * entao pode rodar a cada boot/edicao sem duplicar (mesmo espirito da aula
 * fixa semanal que ja existia).
 */
function gerarEncontros(turmaId, diasAFrente = 90) {
  const db = getDb();
  const turma = db.prepare('SELECT * FROM turmas WHERE id = ?').get(turmaId);
  if (!turma || !['aberta', 'planejada'].includes(turma.status)) return { geradas: 0 };

  const horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ?').all(turmaId);
  if (!horarios.length) return { geradas: 0 };

  const curso = db.prepare('SELECT nome FROM cursos WHERE id = ?').get(turma.curso_id);
  const titular = db.prepare("SELECT profissional_id FROM turmas_instrutores WHERE turma_id = ? AND papel = 'titular' LIMIT 1").get(turmaId);

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const limite = new Date(hoje);
  limite.setDate(limite.getDate() + diasAFrente);

  const jaExiste = db.prepare('SELECT 1 FROM agendamentos WHERE turma_id = ? AND data = ? AND hora_inicio = ?');
  const inserir = db.prepare(`
    INSERT INTO agendamentos (data, hora_inicio, hora_fim, profissional_id, servico_nome, valor, status, turma_id, observacao)
    VALUES (?, ?, ?, ?, ?, 0, 'agendado', ?, ?)
  `);

  let geradas = 0;
  const rodar = db.transaction(() => {
    for (let d = new Date(hoje); d <= limite; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().slice(0, 10);
      if (iso < turma.periodo_inicio) continue;
      if (turma.periodo_fim && iso > turma.periodo_fim) break;

      horarios.filter((h) => Number(h.dia_semana) === d.getDay()).forEach((h) => {
        if (jaExiste.get(turmaId, iso, h.hora_inicio)) return;
        inserir.run(iso, h.hora_inicio, h.hora_fim, titular ? titular.profissional_id : null,
          `${curso ? curso.nome : 'Aula'} — ${turma.nome}`, turmaId, turma.sala ? `Sala: ${turma.sala}` : null);
        geradas++;
      });
    }
  });
  rodar();
  return { geradas };
}

/**
 * Remove do calendario os encontros FUTUROS que nao batem mais com os
 * horarios atuais da turma (depois de o dia/hora terem sido editados).
 *
 * Nunca mexe no passado nem em encontro que ja teve chamada: o historico do
 * que realmente aconteceu vale mais que a arrumacao do calendario.
 */
function limparEncontrosForaDoHorario(turmaId) {
  const db = getDb();
  const horarios = db.prepare('SELECT * FROM turmas_horarios WHERE turma_id = ?').all(turmaId);
  const turma = db.prepare('SELECT periodo_inicio, periodo_fim FROM turmas WHERE id = ?').get(turmaId);
  const hoje = new Date().toISOString().slice(0, 10);

  const futuros = db.prepare(`
    SELECT a.id, a.data, a.hora_inicio FROM agendamentos a
    WHERE a.turma_id = ? AND a.data >= ?
      AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = a.id)
  `).all(turmaId, hoje);

  const excluir = db.prepare('DELETE FROM agendamentos WHERE id = ?');
  let removidos = 0;
  const rodar = db.transaction(() => {
    futuros.forEach((enc) => {
      const diaSemana = new Date(enc.data + 'T12:00:00').getDay();
      const casa = horarios.some((h) => Number(h.dia_semana) === diaSemana && h.hora_inicio === enc.hora_inicio);
      const dentroDoPeriodo = enc.data >= turma.periodo_inicio && (!turma.periodo_fim || enc.data <= turma.periodo_fim);
      if (!casa || !dentroDoPeriodo) { excluir.run(enc.id); removidos++; }
    });
  });
  rodar();
  return { removidos };
}

/**
 * Quem poderia cobrir este encontro se o instrutor titular faltar.
 *
 * Usa a disponibilidade que os voluntarios ja informaram no cadastro: cruza
 * o dia da semana e o horario do encontro com as faixas de cada um. Quem ja
 * e da turma aparece primeiro (conhece os alunos); quem esta ocupado em
 * outra turma no mesmo horario e descartado.
 */
function sugerirSubstitutos(agendamentoId) {
  const db = getDb();
  const enc = db.prepare(`
    SELECT a.*, t.nome AS turma_nome FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id WHERE a.id = ?
  `).get(agendamentoId);
  if (!enc) throw new AppError('Encontro não encontrado.', 404);

  const diaSemana = new Date(enc.data + 'T12:00:00').getDay();
  const horaFim = enc.hora_fim || enc.hora_inicio;

  const candidatos = db.prepare(`
    SELECT DISTINCT p.id, p.nome, p.tipo, p.telefone,
      (SELECT 1 FROM turmas_instrutores ti WHERE ti.turma_id = @turmaId AND ti.profissional_id = p.id) AS ja_e_da_turma,
      (SELECT ti.papel FROM turmas_instrutores ti WHERE ti.turma_id = @turmaId AND ti.profissional_id = p.id) AS papel
    FROM profissionais p
    JOIN voluntarios_disponibilidade d ON d.profissional_id = p.id
    WHERE p.ativo = 1
      AND d.dia_semana = @diaSemana
      AND d.hora_inicio <= @horaInicio AND d.hora_fim >= @horaFim
      AND p.id != COALESCE(@titularId, -1)
      -- descarta quem ja esta dando outra aula no mesmo horario
      AND NOT EXISTS (
        SELECT 1 FROM agendamentos o
        WHERE o.data = @data AND o.id != @agendamentoId AND o.profissional_id = p.id
          AND o.status NOT IN ('cancelado')
          AND o.hora_inicio < @horaFim AND COALESCE(o.hora_fim, o.hora_inicio) > @horaInicio
      )
    ORDER BY ja_e_da_turma DESC, p.nome
  `).all({
    turmaId: enc.turma_id,
    diaSemana,
    horaInicio: enc.hora_inicio,
    horaFim,
    titularId: enc.profissional_id,
    data: enc.data,
    agendamentoId,
  });

  return {
    encontro: {
      id: enc.id, data: enc.data, hora_inicio: enc.hora_inicio, hora_fim: enc.hora_fim,
      turma_nome: enc.turma_nome,
    },
    candidatos,
  };
}

/** Troca quem vai dar a aula neste encontro (cobertura de falta). */
function definirInstrutorDoEncontro(agendamentoId, profissionalId) {
  const db = getDb();
  const enc = db.prepare('SELECT * FROM agendamentos WHERE id = ? AND turma_id IS NOT NULL').get(agendamentoId);
  if (!enc) throw new AppError('Encontro não encontrado.', 404);
  if (profissionalId && !db.prepare('SELECT 1 FROM profissionais WHERE id = ?').get(Number(profissionalId))) {
    throw new AppError('Instrutor não encontrado.');
  }
  db.prepare('UPDATE agendamentos SET profissional_id = ? WHERE id = ?').run(profissionalId ? Number(profissionalId) : null, agendamentoId);
  return { ok: true };
}

/** Gera os encontros de todas as turmas ativas (chamado no boot do sistema). */
function gerarEncontrosPendentes() {
  const db = getDb();
  const turmas = db.prepare("SELECT id FROM turmas WHERE status IN ('aberta','planejada')").all();
  let geradas = 0;
  turmas.forEach((t) => { geradas += gerarEncontros(t.id).geradas; });
  return { geradas };
}

module.exports = {
  listar, obter, criar, atualizar, excluir,
  encerrar, renovar, historicoDaTurma,
  matricular, mudarStatusMatricula, removerMatricula,
  gerarEncontros, gerarEncontrosPendentes, limparEncontrosForaDoHorario,
  sugerirSubstitutos, definirInstrutorDoEncontro,
  comInstrumentoProprio,
  STATUS_TURMA, STATUS_MATRICULA, DIAS,
};
