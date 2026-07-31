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
      (SELECT COUNT(*) FROM turmas_instrumentos ti JOIN turmas t ON t.id = ti.turma_id
        WHERE ti.instrumento_id = i.id AND t.status IN ('planejada','aberta')) AS turmas_usando,
      (SELECT COUNT(*) FROM instrumentos_unidades u WHERE u.instrumento_id = i.id) AS unidades_cadastradas,
      (SELECT COUNT(*) FROM instrumentos_unidades u WHERE u.instrumento_id = i.id AND u.estado = 'emprestado') AS emprestados,
      (SELECT COUNT(*) FROM instrumentos_unidades u WHERE u.instrumento_id = i.id AND u.estado IN ('manutencao','baixado')) AS fora_de_uso
    FROM instrumentos i
    ${incluir_inativos ? '' : 'WHERE i.ativo = 1'}
    ORDER BY i.nome
  `).all().map((i) => ({ ...i, disponivel_para_turmas: disponivelParaTurmas(i) }));
}

/**
 * Quantos instrumentos deste tipo estao de fato disponiveis para usar em
 * aula. Unidade emprestada (aluno levou para casa), em manutencao ou baixada
 * sai da conta — senao a turma seria montada contando com instrumento que
 * nao esta no instituto.
 */
function disponivelParaTurmas(inst) {
  const indisponiveis = Number(inst.emprestados || 0) + Number(inst.fora_de_uso || 0);
  return Math.max(0, Number(inst.quantidade_total || 0) - indisponiveis);
}

function contarIndisponiveis(instrumentoId) {
  const r = getDb().prepare(`
    SELECT
      SUM(CASE WHEN estado = 'emprestado' THEN 1 ELSE 0 END) AS emprestados,
      SUM(CASE WHEN estado IN ('manutencao','baixado') THEN 1 ELSE 0 END) AS fora_de_uso
    FROM instrumentos_unidades WHERE instrumento_id = ?
  `).get(instrumentoId);
  return { emprestados: r.emprestados || 0, fora_de_uso: r.fora_de_uso || 0 };
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
  const emUso = db.prepare(`
    SELECT COUNT(*) c FROM turmas_instrumentos ti JOIN turmas t ON t.id = ti.turma_id
    WHERE ti.instrumento_id = ? AND t.status IN ('planejada','aberta')
  `).get(id).c;
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
    JOIN turmas_instrumentos ti ON ti.turma_id = t.id AND ti.instrumento_id = @instrumentoId
    WHERE t.status IN ('planejada','aberta')
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
  const { emprestados, fora_de_uso: foraDeUso } = contarIndisponiveis(instrumentoId);
  const noInstituto = Math.max(0, inst.quantidade_total - emprestados - foraDeUso);

  let maiorConflito = 0;
  const conflitantes = new Map();
  (horarios || []).forEach((h) => {
    const noMesmoHorario = usos.filter((u) => horariosColidem(h, u));
    const soma = noMesmoHorario.reduce((s, u) => s + Number(u.consumo || 0), 0);
    if (soma > maiorConflito) maiorConflito = soma;
    noMesmoHorario.forEach((u) => conflitantes.set(u.turma_id, { turma_id: u.turma_id, nome: u.turma_nome, consumo: u.consumo }));
  });

  const livres = Math.max(0, noInstituto - maiorConflito);
  return {
    instrumento: inst.nome,
    quantidade_total: inst.quantidade_total,
    emprestados,
    fora_de_uso: foraDeUso,
    disponivel_no_instituto: noInstituto,
    em_uso_no_horario: maiorConflito,
    instrumentos_livres: livres,
    vagas_maximas: Math.floor(livres / porAluno),
    turmas_no_mesmo_horario: Array.from(conflitantes.values()),
  };
}

// ======================= Unidades (patrimonio) =======================

const ESTADOS_UNIDADE = ['disponivel', 'emprestado', 'manutencao', 'baixado'];

function listarUnidades(instrumentoId) {
  return getDb().prepare(`
    SELECT u.*,
      e.id AS emprestimo_id, e.data_emprestimo, e.previsao_devolucao,
      c.id AS aluno_id, c.nome AS aluno_nome, c.telefone AS aluno_telefone
    FROM instrumentos_unidades u
    LEFT JOIN emprestimos_instrumento e ON e.unidade_id = u.id AND e.data_devolucao IS NULL
    LEFT JOIN clientes c ON c.id = e.aluno_id
    WHERE u.instrumento_id = ?
    ORDER BY u.numero
  `).all(instrumentoId);
}

function criarUnidade(instrumentoId, { numero, observacao }) {
  obter(instrumentoId);
  const n = String(numero || '').trim();
  if (!n) throw new AppError('Informe o número/identificação da unidade.');
  try {
    const info = getDb().prepare(
      'INSERT INTO instrumentos_unidades (instrumento_id, numero, observacao) VALUES (?, ?, ?)'
    ).run(instrumentoId, n, (observacao || '').trim() || null);
    return getDb().prepare('SELECT * FROM instrumentos_unidades WHERE id = ?').get(info.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new AppError(`Já existe uma unidade com o número "${n}" para este instrumento.`);
    throw e;
  }
}

/**
 * Cria as unidades numeradas de uma vez (01, 02, 03...), para quem tem 8
 * violoes e nao quer cadastrar um por um. Pula os numeros que ja existem.
 */
function gerarUnidades(instrumentoId, quantidade) {
  const db = getDb();
  obter(instrumentoId);
  const qtd = Math.floor(Number(quantidade) || 0);
  if (qtd <= 0) throw new AppError('Informe quantas unidades gerar.');

  const existentes = new Set(db.prepare('SELECT numero FROM instrumentos_unidades WHERE instrumento_id = ?').all(instrumentoId).map((u) => u.numero));
  const ins = db.prepare('INSERT INTO instrumentos_unidades (instrumento_id, numero) VALUES (?, ?)');
  let criadas = 0;
  const rodar = db.transaction(() => {
    for (let i = 1; criadas < qtd && i <= qtd + existentes.size + 50; i++) {
      const numero = String(i).padStart(2, '0');
      if (existentes.has(numero)) continue;
      ins.run(instrumentoId, numero);
      criadas++;
    }
  });
  rodar();
  return { criadas };
}

function atualizarUnidade(unidadeId, dados) {
  const db = getDb();
  const u = db.prepare('SELECT * FROM instrumentos_unidades WHERE id = ?').get(unidadeId);
  if (!u) throw new AppError('Unidade não encontrada.', 404);

  const estado = dados.estado !== undefined
    ? (ESTADOS_UNIDADE.includes(dados.estado) ? dados.estado : u.estado)
    : u.estado;

  // "emprestado" e consequencia de um emprestimo aberto, nao se marca a mao.
  if (estado === 'emprestado' && u.estado !== 'emprestado') {
    throw new AppError('Para marcar como emprestado, registre o empréstimo para um aluno.');
  }
  if (u.estado === 'emprestado' && estado !== 'emprestado') {
    throw new AppError('Esta unidade está emprestada. Registre a devolução antes de mudar o estado.');
  }

  db.prepare('UPDATE instrumentos_unidades SET numero=?, estado=?, observacao=? WHERE id=?').run(
    dados.numero !== undefined ? String(dados.numero).trim() : u.numero,
    estado,
    dados.observacao !== undefined ? ((dados.observacao || '').trim() || null) : u.observacao,
    unidadeId
  );
  return db.prepare('SELECT * FROM instrumentos_unidades WHERE id = ?').get(unidadeId);
}

function excluirUnidade(unidadeId) {
  const db = getDb();
  const u = db.prepare('SELECT * FROM instrumentos_unidades WHERE id = ?').get(unidadeId);
  if (!u) throw new AppError('Unidade não encontrada.', 404);
  if (u.estado === 'emprestado') throw new AppError('Esta unidade está emprestada. Registre a devolução antes de excluir.');
  const teveEmprestimo = db.prepare('SELECT 1 FROM emprestimos_instrumento WHERE unidade_id = ? LIMIT 1').get(unidadeId);
  if (teveEmprestimo) {
    db.prepare("UPDATE instrumentos_unidades SET estado = 'baixado' WHERE id = ?").run(unidadeId);
    return { ok: true, baixado: true };
  }
  db.prepare('DELETE FROM instrumentos_unidades WHERE id = ?').run(unidadeId);
  return { ok: true, baixado: false };
}

// ========================== Emprestimos ==========================

function listarEmprestimos({ abertos, aluno_id, instrumento_id } = {}) {
  const where = [];
  if (abertos) where.push('e.data_devolucao IS NULL');
  if (aluno_id) where.push('e.aluno_id = @aluno_id');
  if (instrumento_id) where.push('u.instrumento_id = @instrumento_id');

  return getDb().prepare(`
    SELECT e.*, u.numero, u.instrumento_id, i.nome AS instrumento_nome,
      c.nome AS aluno_nome, c.telefone AS aluno_telefone,
      c.responsavel_nome, c.responsavel_telefone,
      CASE WHEN e.data_devolucao IS NULL AND e.previsao_devolucao IS NOT NULL
             AND e.previsao_devolucao < date('now','localtime')
           THEN 1 ELSE 0 END AS atrasado
    FROM emprestimos_instrumento e
    JOIN instrumentos_unidades u ON u.id = e.unidade_id
    JOIN instrumentos i ON i.id = u.instrumento_id
    JOIN clientes c ON c.id = e.aluno_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (e.data_devolucao IS NOT NULL), e.data_emprestimo DESC
  `).all({ aluno_id, instrumento_id });
}

function emprestar({ unidade_id, aluno_id, data_emprestimo, previsao_devolucao, observacao_saida }) {
  const db = getDb();
  const u = db.prepare('SELECT * FROM instrumentos_unidades WHERE id = ?').get(Number(unidade_id));
  if (!u) throw new AppError('Selecione uma unidade válida do instrumento.');
  if (u.estado === 'emprestado') throw new AppError('Esta unidade já está emprestada.');
  if (u.estado === 'manutencao') throw new AppError('Esta unidade está em manutenção e não pode ser emprestada.');
  if (u.estado === 'baixado') throw new AppError('Esta unidade foi baixada do acervo.');

  const aluno = db.prepare('SELECT * FROM clientes WHERE id = ?').get(Number(aluno_id));
  if (!aluno) throw new AppError('Selecione um aluno válido.');

  const data = String(data_emprestimo || '').trim() || new Date().toISOString().slice(0, 10);
  const previsao = String(previsao_devolucao || '').trim() || null;
  if (previsao && previsao < data) throw new AppError('A previsão de devolução não pode ser antes da data do empréstimo.');

  const registrar = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO emprestimos_instrumento (unidade_id, aluno_id, data_emprestimo, previsao_devolucao, observacao_saida)
      VALUES (?, ?, ?, ?, ?)
    `).run(u.id, aluno.id, data, previsao, (observacao_saida || '').trim() || null);
    db.prepare("UPDATE instrumentos_unidades SET estado = 'emprestado' WHERE id = ?").run(u.id);
    return info.lastInsertRowid;
  });
  const id = registrar();
  return listarEmprestimos({}).find((e) => e.id === id);
}

