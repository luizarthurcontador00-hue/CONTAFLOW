'use strict';

/**
 * Arrecadacao do instituto: mantenedores, ofertas, doacoes em especie e
 * projetos. Aqui nao existe venda — existe entrada de doacao e despesa do
 * projeto, e no fim tudo desagua na prestacao de contas.
 *
 * A contribuicao mensal do mantenedor reaproveita "assinaturas", que ja sabe
 * gerar a cobranca do mes; o que muda e o vocabulario na tela.
 */

const { getDb } = require('../db/connection');
const { AppError } = require('../utils/errors');

const FORMAS = ['pix', 'dinheiro', 'transferencia', 'boleto', 'cartao', 'outro'];

// ============================== Projetos ==============================

function listarProjetos({ incluir_inativos } = {}) {
  return getDb().prepare(`
    SELECT p.*,
      (SELECT COALESCE(SUM(o.valor),0) FROM ofertas o WHERE o.projeto_id = p.id) AS arrecadado,
      (SELECT COALESCE(SUM(cp.valor),0) FROM contas_pagar cp WHERE cp.projeto_id = p.id) AS gasto
    FROM projetos p
    ${incluir_inativos ? '' : 'WHERE p.ativo = 1'}
    ORDER BY p.nome
  `).all();
}

function criarProjeto({ nome, descricao }) {
  const n = (nome || '').trim();
  if (!n) throw new AppError('Informe o nome do projeto.');
  const info = getDb().prepare('INSERT INTO projetos (nome, descricao) VALUES (?, ?)')
    .run(n, (descricao || '').trim() || null);
  return getDb().prepare('SELECT * FROM projetos WHERE id = ?').get(info.lastInsertRowid);
}

function atualizarProjeto(id, dados) {
  const db = getDb();
  const atual = db.prepare('SELECT * FROM projetos WHERE id = ?').get(id);
  if (!atual) throw new AppError('Projeto não encontrado.', 404);
  const nome = dados.nome !== undefined ? (dados.nome || '').trim() : atual.nome;
  if (!nome) throw new AppError('Informe o nome do projeto.');
  db.prepare('UPDATE projetos SET nome=?, descricao=?, ativo=? WHERE id=?').run(
    nome,
    dados.descricao !== undefined ? ((dados.descricao || '').trim() || null) : atual.descricao,
    dados.ativo !== undefined ? (dados.ativo ? 1 : 0) : atual.ativo,
    id
  );
  return db.prepare('SELECT * FROM projetos WHERE id = ?').get(id);
}

function excluirProjeto(id) {
  const db = getDb();
  const usos = db.prepare('SELECT (SELECT COUNT(*) FROM ofertas WHERE projeto_id=?) + (SELECT COUNT(*) FROM contas_pagar WHERE projeto_id=?) AS c').get(id, id).c;
  if (usos > 0) {
    db.prepare('UPDATE projetos SET ativo = 0 WHERE id = ?').run(id);
    return { ok: true, desativado: true };
  }
  db.prepare('DELETE FROM projetos WHERE id = ?').run(id);
  return { ok: true, desativado: false };
}

// =============================== Ofertas ===============================

function listarOfertas({ de, ate, projeto_id, cliente_id } = {}) {
  const where = [];
  if (de) where.push('o.data >= @de');
  if (ate) where.push('o.data <= @ate');
  if (projeto_id) where.push('o.projeto_id = @projeto_id');
  if (cliente_id) where.push('o.cliente_id = @cliente_id');

  return getDb().prepare(`
    SELECT o.*, c.nome AS mantenedor_nome, p.nome AS projeto_nome
    FROM ofertas o
    LEFT JOIN clientes c ON c.id = o.cliente_id
    LEFT JOIN projetos p ON p.id = o.projeto_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY o.data DESC, o.id DESC
  `).all({ de, ate, projeto_id, cliente_id });
}

function obterOferta(id) {
  const o = getDb().prepare(`
    SELECT o.*, c.nome AS mantenedor_nome, c.cpf, c.telefone, c.email, p.nome AS projeto_nome
    FROM ofertas o
    LEFT JOIN clientes c ON c.id = o.cliente_id
    LEFT JOIN projetos p ON p.id = o.projeto_id
    WHERE o.id = ?
  `).get(id);
  if (!o) throw new AppError('Oferta não encontrada.', 404);
  return o;
}

