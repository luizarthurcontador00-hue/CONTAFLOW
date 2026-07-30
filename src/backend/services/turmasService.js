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
function conferirAcervo(d, horarios, turmaIdIgnorar) {
  if (!d.instrumento_id || d.vagas === 0) return null;
  const disp = instrumentos.vagasDisponiveis(d.instrumento_id, horarios, {
    turmaIdIgnorar,
    instrumentosPorAluno: d.instrumentos_por_aluno,
  });
  if (d.vagas > disp.vagas_maximas) {
    const ocupando = disp.turmas_no_mesmo_horario.map((t) => t.nome).join(', ');
    throw new AppError(
      `O instituto tem ${disp.quantidade_total} ${disp.instrumento}(s) e neste horário `
      + `${disp.em_uso_no_horario} já está(ão) comprometido(s)${ocupando ? ` com: ${ocupando}` : ''}. `
      + `Esta turma comporta no máximo ${disp.vagas_maximas} aluno(s).`
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
  matricular, mudarStatusMatricula, removerMatricula,
  gerarEncontros, gerarEncontrosPendentes,
  STATUS_TURMA, STATUS_MATRICULA, DIAS,
};