function devolver(emprestimoId, { data_devolucao, observacao_retorno, para_manutencao } = {}) {
  const db = getDb();
  const e = db.prepare('SELECT * FROM emprestimos_instrumento WHERE id = ?').get(emprestimoId);
  if (!e) throw new AppError('Empréstimo não encontrado.', 404);
  if (e.data_devolucao) throw new AppError('Este empréstimo já foi devolvido.');

  const data = String(data_devolucao || '').trim() || new Date().toISOString().slice(0, 10);
  if (data < e.data_emprestimo) throw new AppError('A devolução não pode ser antes da data do empréstimo.');

  const registrar = db.transaction(() => {
    db.prepare('UPDATE emprestimos_instrumento SET data_devolucao = ?, observacao_retorno = ? WHERE id = ?')
      .run(data, (observacao_retorno || '').trim() || null, emprestimoId);
    db.prepare('UPDATE instrumentos_unidades SET estado = ? WHERE id = ?')
      .run(para_manutencao ? 'manutencao' : 'disponivel', e.unidade_id);
  });
  registrar();
  return { ok: true, para_manutencao: !!para_manutencao };
}

// =================== Instrumento proprio do aluno ===================

function instrumentosProprios(alunoId) {
  return getDb().prepare(`
    SELECT p.*, i.nome AS instrumento_nome
    FROM alunos_instrumentos_proprios p JOIN instrumentos i ON i.id = p.instrumento_id
    WHERE p.aluno_id = ? ORDER BY i.nome
  `).all(alunoId);
}