function validarOferta(dados) {
  const valor = Number(dados.valor);
  if (Number.isNaN(valor) || valor <= 0) throw new AppError('Informe um valor maior que zero.');

  const clienteId = dados.cliente_id ? Number(dados.cliente_id) : null;
  const doador = (dados.doador_nome || '').trim() || null;
  if (!clienteId && !doador) throw new AppError('Informe quem doou (um mantenedor cadastrado ou o nome do doador).');

  const data = String(dados.data || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new AppError('Informe a data da oferta.');

  return {
    cliente_id: clienteId,
    doador_nome: doador,
    valor,
    data,
    forma: FORMAS.includes(dados.forma) ? dados.forma : 'outro',
    projeto_id: dados.projeto_id ? Number(dados.projeto_id) : null,
    observacao: (dados.observacao || '').trim() || null,
  };
}

function registrarOferta(dados) {
  const d = validarOferta(dados);
  const info = getDb().prepare(`
    INSERT INTO ofertas (cliente_id, doador_nome, valor, data, forma, projeto_id, observacao)
    VALUES (@cliente_id, @doador_nome, @valor, @data, @forma, @projeto_id, @observacao)
  `).run(d);
  return obterOferta(info.lastInsertRowid);
}

function atualizarOferta(id, dados) {
  const atual = obterOferta(id);
  const d = validarOferta({ ...atual, ...dados });
  getDb().prepare(`
    UPDATE ofertas SET cliente_id=@cliente_id, doador_nome=@doador_nome, valor=@valor, data=@data,
      forma=@forma, projeto_id=@projeto_id, observacao=@observacao WHERE id=@id
  `).run({ ...d, id });
  return obterOferta(id);
}

function excluirOferta(id) {
  obterOferta(id);
  getDb().prepare('DELETE FROM ofertas WHERE id = ?').run(id);
  return { ok: true };
}

function marcarReciboEmitido(id) {
  obterOferta(id);
  getDb().prepare('UPDATE ofertas SET recibo_emitido = 1 WHERE id = ?').run(id);
  return obterOferta(id);
}

// ========================= Doacoes em especie =========================

function listarDoacoesEspecie({ de, ate, projeto_id } = {}) {
  const where = [];
  if (de) where.push('d.data >= @de');
  if (ate) where.push('d.data <= @ate');
  if (projeto_id) where.push('d.projeto_id = @projeto_id');

  return getDb().prepare(`
    SELECT d.*, c.nome AS mantenedor_nome, p.nome AS projeto_nome, i.nome AS instrumento_nome
    FROM doacoes_especie d
    LEFT JOIN clientes c ON c.id = d.cliente_id
    LEFT JOIN projetos p ON p.id = d.projeto_id
    LEFT JOIN instrumentos i ON i.id = d.instrumento_id
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY d.data DESC, d.id DESC
  `).all({ de, ate, projeto_id });
}

/**
 * Registra doacao de bem (instrumento, material, alimento). Quando a doacao
 * for de um instrumento do acervo, soma direto na quantidade — foi assim que
 * o instituto passou a ter mais um violao disponivel para turma.
 */
function registrarDoacaoEspecie(dados) {
  const db = getDb();
  const descricao = (dados.descricao || '').trim();
  if (!descricao) throw new AppError('Descreva o que foi doado.');

  const clienteId = dados.cliente_id ? Number(dados.cliente_id) : null;
  const doador = (dados.doador_nome || '').trim() || null;
  if (!clienteId && !doador) throw new AppError('Informe quem doou.');

  const data = String(dados.data || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new AppError('Informe a data da doação.');

  const quantidade = Number(dados.quantidade || 1);
  if (Number.isNaN(quantidade) || quantidade <= 0) throw new AppError('Informe uma quantidade válida.');

  const instrumentoId = dados.instrumento_id ? Number(dados.instrumento_id) : null;
  const somarAoAcervo = !!(instrumentoId && dados.somar_ao_acervo);

  const gravar = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO doacoes_especie (cliente_id, doador_nome, descricao, quantidade, valor_estimado,
        data, projeto_id, instrumento_id, observacao)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(clienteId, doador, descricao, quantidade,
      dados.valor_estimado ? Number(dados.valor_estimado) : null,
      data, dados.projeto_id ? Number(dados.projeto_id) : null, instrumentoId,
      (dados.observacao || '').trim() || null);

    if (somarAoAcervo) {
      db.prepare('UPDATE instrumentos SET quantidade_total = quantidade_total + ? WHERE id = ?')
        .run(Math.floor(quantidade), instrumentoId);
    }
    return info.lastInsertRowid;
  });

  const id = gravar();
  return getDb().prepare('SELECT * FROM doacoes_especie WHERE id = ?').get(id);
}

function excluirDoacaoEspecie(id) {
  getDb().prepare('DELETE FROM doacoes_especie WHERE id = ?').run(id);
  return { ok: true };
}

// ============================ Mantenedores ============================

/** Quem contribui (ou pode contribuir): pessoas marcadas como mantenedor. */
function listarMantenedores() {
  return getDb().prepare(`
    SELECT c.*,
      (SELECT COALESCE(SUM(o.valor),0) FROM ofertas o WHERE o.cliente_id = c.id) AS total_doado,
      (SELECT MAX(o.data) FROM ofertas o WHERE o.cliente_id = c.id) AS ultima_doacao,
      (SELECT a.valor FROM assinaturas a WHERE a.cliente_id = c.id AND a.ativa = 1 ORDER BY a.id DESC LIMIT 1) AS contribuicao_mensal,
      (SELECT a.dia_vencimento FROM assinaturas a WHERE a.cliente_id = c.id AND a.ativa = 1 ORDER BY a.id DESC LIMIT 1) AS dia_vencimento
    FROM clientes c
    WHERE c.natureza IN ('mantenedor','ambos') AND c.ativo = 1
    ORDER BY c.nome
  `).all();
}

