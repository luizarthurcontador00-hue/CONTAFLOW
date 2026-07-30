'use strict';

/**
 * Acervo de instrumentos do instituto.
 *
 * O ponto principal deste modulo nao e so guardar "temos 8 violoes", e sim
 * responder QUANTAS VAGAS uma turma pode ter sem estourar o acervo. A conta
 * nao e simplesmente "total - alunos ja matriculados": dois horarios
 * diferentes reaproveitam os mesmos instrumentos (a turma da terca 19h e a da
 * quinta 15h podem usar os mesmos 8 violoes). O que limita e a SOBREPOSICAO
 * de horario — duas turmas ao mesmo tempo precisam de instrumentos separados.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

function listar({ incluir_inativos } = {}) {
  return getDb().prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM turmas t WHERE t.instrumento_id = i.id AND t.status IN ('planejada','aberta')) AS turmas_usando
    FROM instrumentos i
    ${incluir_inativos ? '' : 'WHERE i.ativo = 1'}
    ORDER BY i.nome
  `).all();
}

function obter(id) {
  const inst = getDb().prepare('SELECT * FROM instrumentos WHERE id = ?').get(id);
  if (!inst) throw new AppError('Instrumento não encontrado.', 404);
  return inst;
}

function validar(dados) {
  const nome = (dados.nome || '').trim();
  if (!nome) throw new AppError('Informe o nome do instrumento.');
  const qtd = Number(dados.quantidade_total);
  if (Number.isNaN(qtd) || qtd < 0) throw new AppError('Informe uma quantidade válida (0 ou mais).');
  return {
    nome,
    quantidade_total: Math.floor(qtd),
    observacao: (dados.observacao || '').trim() || null,
  };
}

function criar(dados) {
  const d = validar(dados);
  const info = getDb().prepare(
    'INSERT INTO instrumentos (nome, quantidade_total, observacao) VALUES (@nome, @quantidade_total, @observacao)'
  ).run(d);
  return obter(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const atual = obter(id);
  const d = validar({ ...atual, ...dados });
  const ativo = dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo;

  // Reduzir o acervo abaixo do que ja esta comprometido deixaria turmas sem
  // instrumento — avisa em vez de deixar o buraco acontecer calado.
  const pico = picoComprometido(id, null);
  if (d.quantidade_total < pico) {
    throw new AppError(
      `Já existem turmas usando ${pico} ${d.nome}(s) no mesmo horário. `
      + `Reduza as vagas dessas turmas antes de baixar o acervo para ${d.quantidade_total}.`
    );
  }

  getDb().prepare(
    'UPDATE instrumentos SET nome=@nome, quantidade_total=@quantidade_total, observacao=@observacao, ativo=@ativo WHERE id=@id'
  ).run({ ...d, ativo, id });
  return obter(id);
}

function excluir(id) {
  const db = getDb();
  obter(id);
  const emUso = db.prepare("SELECT COUNT(*) c FROM turmas WHERE instrumento_id = ? AND status IN ('planejada','aberta')").get(id).c;
  if (emUso > 0) throw new AppError('Este instrumento está sendo usado por turmas abertas. Encerre as turmas antes de excluir.');
  db.prepare('DELETE FROM instrumentos WHERE id = ?').run(id);
  return { ok: true };
}

/** Dois intervalos no mesmo dia se cruzam? (aberto nas pontas: 19-20 e 20-21 nao colidem) */
function horariosColidem(a, b) {
  return Number(a.dia_semana) === Number(b.dia_semana)
    && String(a.hora_inicio) < String(b.hora_fim)
    && String(b.hora_inicio) < String(a.hora_fim);
}

/** Horarios de todas as turmas ativas que consomem este instrumento (fora a turma ignorada). */
function horariosComprometidos(instrumentoId, turmaIdIgnorar) {
  return getDb().prepare(`
    SELECT h.dia_semana, h.hora_inicio, h.hora_fim,
           t.id AS turma_id, t.nome AS turma_nome,
           (t.vagas * t.instrumentos_por_aluno) AS consumo
    FROM turmas_horarios h
    JOIN turmas t ON t.id = h.turma_id
    WHERE t.instrumento_id = @instrumentoId
      AND t.status IN ('planejada','aberta')
      AND (@turmaIdIgnorar IS NULL OR t.id != @turmaIdIgnorar)
  `).all({ instrumentoId, turmaIdIgnorar: turmaIdIgnorar || null });
}

/** Maior consumo simultaneo ja comprometido para o instrumento (em qualquer horario). */
function picoComprometido(instrumentoId, turmaIdIgnorar) {
  const usos = horariosComprometidos(instrumentoId, turmaIdIgnorar);
  let pico = 0;
  usos.forEach((base) => {
    const simultaneo = usos
      .filter((outro) => horariosColidem(base, outro))
      .reduce((soma, o) => soma + Number(o.consumo || 0), 0);
    if (simultaneo > pico) pico = simultaneo;
  });
  return pico;
}

/**
 * Quantas vagas cabem numa turma que use este instrumento nestes horarios.
 * Devolve tambem quem esta ocupando, para a tela poder explicar o limite em
 * vez de so mostrar um numero.
 */
function vagasDisponiveis(instrumentoId, horarios, { turmaIdIgnorar, instrumentosPorAluno = 1 } = {}) {
  const inst = obter(instrumentoId);
  const porAluno = Math.max(1, Number(instrumentosPorAluno) || 1);
  const usos = horariosComprometidos(instrumentoId, turmaIdIgnorar);

  let maiorConflito = 0;
  const conflitantes = new Map();
  (horarios || []).forEach((h) => {
    const noMesmoHorario = usos.filter((u) => horariosColidem(h, u));
    const soma = noMesmoHorario.reduce((s, u) => s + Number(u.consumo || 0), 0);
    if (soma > maiorConflito) maiorConflito = soma;
    noMesmoHorario.forEach((u) => conflitantes.set(u.turma_id, { turma_id: u.turma_id, nome: u.turma_nome, consumo: u.consumo }));
  });

  const livres = Math.max(0, inst.quantidade_total - maiorConflito);
  return {
    instrumento: inst.nome,
    quantidade_total: inst.quantidade_total,
    em_uso_no_horario: maiorConflito,
    instrumentos_livres: livres,
    vagas_maximas: Math.floor(livres / porAluno),
    turmas_no_mesmo_horario: Array.from(conflitantes.values()),
  };
}

module.exports = {
  listar, obter, criar, atualizar, excluir,
  vagasDisponiveis, picoComprometido, horariosColidem,
};