/** Define de quais instrumentos o aluno tem exemplar proprio (lista completa). */
function definirInstrumentosProprios(alunoId, instrumentoIds) {
  const db = getDb();
  const salvar = db.transaction(() => {
    db.prepare('DELETE FROM alunos_instrumentos_proprios WHERE aluno_id = ?').run(alunoId);
    const ins = db.prepare('INSERT OR IGNORE INTO alunos_instrumentos_proprios (aluno_id, instrumento_id) VALUES (?, ?)');
    (instrumentoIds || []).forEach((id) => { if (Number(id)) ins.run(alunoId, Number(id)); });
  });
  salvar();
  return instrumentosProprios(alunoId);
}

function alunoTemInstrumentoProprio(alunoId, instrumentoId) {
  if (!instrumentoId) return true; // turma que nao usa instrumento nao consome acervo
  return !!getDb().prepare('SELECT 1 FROM alunos_instrumentos_proprios WHERE aluno_id = ? AND instrumento_id = ?')
    .get(alunoId, instrumentoId);
}

module.exports = {
  listar, obter, criar, atualizar, excluir,
  vagasDisponiveis, picoComprometido, horariosColidem, contarIndisponiveis,
  listarUnidades, criarUnidade, gerarUnidades, atualizarUnidade, excluirUnidade,
  listarEmprestimos, emprestar, devolver,
  instrumentosProprios, definirInstrumentosProprios, alunoTemInstrumentoProprio,
  ESTADOS_UNIDADE,
};