// ========================= Prestacao de contas =========================

/**
 * O resumo do periodo: quanto entrou (por origem), quanto saiu (por
 * categoria), o saldo, e o alcance social do instituto. E o relatorio que se
 * mostra a mantenedor, parceiro e edital.
 */
function prestacaoDeContas({ de, ate, projeto_id } = {}) {
  const db = getDb();
  const filtroProjeto = projeto_id ? Number(projeto_id) : null;
  const p = { de: de || null, ate: ate || null, projeto_id: filtroProjeto };

  const ofertas = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS total, COUNT(*) AS quantidade
    FROM ofertas
    WHERE (@de IS NULL OR data >= @de) AND (@ate IS NULL OR data <= @ate)
      AND (@projeto_id IS NULL OR projeto_id = @projeto_id)
  `).get(p);

  const porForma = db.prepare(`
    SELECT COALESCE(forma,'outro') AS forma, COALESCE(SUM(valor),0) AS total, COUNT(*) AS quantidade
    FROM ofertas
    WHERE (@de IS NULL OR data >= @de) AND (@ate IS NULL OR data <= @ate)
      AND (@projeto_id IS NULL OR projeto_id = @projeto_id)
    GROUP BY COALESCE(forma,'outro') ORDER BY total DESC
  `).all(p);

  const despesas = db.prepare(`
    SELECT COALESCE(SUM(valor),0) AS total, COUNT(*) AS quantidade
    FROM contas_pagar
    WHERE (@de IS NULL OR vencimento >= @de) AND (@ate IS NULL OR vencimento <= @ate)
      AND (@projeto_id IS NULL OR projeto_id = @projeto_id)
  `).get(p);

  const despesasPorCategoria = db.prepare(`
    SELECT COALESCE(cd.nome,'Sem categoria') AS categoria, COALESCE(SUM(cp.valor),0) AS total
    FROM contas_pagar cp
    LEFT JOIN categorias_despesa cd ON cd.id = cp.categoria_despesa_id
    WHERE (@de IS NULL OR cp.vencimento >= @de) AND (@ate IS NULL OR cp.vencimento <= @ate)
      AND (@projeto_id IS NULL OR cp.projeto_id = @projeto_id)
    GROUP BY COALESCE(cd.nome,'Sem categoria') ORDER BY total DESC
  `).all(p);

  const especie = db.prepare(`
    SELECT COUNT(*) AS quantidade, COALESCE(SUM(valor_estimado),0) AS valor_estimado
    FROM doacoes_especie
    WHERE (@de IS NULL OR data >= @de) AND (@ate IS NULL OR data <= @ate)
      AND (@projeto_id IS NULL OR projeto_id = @projeto_id)
  `).get(p);

  // Alcance: quantas pessoas o instituto atendeu de fato no periodo.
  const alcance = db.prepare(`
    SELECT COUNT(DISTINCT pr.aluno_id) AS alunos_atendidos
    FROM presencas pr JOIN agendamentos a ON a.id = pr.agendamento_id
    WHERE pr.situacao = 'presente'
      AND (@de IS NULL OR a.data >= @de) AND (@ate IS NULL OR a.data <= @ate)
  `).get({ de: p.de, ate: p.ate });

  const encontros = db.prepare(`
    SELECT COUNT(*) AS aulas_realizadas FROM agendamentos
    WHERE turma_id IS NOT NULL AND status = 'atendido'
      AND (@de IS NULL OR data >= @de) AND (@ate IS NULL OR data <= @ate)
  `).get({ de: p.de, ate: p.ate });

  return {
    periodo: { de: de || null, ate: ate || null },
    projeto: filtroProjeto ? db.prepare('SELECT * FROM projetos WHERE id = ?').get(filtroProjeto) : null,
    entradas: { total: ofertas.total, quantidade: ofertas.quantidade, por_forma: porForma },
    despesas: { total: despesas.total, quantidade: despesas.quantidade, por_categoria: despesasPorCategoria },
    doacoes_especie: especie,
    saldo: Number((ofertas.total - despesas.total).toFixed(2)),
    alcance: {
      alunos_atendidos: alcance.alunos_atendidos || 0,
      aulas_realizadas: encontros.aulas_realizadas || 0,
    },
  };
}

module.exports = {
  listarProjetos, criarProjeto, atualizarProjeto, excluirProjeto,
  listarOfertas, obterOferta, registrarOferta, atualizarOferta, excluirOferta, marcarReciboEmitido,
  listarDoacoesEspecie, registrarDoacaoEspecie, excluirDoacaoEspecie,
  listarMantenedores, prestacaoDeContas, FORMAS,
};
