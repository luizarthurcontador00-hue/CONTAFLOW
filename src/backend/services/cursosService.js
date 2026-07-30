'use strict';

/**
 * Cursos / modalidades oferecidas pelo instituto (Violão, Teclado,
 * Informática básica, Reforço de matemática...). O curso e o "molde"; quem
 * tem dia, hora, instrutor e alunos e a turma.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

const CATEGORIAS = ['musica', 'informatica', 'reforco', 'outro'];

function listar({ categoria, incluir_inativos } = {}) {
  const where = [];
  if (categoria) where.push('c.categoria = @categoria');
  if (!incluir_inativos) where.push('c.ativo = 1');

  return getDb().prepare(`
    SELECT c.*,
      (SELECT COUNT(*) FROM turmas t WHERE t.curso_id = c.id AND t.status IN ('planejada','aberta')) AS turmas_abertas
    FROM cursos c
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY c.categoria, c.nome
  `).all({ categoria });
}

function obter(id) {
  const curso = getDb().prepare('SELECT * FROM cursos WHERE id = ?').get(id);
  if (!curso) throw new AppError('Curso não encontrado.', 404);
  return curso;
}

function validar(dados) {
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome do curso.');
  const categoria = CATEGORIAS.includes(dados.categoria) ? dados.categoria : 'outro';
  const carga = dados.carga_horaria === '' || dados.carga_horaria == null ? null : Number(dados.carga_horaria);
  if (carga != null && (Number.isNaN(carga) || carga < 0)) throw new AppError('Carga horária inválida.');
  return {
    nome,
    categoria,
    descricao: (dados.descricao || '').trim() || null,
    carga_horaria: carga,
  };
}

function criar(dados) {
  const d = validar(dados);
  const info = getDb().prepare(
    'INSERT INTO cursos (nome, categoria, descricao, carga_horaria) VALUES (@nome, @categoria, @descricao, @carga_horaria)'
  ).run(d);
  return obter(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const atual = obter(id);
  const d = validar({ ...atual, ...dados });
  const ativo = dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo;
  getDb().prepare(`
    UPDATE cursos SET nome=@nome, categoria=@categoria, descricao=@descricao,
      carga_horaria=@carga_horaria, ativo=@ativo WHERE id=@id
  `).run({ ...d, ativo, id });
  return obter(id);
}

/** Curso com turma nao pode sumir (levaria as turmas junto): so e desativado. */
function excluir(id) {
  const db = getDb();
  obter(id);
  const turmas = db.prepare('SELECT COUNT(*) c FROM turmas WHERE curso_id = ?').get(id).c;
  if (turmas > 0) {
    db.prepare('UPDATE cursos SET ativo = 0 WHERE id = ?').run(id);
    return { ok: true, desativado: true, turmas };
  }
  db.prepare('DELETE FROM cursos WHERE id = ?').run(id);
  return { ok: true, desativado: false };
}

module.exports = { listar, obter, criar, atualizar, excluir, CATEGORIAS };
