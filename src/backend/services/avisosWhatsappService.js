'use strict';

/**
 * Avisos automaticos por WhatsApp: confirmacao da aula de amanha e cobranca
 * de instrumento nao devolvido.
 *
 * Dois cuidados que valem mais que o recurso em si:
 * - Nada e enviado sem o usuario ligar a opcao nas Configuracoes. E uma
 *   automacao sobre o WhatsApp Web, e disparo em massa nao pedido e a
 *   receita para o numero do instituto ser bloqueado.
 * - Cada aviso e registrado em avisos_enviados, entao a mesma mensagem nunca
 *   sai duas vezes para a mesma pessoa (o agendador roda a cada minuto).
 */

const { getDb } = require('../db/connection');

function config() {
  const linhas = getDb().prepare(
    "SELECT chave, valor FROM config WHERE chave IN ('aviso_aula_ativo','aviso_emprestimo_ativo','aviso_hora')"
  ).all();
  const c = {};
  linhas.forEach((l) => { c[l.chave] = l.valor; });
  return {
    aulaAtivo: c.aviso_aula_ativo === '1',
    emprestimoAtivo: c.aviso_emprestimo_ativo === '1',
    hora: c.aviso_hora || '09:00',
  };
}

function salvarConfig(dados) {
  const up = getDb().prepare('INSERT INTO config (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor');
  up.run('aviso_aula_ativo', dados.aulaAtivo ? '1' : '0');
  up.run('aviso_emprestimo_ativo', dados.emprestimoAtivo ? '1' : '0');
  up.run('aviso_hora', /^\d{2}:\d{2}$/.test(dados.hora || '') ? dados.hora : '09:00');
  return config();
}

function jaEnviado(db, tipo, referencia) {
  return !!db.prepare('SELECT 1 FROM avisos_enviados WHERE tipo = ? AND referencia = ?').get(tipo, referencia);
}

function marcarEnviado(db, tipo, referencia) {
  db.prepare('INSERT OR IGNORE INTO avisos_enviados (tipo, referencia) VALUES (?, ?)').run(tipo, referencia);
}

/** So manda para quem tem telefone; prefere o do responsavel (aluno menor). */
function telefoneDe(pessoa) {
  const tel = (pessoa.responsavel_telefone || pessoa.telefone || '').replace(/\D/g, '');
  return tel.length >= 10 ? tel : null;
}

/** Responsaveis dos alunos com aula amanha, para confirmar presenca. */
function destinatariosAulaDeAmanha(db) {
  return db.prepare(`
    SELECT a.id AS encontro_id, a.data, a.hora_inicio, t.nome AS turma_nome, c.nome AS curso_nome,
      cl.id AS aluno_id, cl.nome AS aluno_nome, cl.telefone, cl.responsavel_nome, cl.responsavel_telefone
    FROM agendamentos a
    JOIN turmas t ON t.id = a.turma_id
    JOIN cursos c ON c.id = t.curso_id
    JOIN matriculas m ON m.turma_id = t.id AND m.status = 'ativa'
    JOIN clientes cl ON cl.id = m.aluno_id
    WHERE a.turma_id IS NOT NULL
      AND a.data = date('now','localtime','+1 day')
      AND a.status NOT IN ('cancelado','atendido')
      AND t.status != 'cancelada'
  `).all();
}

function emprestimosParaCobrar(db) {
  return db.prepare(`
    SELECT e.id AS emprestimo_id, u.numero, i.nome AS instrumento,
      cl.id AS aluno_id, cl.nome AS aluno_nome, cl.telefone, cl.responsavel_nome, cl.responsavel_telefone,
      e.previsao_devolucao,
      CAST(julianday('now','localtime') - julianday(e.previsao_devolucao) AS INTEGER) AS dias
    FROM emprestimos_instrumento e
    JOIN instrumentos_unidades u ON u.id = e.unidade_id
    JOIN instrumentos i ON i.id = u.instrumento_id
    JOIN clientes cl ON cl.id = e.aluno_id
    WHERE e.data_devolucao IS NULL AND e.previsao_devolucao IS NOT NULL
      AND e.previsao_devolucao < date('now','localtime')
  `).all();
}

