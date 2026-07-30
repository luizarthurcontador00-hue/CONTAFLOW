'use strict';

/**
 * Chamada dos encontros e os numeros de frequencia que saem dela.
 *
 * O encontro e um agendamento com turma_id preenchido (a agenda ja existente
 * serve para turma e aula individual). A chamada grava um registro por aluno
 * matriculado naquele encontro.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

const SITUACOES = ['presente', 'falta', 'justificada'];

/** Encontros de uma turma (ou de um periodo), com quantos ja tiveram chamada. */
function listarEncontros({ turma_id, de, ate } = {}) {
  const where = ['a.turma_id IS NOT NULL'];
  if (turma_id) where.push('a.turma_id = @turma_id');
  if (de) where.push('a.data >= @de');
  if (ate) where.push('a.data <= @ate');

  return getDb().prepare(`
    SELECT a.id, a.data, a.hora_inicio, a.hora_fim, a.status, a.turma_id, a.profissional_id,
      t.nome AS turma_nome, c.nome AS curso_nome, p.nome AS instrutor_nome,
      (SELECT COUNT(*) FROM presencas pr WHERE pr.agendamento_id = a.id) AS chamada_registrada,
      (SELECT COUNT(*) FROM presencas pr WHERE pr.agendamento_id = a.id AND pr.situacao = 'presente') AS presentes
    FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id
    JOIN cursos c ON c.id = t.curso_id
    LEFT JOIN profissionais p ON p.id = a.profissional_id
    WHERE ${where.join(' AND ')}
    ORDER BY a.data, a.hora_inicio
  `).all({ turma_id, de, ate });
}

/**
 * Monta a folha de chamada: todos os alunos ativos da turma, ja com o que foi
 * marcado antes (se a chamada estiver sendo revista).
 */
function folhaDeChamada(agendamentoId) {
  const db = getDb();
  const encontro = db.prepare(`
    SELECT a.*, t.nome AS turma_nome, t.sala, c.nome AS curso_nome
    FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id
    JOIN cursos c ON c.id = t.curso_id
    WHERE a.id = ?
  `).get(agendamentoId);
  if (!encontro) throw new AppError('Encontro não encontrado (ou não é uma aula de turma).', 404);

  encontro.instrutores = db.prepare(`
    SELECT p.id, p.nome, ti.papel FROM turmas_instrutores ti
    JOIN profissionais p ON p.id = ti.profissional_id
    WHERE ti.turma_id = ? ORDER BY ti.papel, p.nome
  `).all(encontro.turma_id);

  encontro.alunos = db.prepare(`
    SELECT m.aluno_id, cl.nome AS aluno_nome, cl.telefone, cl.responsavel_nome, cl.responsavel_telefone,
      pr.situacao, pr.observacao AS presenca_observacao
    FROM matriculas m
    JOIN clientes cl ON cl.id = m.aluno_id
    LEFT JOIN presencas pr ON pr.agendamento_id = @agendamentoId AND pr.aluno_id = m.aluno_id
    WHERE m.turma_id = @turmaId AND m.status = 'ativa'
    ORDER BY cl.nome
  `).all({ agendamentoId, turmaId: encontro.turma_id });

  return encontro;
}

/**
 * Grava a chamada. Recebe a lista inteira de uma vez (e como o instrutor
 * usa: marca todo mundo e salva). Quem nao vier na lista fica como estava.
 */
