'use strict';

/**
 * Central de avisos (o sininho do topo).
 *
 * Junta num lugar so tudo que precisa de atencao no sistema, venha de onde
 * vier: instrumento que nao voltou, chamada que ninguem fez, aluno sumindo,
 * gente esperando vaga, turma sem instrutor, mandato vencido.
 *
 * A ideia e que a pessoa nao precise lembrar de entrar em cada tela para
 * descobrir que tem algo pendente — o aviso vai ate ela, esteja onde estiver.
 *
 * Cada aviso traz: tipo, gravidade, titulo, detalhe e para onde ir. Falha em
 * uma fonte nunca derruba as outras (o sino sempre responde alguma coisa).
 */

const { getDb } = require('../db/connection');

const GRAVIDADE = { critico: 3, alerta: 2, informativo: 1 };

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Roda uma fonte de avisos sem deixar que um erro dela quebre o sino inteiro. */
function coletar(nome, fn) {
  try {
    return fn() || [];
  } catch (e) {
    console.error(`[avisos] falha ao coletar "${nome}":`, e.message);
    return [];
  }
}

// ------------------------------ As fontes ------------------------------

/** Instrumento emprestado que passou da data de devolução. */
function emprestimosAtrasados(db) {
  const linhas = db.prepare(`
    SELECT e.id, u.numero, i.nome AS instrumento, c.nome AS aluno,
      e.previsao_devolucao,
      CAST(julianday('now','localtime') - julianday(e.previsao_devolucao) AS INTEGER) AS dias
    FROM emprestimos_instrumento e
    JOIN instrumentos_unidades u ON u.id = e.unidade_id
    JOIN instrumentos i ON i.id = u.instrumento_id
    JOIN clientes c ON c.id = e.aluno_id
    WHERE e.data_devolucao IS NULL AND e.previsao_devolucao IS NOT NULL
      AND e.previsao_devolucao < date('now','localtime')
    ORDER BY e.previsao_devolucao
  `).all();
  if (!linhas.length) return [];
  return [{
    tipo: 'emprestimo_atrasado',
    gravidade: 'critico',
    icone: '🎸',
    titulo: `${linhas.length} instrumento(s) não devolvido(s)`,
    detalhe: linhas.slice(0, 4).map((l) => `${l.instrumento} nº ${l.numero} com ${l.aluno} (${l.dias} dia(s) de atraso)`),
    quantidade: linhas.length,
    rota: '#/instrumentos',
  }];
}

/** Empréstimo que vence nos próximos dias — dá tempo de avisar antes de atrasar. */
function emprestimosVencendo(db) {
  const linhas = db.prepare(`
    SELECT u.numero, i.nome AS instrumento, c.nome AS aluno, e.previsao_devolucao
    FROM emprestimos_instrumento e
    JOIN instrumentos_unidades u ON u.id = e.unidade_id
    JOIN instrumentos i ON i.id = u.instrumento_id
    JOIN clientes c ON c.id = e.aluno_id
    WHERE e.data_devolucao IS NULL AND e.previsao_devolucao IS NOT NULL
      AND e.previsao_devolucao >= date('now','localtime')
      AND e.previsao_devolucao <= date('now','localtime','+3 days')
    ORDER BY e.previsao_devolucao
  `).all();
  if (!linhas.length) return [];
  return [{
    tipo: 'emprestimo_vencendo',
    gravidade: 'informativo',
    icone: '📅',
    titulo: `${linhas.length} instrumento(s) para devolver em breve`,
    detalhe: linhas.slice(0, 4).map((l) => `${l.instrumento} nº ${l.numero} com ${l.aluno} até ${l.previsao_devolucao}`),
    quantidade: linhas.length,
    rota: '#/instrumentos',
  }];
}

/** Aula que já aconteceu e ninguém fez a chamada. */
function chamadasPendentes(db) {
  const linhas = db.prepare(`
    SELECT a.id, a.data, t.nome AS turma
    FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id
    WHERE a.turma_id IS NOT NULL
      AND a.data < date('now','localtime')
      AND a.data >= date('now','localtime','-30 days')
      AND a.status != 'cancelado'
      AND NOT EXISTS (SELECT 1 FROM presencas p WHERE p.agendamento_id = a.id)
    ORDER BY a.data DESC
  `).all();
  if (!linhas.length) return [];
  return [{
    tipo: 'chamada_pendente',
    gravidade: 'alerta',
    icone: '✔️',
    titulo: `${linhas.length} aula(s) sem chamada`,
    detalhe: linhas.slice(0, 4).map((l) => `${l.turma} — ${l.data}`),
    quantidade: linhas.length,
    rota: '#/chamada',
    ajuda: 'Sem a chamada, a frequência e as horas de voluntariado ficam furadas.',
  }];
}

