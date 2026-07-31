'use strict';

/**
 * Lista de espera geral do instituto: quem procurou quando ainda nao havia
 * turma aberta daquele curso.
 *
 * Diferente da fila de espera DE UMA TURMA (que fica em matriculas), esta
 * lista e por CURSO — a pessoa quer aprender violao, nao importa em qual
 * turma. Quando uma turma nova do curso abre, o sistema mostra quem ja tinha
 * procurado, em ordem de chegada.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

const STATUS = ['aguardando', 'contatado', 'matriculado', 'desistiu'];

function listar({ curso_id, status } = {}) {
  const where = [];
  if (curso_id) where.push('e.curso_id = @curso_id');
  if (status) where.push('e.status = @status');

  return getDb().prepare(`
    SELECT e.*,
      COALESCE(cl.nome, e.nome) AS pessoa_nome,
      COALESCE(cl.telefone, e.telefone) AS pessoa_telefone,
      COALESCE(cl.responsavel_nome, e.responsavel_nome) AS pessoa_responsavel,
      cl.responsavel_telefone,
      c.nome AS curso_nome, c.categoria AS curso_categoria,
      CAST(julianday('now','localtime') - julianday(e.criado_em) AS INTEGER) AS dias_esperando
    FROM lista_espera e
    LEFT JOIN clientes cl ON cl.id = e.aluno_id
    LEFT JOIN cursos c ON c.id = e.curso_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (e.status != 'aguardando'), e.criado_em
  `).all({ curso_id, status });
}

function obter(id) {
  const item = getDb().prepare('SELECT * FROM lista_espera WHERE id = ?').get(id);
  if (!item) throw new AppError('Interessado não encontrado na lista de espera.', 404);
  return item;
}

function validar(dados) {
  const db = getDb();
  const alunoId = dados.aluno_id ? Number(dados.aluno_id) : null;
  const nome = (dados.nome || '').trim() || null;
  if (!alunoId && !nome) throw new AppError('Informe quem tem interesse (um aluno cadastrado ou o nome da pessoa).');

  const cursoId = Number(dados.curso_id);
  if (!db.prepare('SELECT 1 FROM cursos WHERE id = ?').get(cursoId)) {
    throw new AppError('Selecione um curso válido.');
  }

  return {
    aluno_id: alunoId,
    nome,
    telefone: (dados.telefone || '').trim() || null,
    responsavel_nome: (dados.responsavel_nome || '').trim() || null,
    curso_id: cursoId,
    preferencia: (dados.preferencia || '').trim() || null,
    observacao: (dados.observacao || '').trim() || null,
  };
}

function adicionar(dados) {
  const db = getDb();
  const d = validar(dados);

  // Nao deixa a mesma pessoa entrar duas vezes no mesmo curso.
  if (d.aluno_id) {
    const ja = db.prepare("SELECT 1 FROM lista_espera WHERE aluno_id = ? AND curso_id = ? AND status IN ('aguardando','contatado')")
      .get(d.aluno_id, d.curso_id);
    if (ja) throw new AppError('Esta pessoa já está na lista de espera deste curso.');
  }

  const info = db.prepare(`
    INSERT INTO lista_espera (aluno_id, nome, telefone, responsavel_nome, curso_id, preferencia, observacao)
    VALUES (@aluno_id, @nome, @telefone, @responsavel_nome, @curso_id, @preferencia, @observacao)
  `).run(d);
  return obter(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const atual = obter(id);
  const d = validar({ ...atual, ...dados });
  getDb().prepare(`
    UPDATE lista_espera SET aluno_id=@aluno_id, nome=@nome, telefone=@telefone,
      responsavel_nome=@responsavel_nome, curso_id=@curso_id, preferencia=@preferencia, observacao=@observacao
    WHERE id=@id
  `).run({ ...d, id });
  return obter(id);
}

function mudarStatus(id, status, observacao) {
  const db = getDb();
  if (!STATUS.includes(status)) throw new AppError('Situação inválida.');
  obter(id);
  db.prepare(`
    UPDATE lista_espera SET status = ?, observacao = COALESCE(?, observacao),
      contatado_em = CASE WHEN ? = 'contatado' THEN date('now','localtime') ELSE contatado_em END
    WHERE id = ?
  `).run(status, (observacao || '').trim() || null, status, id);
  return obter(id);
}

function excluir(id) {
  obter(id);
  getDb().prepare('DELETE FROM lista_espera WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Matricula direto da lista de espera: cria a matricula na turma e marca o
 * interessado como matriculado, fechando o ciclo sem redigitar nada.
 */
function matricularNaTurma(id, turmaId) {
  const db = getDb();
  const item = obter(id);
  if (!item.aluno_id) {
    throw new AppError('Esta pessoa ainda não tem cadastro. Cadastre-a em Pessoas antes de matricular.');
  }

  // eslint-disable-next-line global-require
  const turmas = require('./turmasService');
  const r = turmas.matricular(turmaId, { aluno_id: item.aluno_id, observacao: 'Veio da lista de espera' });

  db.prepare("UPDATE lista_espera SET status = 'matriculado', matricula_id = ? WHERE id = ?")
    .run(r.matricula.id, id);

  return { ...r, lista_espera: obter(id) };
}

/**
 * Ao abrir turma nova, quem ja tinha procurado por aquele curso.
 * E o que transforma a lista numa ferramenta de captacao, e nao num
 * cemiterio de contatos.
 */
function interessadosDoCurso(cursoId) {
  return listar({ curso_id: cursoId, status: 'aguardando' });
}

/** Resumo por curso, para o sino de avisos: onde ha gente esperando. */
function resumoPorCurso() {
  return getDb().prepare(`
    SELECT c.id AS curso_id, c.nome AS curso_nome, COUNT(*) AS aguardando,
      MIN(e.criado_em) AS espera_desde,
      (SELECT COUNT(*) FROM turmas t WHERE t.curso_id = c.id AND t.status IN ('aberta','planejada')) AS turmas_abertas
    FROM lista_espera e
    JOIN cursos c ON c.id = e.curso_id
    WHERE e.status = 'aguardando'
    GROUP BY c.id, c.nome
    ORDER BY aguardando DESC
  `).all();
}

module.exports = {
  listar, obter, adicionar, atualizar, mudarStatus, excluir,
  matricularNaTurma, interessadosDoCurso, resumoPorCurso, STATUS,
};