function registrarChamada(agendamentoId, { presencas, profissional_id }) {
  const db = getDb();
  const encontro = db.prepare('SELECT * FROM agendamentos WHERE id = ? AND turma_id IS NOT NULL').get(agendamentoId);
  if (!encontro) throw new AppError('Encontro não encontrado (ou não é uma aula de turma).', 404);
  if (!Array.isArray(presencas) || !presencas.length) throw new AppError('Nenhuma presença foi informada.');

  const matriculados = new Set(
    db.prepare("SELECT aluno_id FROM matriculas WHERE turma_id = ? AND status = 'ativa'").all(encontro.turma_id).map((m) => m.aluno_id)
  );

  const gravar = db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO presencas (agendamento_id, aluno_id, situacao, observacao)
      VALUES (@agendamento_id, @aluno_id, @situacao, @observacao)
      ON CONFLICT(agendamento_id, aluno_id) DO UPDATE SET
        situacao = excluded.situacao, observacao = excluded.observacao,
        registrado_em = datetime('now','localtime')
    `);
    presencas.forEach((p) => {
      const alunoId = Number(p.aluno_id);
      if (!matriculados.has(alunoId)) throw new AppError('Há um aluno na chamada que não está matriculado nesta turma.');
      const situacao = SITUACOES.includes(p.situacao) ? p.situacao : 'presente';
      upsert.run({
        agendamento_id: agendamentoId,
        aluno_id: alunoId,
        situacao,
        observacao: (p.observacao || '').trim() || null,
      });
    });

    // Quem deu a aula de fato pode nao ser o titular escalado.
    db.prepare("UPDATE agendamentos SET status = 'atendido', profissional_id = COALESCE(?, profissional_id) WHERE id = ?")
      .run(profissional_id ? Number(profissional_id) : null, agendamentoId);
  });
  gravar();

  return folhaDeChamada(agendamentoId);
}

/** Frequencia por aluno numa turma: quantos encontros teve, quantos foi. */
function frequenciaDaTurma(turmaId) {
  const db = getDb();
  const turma = db.prepare('SELECT t.*, c.nome AS curso_nome FROM turmas t JOIN cursos c ON c.id = t.curso_id WHERE t.id = ?').get(turmaId);
  if (!turma) throw new AppError('Turma não encontrada.', 404);

  const alunos = db.prepare(`
    SELECT cl.id AS aluno_id, cl.nome AS aluno_nome, m.status AS matricula_status,
      COUNT(pr.id) AS encontros_com_chamada,
      SUM(CASE WHEN pr.situacao = 'presente' THEN 1 ELSE 0 END) AS presencas,
      SUM(CASE WHEN pr.situacao = 'falta' THEN 1 ELSE 0 END) AS faltas,
      SUM(CASE WHEN pr.situacao = 'justificada' THEN 1 ELSE 0 END) AS justificadas
    FROM matriculas m
    JOIN clientes cl ON cl.id = m.aluno_id
    LEFT JOIN agendamentos a ON a.turma_id = m.turma_id
    LEFT JOIN presencas pr ON pr.agendamento_id = a.id AND pr.aluno_id = m.aluno_id
    WHERE m.turma_id = ? AND m.status IN ('ativa','concluida','trancada','desistente')
    GROUP BY cl.id, cl.nome, m.status
    ORDER BY cl.nome
  `).all(turmaId);

  alunos.forEach((a) => {
    const base = a.encontros_com_chamada || 0;
    a.percentual = base ? Math.round(((a.presencas || 0) / base) * 100) : null;
    a.faltas_seguidas = faltasSeguidas(db, turmaId, a.aluno_id);
  });

  return { turma, alunos };
}

/** Quantas faltas o aluno levou em sequencia ate o ultimo encontro com chamada. */
function faltasSeguidas(db, turmaId, alunoId) {
  const ultimos = db.prepare(`
    SELECT pr.situacao FROM presencas pr
    JOIN agendamentos a ON a.id = pr.agendamento_id
    WHERE a.turma_id = ? AND pr.aluno_id = ?
    ORDER BY a.data DESC, a.hora_inicio DESC
  `).all(turmaId, alunoId);

  let seguidas = 0;
  for (const p of ultimos) {
    if (p.situacao === 'falta') seguidas++;
    else break;
  }
  return seguidas;
}

/**
 * Alunos em risco de evasao: faltaram varias vezes seguidas. E o relatorio
 * que permite agir ANTES de perder o aluno.
 */
function alunosEmRisco(minimoFaltas = 3) {
  const db = getDb();
  const matriculas = db.prepare(`
    SELECT m.turma_id, m.aluno_id, cl.nome AS aluno_nome, cl.telefone,
      cl.responsavel_nome, cl.responsavel_telefone, t.nome AS turma_nome, c.nome AS curso_nome
    FROM matriculas m
    JOIN clientes cl ON cl.id = m.aluno_id
    JOIN turmas t ON t.id = m.turma_id
    JOIN cursos c ON c.id = t.curso_id
    WHERE m.status = 'ativa' AND t.status IN ('aberta','planejada')
  `).all();

  return matriculas
    .map((m) => ({ ...m, faltas_seguidas: faltasSeguidas(db, m.turma_id, m.aluno_id) }))
    .filter((m) => m.faltas_seguidas >= minimoFaltas)
    .sort((a, b) => b.faltas_seguidas - a.faltas_seguidas);
}

/**
 * Horas de voluntariado por pessoa no periodo — base da declaracao que o
 * voluntario costuma precisar.
 */
function horasVoluntariado({ de, ate } = {}) {
  return getDb().prepare(`
    SELECT p.id, p.nome, p.tipo, p.documento,
      COUNT(a.id) AS aulas_dadas,
      ROUND(SUM(
        (CAST(substr(a.hora_fim,1,2) AS REAL) * 60 + CAST(substr(a.hora_fim,4,2) AS REAL))
        - (CAST(substr(a.hora_inicio,1,2) AS REAL) * 60 + CAST(substr(a.hora_inicio,4,2) AS REAL))
      ) / 60.0, 1) AS horas
    FROM agendamentos a
    JOIN profissionais p ON p.id = a.profissional_id
    WHERE a.turma_id IS NOT NULL AND a.status = 'atendido' AND a.hora_fim IS NOT NULL
      AND (@de IS NULL OR a.data >= @de) AND (@ate IS NULL OR a.data <= @ate)
    GROUP BY p.id, p.nome, p.tipo, p.documento
    ORDER BY horas DESC, p.nome
  `).all({ de: de || null, ate: ate || null });
}

module.exports = {
  listarEncontros, folhaDeChamada, registrarChamada,
  frequenciaDaTurma, alunosEmRisco, horasVoluntariado, SITUACOES,
};
