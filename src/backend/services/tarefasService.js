'use strict';

/**
 * Tarefas com acompanhamento de execucao: quadro pendente -> em andamento ->
 * concluida, com responsavel opcional (reaproveita o cadastro de
 * profissionais) e prazo.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

const STATUS_VALIDOS = ['pendente', 'andamento', 'concluida'];

function listar({ status } = {}) {
  const db = getDb();
  const where = [];
  const params = {};
  if (status) { where.push('t.status = @status'); params.status = status; }
  return db.prepare(`
    SELECT t.*, p.nome AS responsavel_nome, p.cor AS responsavel_cor
    FROM tarefas t LEFT JOIN profissionais p ON p.id = t.responsavel_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY (t.status = 'concluida'), (t.prazo IS NULL), date(t.prazo), t.criado_em DESC
  `).all(params);
}

function criar(dados) {
  const db = getDb();
  const titulo = (dados.titulo || '').trim();
  if (!titulo) throw new AppError('Informe o titulo da tarefa.');
  const info = db.prepare(
    'INSERT INTO tarefas (titulo, descricao, responsavel_id, prazo, conversa_whatsapp_id) VALUES (?, ?, ?, ?, ?)'
  ).run(
    titulo, dados.descricao || null, dados.responsavel_id ? Number(dados.responsavel_id) : null, dados.prazo || null,
    dados.conversa_whatsapp_id ? Number(dados.conversa_whatsapp_id) : null
  );
  return db.prepare('SELECT * FROM tarefas WHERE id = ?').get(info.lastInsertRowid);
}

function atualizar(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM tarefas WHERE id = ?').get(id);
  if (!atual) throw new AppError('Tarefa nao encontrada.', 404);

  const titulo = dados.titulo !== undefined ? (dados.titulo || '').trim() : atual.titulo;
  if (!titulo) throw new AppError('Informe o titulo da tarefa.');
  const status = dados.status !== undefined ? dados.status : atual.status;
  if (!STATUS_VALIDOS.includes(status)) throw new AppError('Status invalido.');

  const concluidoEm = status === 'concluida'
    ? (atual.status === 'concluida' ? atual.concluido_em : new Date().toISOString().slice(0, 19).replace('T', ' '))
    : null;

  db.prepare(
    `UPDATE tarefas SET titulo=?, descricao=?, responsavel_id=?, status=?, prazo=?, concluido_em=? WHERE id=?`
  ).run(
    titulo,
    dados.descricao !== undefined ? dados.descricao : atual.descricao,
    dados.responsavel_id !== undefined ? (dados.responsavel_id ? Number(dados.responsavel_id) : null) : atual.responsavel_id,
    status,
    dados.prazo !== undefined ? dados.prazo : atual.prazo,
    concluidoEm,
    id
  );
  return db.prepare('SELECT * FROM tarefas WHERE id = ?').get(id);
}

function excluir(id) {
  getDb().prepare('DELETE FROM tarefas WHERE id = ?').run(id);
  return { ok: true };
}

// ========================= Tarefas fixas (recorrentes) =========================

function listarFixas() {
  const db = getDb();
  return db.prepare(`
    SELECT tf.*, p.nome AS responsavel_nome, p.cor AS responsavel_cor
    FROM tarefas_fixas tf LEFT JOIN profissionais p ON p.id = tf.responsavel_id
    ORDER BY (tf.ativa = 0), tf.dia_mes
  `).all();
}

function validarFixa(dados) {
  const titulo = (dados.titulo || '').trim();
  if (!titulo) throw new AppError('Informe o titulo da tarefa fixa.');
  const dia = Number(dados.dia_mes);
  if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
    throw new AppError('Informe um dia do mes entre 1 e 31.');
  }
  return {
    titulo, dia_mes: dia,
    descricao: dados.descricao || null,
    responsavel_id: dados.responsavel_id ? Number(dados.responsavel_id) : null,
  };
}

function criarFixa(dados) {
  const db = getDb();
  const d = validarFixa(dados);
  const info = db.prepare(
    'INSERT INTO tarefas_fixas (titulo, descricao, responsavel_id, dia_mes) VALUES (?, ?, ?, ?)'
  ).run(d.titulo, d.descricao, d.responsavel_id, d.dia_mes);
  return db.prepare('SELECT * FROM tarefas_fixas WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarFixa(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM tarefas_fixas WHERE id = ?').get(id);
  if (!atual) throw new AppError('Tarefa fixa nao encontrada.', 404);
  const d = validarFixa({ ...atual, ...dados });
  const ativa = dados.ativa !== undefined ? (dados.ativa ? 1 : 0) : atual.ativa;
  db.prepare('UPDATE tarefas_fixas SET titulo=?, descricao=?, responsavel_id=?, dia_mes=?, ativa=? WHERE id=?')
    .run(d.titulo, d.descricao, d.responsavel_id, d.dia_mes, ativa, id);
  return db.prepare('SELECT * FROM tarefas_fixas WHERE id = ?').get(id);
}

function excluirFixa(id) {
  // Nao apaga as tarefas ja geradas (historico do quadro), so o modelo.
  getDb().prepare('DELETE FROM tarefas_fixas WHERE id = ?').run(id);
  return { ok: true };
}

/**
 * Gera a tarefa do mes corrente para cada tarefa fixa ativa que ainda nao
 * tenha uma gerada neste mes. Idempotente: pode rodar toda vez que a tela
 * abre sem duplicar (mesmo espirito das contas fixas do financeiro).
 */
function gerarFixasPendentes() {
  const db = getDb();
  const fixas = db.prepare('SELECT * FROM tarefas_fixas WHERE ativa = 1').all();
  if (!fixas.length) return { geradas: 0 };

  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = agora.getMonth() + 1;
  const aaMm = `${ano}-${String(mes).padStart(2, '0')}`;
  const ultimoDia = new Date(ano, mes, 0).getDate();

  let geradas = 0;
  const tx = db.transaction(() => {
    const jaTem = db.prepare(
      "SELECT 1 FROM tarefas WHERE tarefa_fixa_id = ? AND strftime('%Y-%m', criado_em) = ?"
    );
    const inserir = db.prepare(
      `INSERT INTO tarefas (titulo, descricao, responsavel_id, prazo, tarefa_fixa_id)
       VALUES (?, ?, ?, ?, ?)`
    );
    for (const f of fixas) {
      if (jaTem.get(f.id, aaMm)) continue;
      const dia = Math.min(Number(f.dia_mes), ultimoDia);
      const prazo = `${aaMm}-${String(dia).padStart(2, '0')}`;
      inserir.run(f.titulo, f.descricao, f.responsavel_id, prazo, f.id);
      geradas++;
    }
  });
  tx();
  return { geradas };
}

module.exports = {
  listar, criar, atualizar, excluir,
  listarFixas, criarFixa, atualizarFixa, excluirFixa, gerarFixasPendentes,
};
