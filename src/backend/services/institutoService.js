'use strict';

/**
 * Documentos e prestacao de contas institucional: atas de reuniao, termos de
 * autorizacao dos alunos menores e o relatorio de impacto do periodo.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

// ================================ Atas ================================

function listarAtas({ de, ate } = {}) {
  const where = [];
  if (de) where.push('a.data >= @de');
  if (ate) where.push('a.data <= @ate');
  return getDb().prepare(`
    SELECT a.*, (SELECT COUNT(*) FROM atas_participantes p WHERE p.ata_id = a.id AND p.presente = 1) AS presentes
    FROM atas a
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY a.data DESC, a.id DESC
  `).all({ de, ate });
}

function obterAta(id) {
  const db = getDb();
  const ata = db.prepare('SELECT * FROM atas WHERE id = ?').get(id);
  if (!ata) throw new AppError('Ata não encontrada.', 404);
  ata.participantes = db.prepare('SELECT * FROM atas_participantes WHERE ata_id = ? ORDER BY nome').all(id);
  return ata;
}

function validarAta(dados) {
  const titulo = (dados.titulo || '').trim();
  if (!titulo) throw new AppError('Informe o título da reunião.');
  const data = String(dados.data || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new AppError('Informe a data da reunião.');
  return {
    titulo,
    data,
    hora: (dados.hora || '').trim() || null,
    local: (dados.local || '').trim() || null,
    pauta: (dados.pauta || '').trim() || null,
    deliberacoes: (dados.deliberacoes || '').trim() || null,
    observacao: (dados.observacao || '').trim() || null,
  };
}

/** Grava os participantes guardando o NOME, para a ata continuar íntegra se o membro sair depois. */
function gravarParticipantes(db, ataId, participantes) {
  db.prepare('DELETE FROM atas_participantes WHERE ata_id = ?').run(ataId);
  const ins = db.prepare('INSERT INTO atas_participantes (ata_id, membro_id, nome, presente) VALUES (?, ?, ?, ?)');
  (participantes || []).forEach((p) => {
    const membroId = p.membro_id ? Number(p.membro_id) : null;
    let nome = (p.nome || '').trim();
    if (!nome && membroId) {
      const m = db.prepare('SELECT nome FROM membros_instituto WHERE id = ?').get(membroId);
      nome = m ? m.nome : '';
    }
    if (!nome) return;
    ins.run(ataId, membroId, nome, p.presente === false ? 0 : 1);
  });
}