/** Aluno com faltas seguidas: dá para agir antes de perdê-lo. */
function alunosEmRisco() {
  // eslint-disable-next-line global-require
  const presencas = require('./presencasService');
  const lista = presencas.alunosEmRisco(3);
  if (!lista.length) return [];
  return [{
    tipo: 'aluno_em_risco',
    gravidade: 'alerta',
    icone: '⚠️',
    titulo: `${lista.length} aluno(s) em risco de evasão`,
    detalhe: lista.slice(0, 4).map((a) => `${a.aluno_nome} — ${a.faltas_seguidas} faltas seguidas em ${a.turma_nome}`),
    quantidade: lista.length,
    rota: '#/chamada',
    ajuda: 'Ligar para o responsável costuma resolver antes de virar desistência.',
  }];
}

/** Gente esperando vaga — principalmente quando já existe turma aberta do curso. */
function listaDeEspera() {
  // eslint-disable-next-line global-require
  const listaEspera = require('./listaEsperaService');
  const resumo = listaEspera.resumoPorCurso();
  if (!resumo.length) return [];

  const comTurma = resumo.filter((r) => r.turmas_abertas > 0);
  const avisos = [];

  if (comTurma.length) {
    const total = comTurma.reduce((s, r) => s + r.aguardando, 0);
    avisos.push({
      tipo: 'espera_com_turma',
      gravidade: 'alerta',
      icone: '🙋',
      titulo: `${total} interessado(s) podem ser chamados`,
      detalhe: comTurma.slice(0, 4).map((r) => `${r.curso_nome}: ${r.aguardando} esperando, com turma aberta`),
      quantidade: total,
      rota: '#/lista-espera',
      ajuda: 'Já existe turma aberta desse curso — vale ligar para quem está na fila.',
    });
  }

  const semTurma = resumo.filter((r) => !r.turmas_abertas);
  if (semTurma.length) {
    const total = semTurma.reduce((s, r) => s + r.aguardando, 0);
    avisos.push({
      tipo: 'espera_sem_turma',
      gravidade: 'informativo',
      icone: '📋',
      titulo: `${total} pessoa(s) esperando turma`,
      detalhe: semTurma.slice(0, 4).map((r) => `${r.curso_nome}: ${r.aguardando} aguardando`),
      quantidade: total,
      rota: '#/lista-espera',
      ajuda: 'Demanda represada: pode justificar abrir uma turma nova.',
    });
  }
  return avisos;
}

/** Turma aberta sem ninguém escalado para dar aula. */
function turmasSemInstrutor(db) {
  const linhas = db.prepare(`
    SELECT t.id, t.nome FROM turmas t
    WHERE t.status IN ('aberta','planejada')
      AND NOT EXISTS (SELECT 1 FROM turmas_instrutores ti WHERE ti.turma_id = t.id)
    ORDER BY t.nome
  `).all();
  if (!linhas.length) return [];
  return [{
    tipo: 'turma_sem_instrutor',
    gravidade: 'critico',
    icone: '🎓',
    titulo: `${linhas.length} turma(s) sem instrutor`,
    detalhe: linhas.slice(0, 4).map((l) => l.nome),
    quantidade: linhas.length,
    rota: '#/turmas',
  }];
}

/** Aula de amanhã sem confirmação — o instrutor voluntário pode nem lembrar. */
function aulasDeAmanha(db) {
  const linhas = db.prepare(`
    SELECT t.nome AS turma, a.hora_inicio, p.nome AS instrutor
    FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id
    LEFT JOIN profissionais p ON p.id = a.profissional_id
    WHERE a.turma_id IS NOT NULL AND a.data = date('now','localtime','+1 day')
      AND a.status NOT IN ('cancelado','atendido')
    ORDER BY a.hora_inicio
  `).all();
  if (!linhas.length) return [];
  return [{
    tipo: 'aula_amanha',
    gravidade: 'informativo',
    icone: '🔔',
    titulo: `${linhas.length} aula(s) amanhã`,
    detalhe: linhas.slice(0, 4).map((l) => `${l.hora_inicio} — ${l.turma}${l.instrutor ? ` (${l.instrutor})` : ' (sem instrutor definido)'}`),
    quantidade: linhas.length,
    rota: '#/chamada',
  }];
}