function nomeDoInstituto(db) {
  const r = db.prepare("SELECT valor FROM config WHERE chave = 'nome_loja'").get();
  return (r && r.valor) || 'o instituto';
}

/**
 * Roda a cada minuto pelo agendador. So faz alguma coisa na hora escolhida,
 * e so se o WhatsApp estiver conectado.
 */
async function processar() {
  const db = getDb();
  const cfg = config();
  if (!cfg.aulaAtivo && !cfg.emprestimoAtivo) return { enviados: 0 };

  // eslint-disable-next-line global-require
  const whatsapp = require('./whatsappService');
  if (whatsapp.status().estado !== 'conectado') return { enviados: 0 };

  const agora = new Date();
  const horaAgora = `${String(agora.getHours()).padStart(2, '0')}:${String(agora.getMinutes()).padStart(2, '0')}`;
  if (horaAgora < cfg.hora) return { enviados: 0 };

  const instituto = nomeDoInstituto(db);
  let enviados = 0;

  if (cfg.aulaAtivo) {
    for (const d of destinatariosAulaDeAmanha(db)) {
      const ref = `encontro:${d.encontro_id}:aluno:${d.aluno_id}`;
      if (jaEnviado(db, 'aula_amanha', ref)) continue;
      const tel = telefoneDe(d);
      if (!tel) { marcarEnviado(db, 'aula_amanha', ref); continue; }

      const quem = d.responsavel_nome ? `${d.responsavel_nome}, ` : '';
      const texto = `Olá ${quem}aqui é ${instituto}. `
        + `Lembrando que ${d.aluno_nome} tem aula de ${d.curso_nome} amanhã às ${d.hora_inicio} (${d.turma_nome}). `
        + 'Podemos contar com a presença? Se não puder vir, é só avisar por aqui. 🎵';
      try {
        await whatsapp.iniciarConversa(tel, texto, d.responsavel_nome || d.aluno_nome);
        marcarEnviado(db, 'aula_amanha', ref);
        enviados++;
      } catch (e) {
        console.error('[avisos] falha ao avisar sobre a aula de amanha:', e.message);
      }
    }
  }

  if (cfg.emprestimoAtivo) {
    for (const e of emprestimosParaCobrar(db)) {
      // Cobra uma vez por dia de atraso, nao a cada minuto.
      const ref = `emprestimo:${e.emprestimo_id}:dia:${new Date().toISOString().slice(0, 10)}`;
      if (jaEnviado(db, 'emprestimo_atrasado', ref)) continue;
      const tel = telefoneDe(e);
      if (!tel) { marcarEnviado(db, 'emprestimo_atrasado', ref); continue; }

      const quem = e.responsavel_nome ? `${e.responsavel_nome}, ` : '';
      const texto = `Olá ${quem}aqui é ${instituto}. `
        + `O ${e.instrumento} nº ${e.numero} que está com ${e.aluno_nome} tinha devolução prevista para ${e.previsao_devolucao} `
        + `(${e.dias} dia(s) atrás). Consegue trazer de volta nos próximos dias? Outros alunos estão esperando para usar. 🙏`;
      try {
        await whatsapp.iniciarConversa(tel, texto, e.responsavel_nome || e.aluno_nome);
        marcarEnviado(db, 'emprestimo_atrasado', ref);
        enviados++;
      } catch (err) {
        console.error('[avisos] falha ao cobrar instrumento atrasado:', err.message);
      }
    }
  }

  return { enviados };
}

/** Quantos avisos sairiam agora, sem enviar nada (para a tela de configuração). */
function previa() {
  const db = getDb();
  const cfg = config();
  const aulas = cfg.aulaAtivo ? destinatariosAulaDeAmanha(db).filter((d) => telefoneDe(d)).length : 0;
  const emprestimos = cfg.emprestimoAtivo ? emprestimosParaCobrar(db).filter((e) => telefoneDe(e)).length : 0;
  return { ...cfg, aulas_amanha: aulas, emprestimos_atrasados: emprestimos };
}

module.exports = { config, salvarConfig, processar, previa };