function criarAta(dados) {
  const db = getDb();
  const d = validarAta(dados);
  const salvar = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO atas (titulo, data, hora, local, pauta, deliberacoes, observacao)
      VALUES (@titulo, @data, @hora, @local, @pauta, @deliberacoes, @observacao)
    `).run(d);
    gravarParticipantes(db, info.lastInsertRowid, dados.participantes);
    return info.lastInsertRowid;
  });
  return obterAta(salvar());
}

function atualizarAta(id, dados) {
  const db = getDb();
  const atual = obterAta(id);
  const d = validarAta({ ...atual, ...dados });
  const salvar = db.transaction(() => {
    db.prepare(`
      UPDATE atas SET titulo=@titulo, data=@data, hora=@hora, local=@local,
        pauta=@pauta, deliberacoes=@deliberacoes, observacao=@observacao WHERE id=@id
    `).run({ ...d, id });
    if (dados.participantes) gravarParticipantes(db, id, dados.participantes);
  });
  salvar();
  return obterAta(id);
}

function excluirAta(id) {
  obterAta(id);
  getDb().prepare('DELETE FROM atas WHERE id = ?').run(id);
  return { ok: true };
}

// ============================ Autorizacoes ============================

const TIPOS_AUTORIZACAO = ['imagem', 'saida', 'outro'];

/**
 * Alunos ativos com a situacao de cada termo. Foca nos menores de idade,
 * que sao os que realmente precisam de autorizacao do responsavel.
 */
function listarAutorizacoes({ somente_pendentes, tipo } = {}) {
  const t = TIPOS_AUTORIZACAO.includes(tipo) ? tipo : 'imagem';
  const linhas = getDb().prepare(`
    SELECT c.id AS aluno_id, c.nome AS aluno_nome, c.data_nascimento,
      c.responsavel_nome, c.responsavel_telefone,
      a.id AS autorizacao_id, a.entregue, a.data_entrega, a.observacao,
      CAST((julianday('now','localtime') - julianday(c.data_nascimento)) / 365.25 AS INTEGER) AS idade
    FROM clientes c
    LEFT JOIN autorizacoes a ON a.aluno_id = c.id AND a.tipo = @tipo
    WHERE c.ativo = 1
      AND EXISTS (SELECT 1 FROM matriculas m WHERE m.aluno_id = c.id AND m.status = 'ativa')
    ORDER BY (a.entregue IS NULL OR a.entregue = 0) DESC, c.nome
  `).all({ tipo: t });

  const comMenor = linhas.map((l) => ({ ...l, menor_de_idade: l.idade != null && l.idade < 18, tipo: t }));
  return somente_pendentes ? comMenor.filter((l) => !l.entregue) : comMenor;
}

function registrarAutorizacao(alunoId, { tipo, entregue, data_entrega, observacao }) {
  const db = getDb();
  const t = TIPOS_AUTORIZACAO.includes(tipo) ? tipo : 'imagem';
  if (!db.prepare('SELECT 1 FROM clientes WHERE id = ?').get(alunoId)) throw new AppError('Aluno não encontrado.', 404);

  db.prepare(`
    INSERT INTO autorizacoes (aluno_id, tipo, entregue, data_entrega, observacao)
    VALUES (@aluno_id, @tipo, @entregue, @data_entrega, @observacao)
    ON CONFLICT(aluno_id, tipo) DO UPDATE SET
      entregue = excluded.entregue, data_entrega = excluded.data_entrega, observacao = excluded.observacao
  `).run({
    aluno_id: Number(alunoId),
    tipo: t,
    entregue: entregue ? 1 : 0,
    data_entrega: entregue ? (String(data_entrega || '').trim() || new Date().toISOString().slice(0, 10)) : null,
    observacao: (observacao || '').trim() || null,
  });
  return getDb().prepare('SELECT * FROM autorizacoes WHERE aluno_id = ? AND tipo = ?').get(alunoId, t);
}

// ========================= Relatorio de impacto =========================

/**
 * O retrato do periodo para mantenedor, parceiro e edital: quantas pessoas
 * foram atendidas, quantas aulas aconteceram, quantas horas foram doadas e
 * como esta distribuido por curso e faixa etaria.
 */
function relatorioImpacto({ de, ate } = {}) {
  const db = getDb();
  const p = { de: de || null, ate: ate || null };

  const geral = db.prepare(`
    SELECT
      COUNT(DISTINCT pr.aluno_id) AS alunos_atendidos,
      COUNT(DISTINCT a.id) AS aulas_realizadas,
      COUNT(DISTINCT a.turma_id) AS turmas_ativas
    FROM presencas pr
    JOIN agendamentos a ON a.id = pr.agendamento_id
    WHERE pr.situacao = 'presente'
      AND (@de IS NULL OR a.data >= @de) AND (@ate IS NULL OR a.data <= @ate)
  `).get(p);

  const porCurso = db.prepare(`
    SELECT c.nome AS curso, c.categoria,
      COUNT(DISTINCT pr.aluno_id) AS alunos,
      COUNT(DISTINCT a.id) AS aulas
    FROM presencas pr
    JOIN agendamentos a ON a.id = pr.agendamento_id
    JOIN turmas t ON t.id = a.turma_id
    JOIN cursos c ON c.id = t.curso_id
    WHERE pr.situacao = 'presente'
      AND (@de IS NULL OR a.data >= @de) AND (@ate IS NULL OR a.data <= @ate)
    GROUP BY c.id, c.nome, c.categoria
    ORDER BY alunos DESC
  `).all(p);

  const faixas = db.prepare(`
    SELECT
      SUM(CASE WHEN idade < 12 THEN 1 ELSE 0 END) AS ate_11,
      SUM(CASE WHEN idade BETWEEN 12 AND 17 THEN 1 ELSE 0 END) AS de_12_a_17,
      SUM(CASE WHEN idade BETWEEN 18 AND 59 THEN 1 ELSE 0 END) AS de_18_a_59,
      SUM(CASE WHEN idade >= 60 THEN 1 ELSE 0 END) AS de_60_ou_mais,
      SUM(CASE WHEN idade IS NULL THEN 1 ELSE 0 END) AS sem_data_nascimento
    FROM (
      SELECT DISTINCT pr.aluno_id,
        CAST((julianday('now','localtime') - julianday(c.data_nascimento)) / 365.25 AS INTEGER) AS idade
      FROM presencas pr
      JOIN agendamentos a ON a.id = pr.agendamento_id
      JOIN clientes c ON c.id = pr.aluno_id
      WHERE pr.situacao = 'presente'
        AND (@de IS NULL OR a.data >= @de) AND (@ate IS NULL OR a.data <= @ate)
    )
  `).get(p);

  // eslint-disable-next-line global-require
  const presencas = require('./presencasService');
  const voluntarios = presencas.horasVoluntariado({ de, ate });

  const frequenciaMedia = db.prepare(`
    SELECT ROUND(100.0 * SUM(CASE WHEN pr.situacao = 'presente' THEN 1 ELSE 0 END) / COUNT(*), 0) AS media
    FROM presencas pr
    JOIN agendamentos a ON a.id = pr.agendamento_id
    WHERE (@de IS NULL OR a.data >= @de) AND (@ate IS NULL OR a.data <= @ate)
  `).get(p);

  return {
    periodo: { de: de || null, ate: ate || null },
    alunos_atendidos: geral.alunos_atendidos || 0,
    aulas_realizadas: geral.aulas_realizadas || 0,
    turmas_ativas: geral.turmas_ativas || 0,
    frequencia_media: frequenciaMedia.media,
    por_curso: porCurso,
    faixa_etaria: faixas,
    voluntarios: {
      quantidade: voluntarios.length,
      horas_totais: Number(voluntarios.reduce((s, v) => s + Number(v.horas || 0), 0).toFixed(1)),
      lista: voluntarios,
    },
  };
}

module.exports = {
  listarAtas, obterAta, criarAta, atualizarAta, excluirAta,
  listarAutorizacoes, registrarAutorizacao, TIPOS_AUTORIZACAO,
  relatorioImpacto,
};