/** Menor de idade sem termo de autorização entregue. */
function autorizacoesPendentes(db) {
  const linhas = db.prepare(`
    SELECT c.id, c.nome FROM clientes c
    WHERE c.ativo = 1 AND c.data_nascimento IS NOT NULL
      AND julianday('now','localtime') - julianday(c.data_nascimento) < 6570  -- < 18 anos
      AND EXISTS (SELECT 1 FROM matriculas m WHERE m.aluno_id = c.id AND m.status = 'ativa')
      AND NOT EXISTS (SELECT 1 FROM autorizacoes a WHERE a.aluno_id = c.id AND a.tipo = 'imagem' AND a.entregue = 1)
    ORDER BY c.nome
  `).all();
  if (!linhas.length) return [];
  return [{
    tipo: 'autorizacao_pendente',
    gravidade: 'alerta',
    icone: '📄',
    titulo: `${linhas.length} menor(es) sem autorização de imagem`,
    detalhe: linhas.slice(0, 4).map((l) => l.nome),
    quantidade: linhas.length,
    rota: '#/autorizacoes',
    ajuda: 'Publicar foto de criança sem autorização do responsável é risco para o instituto.',
  }];
}

/** Diretoria com mandato vencido — quem assina os documentos deixa de valer. */
function mandatosVencidos(db) {
  const linhas = db.prepare(`
    SELECT nome, cargo, mandato_fim FROM membros_instituto
    WHERE ativo = 1 AND mandato_fim IS NOT NULL AND mandato_fim < date('now','localtime')
    ORDER BY mandato_fim
  `).all();
  if (!linhas.length) return [];
  return [{
    tipo: 'mandato_vencido',
    gravidade: 'alerta',
    icone: '🏛️',
    titulo: `${linhas.length} mandato(s) vencido(s) na diretoria`,
    detalhe: linhas.slice(0, 4).map((l) => `${l.nome} — venceu em ${l.mandato_fim}`),
    quantidade: linhas.length,
    rota: '#/membros',
    ajuda: 'Membro com mandato vencido deixa de assinar recibos e declarações.',
  }];
}

/** Lembretes que a equipe criou e já venceram. */
function lembretesVencidos() {
  // eslint-disable-next-line global-require
  const lembretes = require('./lembretesService');
  const lista = lembretes.pendentesVencidos();
  if (!lista.length) return [];
  return [{
    tipo: 'lembrete',
    gravidade: 'alerta',
    icone: '📌',
    titulo: `${lista.length} lembrete(s) pendente(s)`,
    detalhe: lista.slice(0, 4).map((l) => l.titulo),
    quantidade: lista.length,
    rota: '#/lembretes',
  }];
}

/** Contas a pagar vencidas — vale para instituto e para loja. */
function contasVencidas(db) {
  const linhas = db.prepare(`
    SELECT descricao, vencimento, valor FROM contas_pagar
    WHERE status = 'pendente' AND vencimento IS NOT NULL AND vencimento < date('now','localtime')
    ORDER BY vencimento LIMIT 20
  `).all();
  if (!linhas.length) return [];
  return [{
    tipo: 'conta_vencida',
    gravidade: 'critico',
    icone: '💸',
    titulo: `${linhas.length} conta(s) vencida(s)`,
    detalhe: linhas.slice(0, 4).map((l) => `${l.descricao} — venceu em ${l.vencimento}`),
    quantidade: linhas.length,
    rota: '#/financeiro',
  }];
}

// ------------------------------ Montagem ------------------------------

/**
 * Junta os avisos de todas as fontes, do mais grave para o menos grave.
 * As fontes do instituto so entram quando o sistema esta configurado como
 * instituto — numa loja elas nao fariam sentido nenhum.
 */
function listar() {
  const db = getDb();
  const cfg = db.prepare("SELECT valor FROM config WHERE chave = 'ramo_servico'").get();
  const ehInstituto = cfg && cfg.valor === 'instituto';

  let avisos = [
    ...coletar('lembretes', () => lembretesVencidos()),
    ...coletar('contas vencidas', () => contasVencidas(db)),
  ];

  if (ehInstituto) {
    avisos = avisos.concat(
      coletar('emprestimos atrasados', () => emprestimosAtrasados(db)),
      coletar('emprestimos vencendo', () => emprestimosVencendo(db)),
      coletar('chamadas pendentes', () => chamadasPendentes(db)),
      coletar('alunos em risco', () => alunosEmRisco()),
      coletar('lista de espera', () => listaDeEspera()),
      coletar('turmas sem instrutor', () => turmasSemInstrutor(db)),
      coletar('aulas de amanha', () => aulasDeAmanha(db)),
      coletar('autorizacoes', () => autorizacoesPendentes(db)),
      coletar('mandatos', () => mandatosVencidos(db))
    );
  }

  avisos.sort((a, b) => (GRAVIDADE[b.gravidade] || 0) - (GRAVIDADE[a.gravidade] || 0));

  return {
    total: avisos.reduce((s, a) => s + (a.quantidade || 1), 0),
    criticos: avisos.filter((a) => a.gravidade === 'critico').length,
    gerado_em: hojeISO(),
    avisos,
  };
}

module.exports = { listar };
