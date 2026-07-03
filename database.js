const path = require('path');
const bcrypt = require('bcrypt');
const Database = require('better-sqlite3');

const db = new Database(path.join(__dirname, 'contaflow.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function createSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      senha_hash TEXT NOT NULL,
      cargo TEXT DEFAULT 'colaborador',
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS empresas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      razao_social TEXT NOT NULL,
      nome_fantasia TEXT NOT NULL,
      cnpj TEXT NOT NULL UNIQUE,
      email TEXT,
      telefone TEXT,
      regime_tributario TEXT NOT NULL CHECK (regime_tributario IN ('simples_nacional','lucro_presumido','lucro_real','mei')),
      tipo_empresa TEXT NOT NULL DEFAULT 'comercio' CHECK (tipo_empresa IN ('comercio','servicos','industrial','comercio_servico')),
      inicio_geracao_tarefas TEXT,
      responsavel_id INTEGER REFERENCES usuarios(id),
      status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','inativo')),
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS servicos_contratados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      tipo_servico TEXT NOT NULL CHECK (tipo_servico IN ('contabil','fiscal','dp','abertura_empresa','consultoria','legalizacao')),
      UNIQUE(empresa_id, tipo_servico)
    );

    CREATE TABLE IF NOT EXISTS grupos_tarefas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      descricao TEXT,
      tipo_recorrencia TEXT NOT NULL CHECK (tipo_recorrencia IN ('diaria','semanal','mensal','anual','unica')),
      dia_vencimento INTEGER,
      dia_semana_vencimento INTEGER,
      mes_vencimento INTEGER,
      aplica_regime TEXT NOT NULL DEFAULT 'todos',
      aplica_servico TEXT NOT NULL DEFAULT 'todos',
      aplica_tipo_empresa TEXT NOT NULL DEFAULT 'todos',
      setor TEXT NOT NULL CHECK (setor IN ('DP','Fiscal','Contábil','Administrativo')),
      ativo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS tarefas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      grupo_tarefa_id INTEGER REFERENCES grupos_tarefas(id),
      titulo TEXT NOT NULL,
      descricao TEXT,
      setor TEXT NOT NULL CHECK (setor IN ('DP','Fiscal','Contábil','Administrativo')),
      status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','em_andamento','concluida','aguardando_cliente')),
      prioridade TEXT NOT NULL DEFAULT 'normal' CHECK (prioridade IN ('normal','urgente')),
      responsavel_id INTEGER REFERENCES usuarios(id),
      data_vencimento TEXT,
      data_conclusao TEXT,
      mes_referencia TEXT NOT NULL,
      observacoes TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS historico_tarefas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tarefa_id INTEGER NOT NULL REFERENCES tarefas(id) ON DELETE CASCADE,
      usuario_id INTEGER REFERENCES usuarios(id),
      acao TEXT NOT NULL,
      descricao TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS empresa_tarefas_override (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      grupo_tarefa_id INTEGER NOT NULL REFERENCES grupos_tarefas(id) ON DELETE CASCADE,
      incluido INTEGER NOT NULL,
      UNIQUE(empresa_id, grupo_tarefa_id)
    );

    CREATE TABLE IF NOT EXISTS processo_tipos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL UNIQUE,
      descricao TEXT,
      ativo INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS processo_etapas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo_id INTEGER NOT NULL REFERENCES processo_tipos(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      ordem INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS processos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo_id INTEGER NOT NULL REFERENCES processo_tipos(id),
      empresa_id INTEGER REFERENCES empresas(id) ON DELETE SET NULL,
      cliente_nome TEXT,
      etapa_id INTEGER REFERENCES processo_etapas(id),
      status TEXT NOT NULL DEFAULT 'em_andamento' CHECK (status IN ('em_andamento','concluido','cancelado')),
      responsavel_id INTEGER REFERENCES usuarios(id),
      observacoes TEXT,
      criado_em TEXT NOT NULL DEFAULT (datetime('now')),
      atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS processo_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
      usuario_id INTEGER REFERENCES usuarios(id),
      descricao TEXT NOT NULL,
      criado_em TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tarefas_empresa ON tarefas(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_tarefas_mes ON tarefas(mes_referencia);
    CREATE INDEX IF NOT EXISTS idx_tarefas_status ON tarefas(status);
    CREATE INDEX IF NOT EXISTS idx_servicos_empresa ON servicos_contratados(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_override_empresa ON empresa_tarefas_override(empresa_id);
    CREATE INDEX IF NOT EXISTS idx_processos_tipo ON processos(tipo_id);
    CREATE INDEX IF NOT EXISTS idx_processos_etapa ON processos(etapa_id);
    CREATE INDEX IF NOT EXISTS idx_processo_etapas_tipo ON processo_etapas(tipo_id);
  `);
}

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

function runMigrations() {
  if (!columnExists('empresas', 'tipo_empresa')) {
    db.exec(`ALTER TABLE empresas ADD COLUMN tipo_empresa TEXT NOT NULL DEFAULT 'comercio'`);
  }
  if (!columnExists('empresas', 'inicio_geracao_tarefas')) {
    db.exec(`ALTER TABLE empresas ADD COLUMN inicio_geracao_tarefas TEXT`);
  }
  if (!columnExists('grupos_tarefas', 'aplica_tipo_empresa')) {
    db.exec(`ALTER TABLE grupos_tarefas ADD COLUMN aplica_tipo_empresa TEXT NOT NULL DEFAULT 'todos'`);
  }
}

const GRUPOS_SEED = [
  // Departamento Pessoal - aplica_servico = dp, todos os regimes
  { nome: 'Folha de pagamento', descricao: 'Processamento da folha de pagamento mensal', tipo_recorrencia: 'mensal', dia_vencimento: 5, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'dp', setor: 'DP' },
  { nome: 'Envio de holerites ao cliente', descricao: 'Envio dos holerites para o cliente', tipo_recorrencia: 'mensal', dia_vencimento: 7, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'dp', setor: 'DP' },
  { nome: 'Guia FGTS (GRF)', descricao: 'Geração e recolhimento da guia do FGTS', tipo_recorrencia: 'mensal', dia_vencimento: 7, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'dp', setor: 'DP' },
  { nome: 'Guia INSS (GPS)', descricao: 'Geração e recolhimento da guia do INSS', tipo_recorrencia: 'mensal', dia_vencimento: 20, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'dp', setor: 'DP' },
  { nome: 'DARF IRRF folha', descricao: 'Recolhimento do IRRF sobre a folha de pagamento', tipo_recorrencia: 'mensal', dia_vencimento: 20, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'dp', setor: 'DP' },
  { nome: 'CAGED (admissão/demissão)', descricao: 'Envio das movimentações de admissão e demissão', tipo_recorrencia: 'mensal', dia_vencimento: 7, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'dp', setor: 'DP' },
  { nome: 'REINF (eventos trabalhistas)', descricao: 'Envio da EFD-Reinf com eventos trabalhistas', tipo_recorrencia: 'mensal', dia_vencimento: 15, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'dp', setor: 'DP' },
  { nome: 'Férias e 13º — controle', descricao: 'Controle mensal de férias e décimo terceiro', tipo_recorrencia: 'mensal', dia_vencimento: 1, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'dp', setor: 'DP' },

  // Fiscal - Simples Nacional
  { nome: 'DAS Simples Nacional', descricao: 'Geração e pagamento do DAS', tipo_recorrencia: 'mensal', dia_vencimento: 20, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'simples_nacional', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'Download NFs de entrada (SEFAZ)', descricao: 'Download das notas fiscais de entrada na SEFAZ', tipo_recorrencia: 'mensal', dia_vencimento: 5, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'simples_nacional', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'Escrituração fiscal', descricao: 'Escrituração fiscal do período', tipo_recorrencia: 'mensal', dia_vencimento: 10, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'simples_nacional', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'PGDAS-D', descricao: 'Apuração e transmissão do PGDAS-D', tipo_recorrencia: 'mensal', dia_vencimento: 20, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'simples_nacional', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'DEFIS (declaração anual)', descricao: 'Declaração de Informações Socioeconômicas e Fiscais', tipo_recorrencia: 'anual', dia_vencimento: 31, dia_semana_vencimento: null, mes_vencimento: 3, aplica_regime: 'simples_nacional', aplica_servico: 'fiscal', setor: 'Fiscal' },

  // Fiscal - Lucro Presumido
  { nome: 'DARF IRPJ', descricao: 'Recolhimento do IRPJ', tipo_recorrencia: 'mensal', dia_vencimento: 30, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'DARF CSLL', descricao: 'Recolhimento da CSLL', tipo_recorrencia: 'mensal', dia_vencimento: 30, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'PIS', descricao: 'Apuração e recolhimento do PIS', tipo_recorrencia: 'mensal', dia_vencimento: 25, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'COFINS', descricao: 'Apuração e recolhimento da COFINS', tipo_recorrencia: 'mensal', dia_vencimento: 25, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'ICMS (estadual)', descricao: 'Apuração e recolhimento do ICMS - prazo varia por estado', tipo_recorrencia: 'mensal', dia_vencimento: null, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'ISS (municipal)', descricao: 'Apuração e recolhimento do ISS - prazo varia por município', tipo_recorrencia: 'mensal', dia_vencimento: null, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'Download NFs entrada/saída (SEFAZ)', descricao: 'Download das notas fiscais de entrada e saída', tipo_recorrencia: 'mensal', dia_vencimento: 5, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'Escrituração fiscal completa', descricao: 'Escrituração fiscal completa do período', tipo_recorrencia: 'mensal', dia_vencimento: 15, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'EFD-Contribuições (SPED)', descricao: 'Transmissão da EFD-Contribuições', tipo_recorrencia: 'mensal', dia_vencimento: 10, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'SPED Fiscal', descricao: 'Transmissão do SPED Fiscal', tipo_recorrencia: 'mensal', dia_vencimento: 15, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'ECF (declaração anual)', descricao: 'Escrituração Contábil Fiscal anual', tipo_recorrencia: 'anual', dia_vencimento: 31, dia_semana_vencimento: null, mes_vencimento: 7, aplica_regime: 'lucro_presumido', aplica_servico: 'fiscal', setor: 'Fiscal' },

  // Fiscal - MEI
  { nome: 'DAS MEI', descricao: 'Geração e pagamento do DAS-MEI', tipo_recorrencia: 'mensal', dia_vencimento: 20, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'mei', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'DASN-SIMEI (declaração anual)', descricao: 'Declaração Anual do Simples Nacional do MEI', tipo_recorrencia: 'anual', dia_vencimento: 31, dia_semana_vencimento: null, mes_vencimento: 5, aplica_regime: 'mei', aplica_servico: 'fiscal', setor: 'Fiscal' },
  { nome: 'Emissão de NFS-e (orientação)', descricao: 'Orientação ao cliente sobre emissão de notas fiscais de serviço', tipo_recorrencia: 'mensal', dia_vencimento: 5, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'mei', aplica_servico: 'fiscal', setor: 'Fiscal' },

  // Contábil - todos os regimes
  { nome: 'Cobrança de documentos ao cliente', descricao: 'Solicitação dos documentos contábeis do período', tipo_recorrencia: 'mensal', dia_vencimento: 3, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'contabil', setor: 'Contábil' },
  { nome: 'Lançamentos contábeis', descricao: 'Lançamento das movimentações contábeis do período', tipo_recorrencia: 'mensal', dia_vencimento: 15, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'contabil', setor: 'Contábil' },
  { nome: 'Conciliação bancária', descricao: 'Conciliação das contas bancárias do período', tipo_recorrencia: 'mensal', dia_vencimento: 20, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'contabil', setor: 'Contábil' },
  { nome: 'Fechamento contábil mensal', descricao: 'Fechamento contábil do período', tipo_recorrencia: 'mensal', dia_vencimento: 25, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'contabil', setor: 'Contábil' },
  { nome: 'Balancete mensal', descricao: 'Elaboração do balancete mensal', tipo_recorrencia: 'mensal', dia_vencimento: 28, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'contabil', setor: 'Contábil' },
  { nome: 'ECD — SPED Contábil', descricao: 'Escrituração Contábil Digital anual', tipo_recorrencia: 'anual', dia_vencimento: 30, dia_semana_vencimento: null, mes_vencimento: 6, aplica_regime: 'todos', aplica_servico: 'contabil', setor: 'Contábil' },
  { nome: 'ECF — SPED Contábil', descricao: 'Escrituração Contábil Fiscal anual', tipo_recorrencia: 'anual', dia_vencimento: 31, dia_semana_vencimento: null, mes_vencimento: 7, aplica_regime: 'todos', aplica_servico: 'contabil', setor: 'Contábil' },
  { nome: 'Relatório gerencial ao cliente', descricao: 'Envio do relatório gerencial mensal ao cliente', tipo_recorrencia: 'mensal', dia_vencimento: 30, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'contabil', setor: 'Contábil' },

  // Recorrentes - todos os regimes e serviços
  { nome: 'Consulta situação fiscal (e-CAC/SEFAZ)', descricao: 'Consulta semanal da situação fiscal dos clientes', tipo_recorrencia: 'semanal', dia_vencimento: null, dia_semana_vencimento: 1, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'todos', setor: 'Fiscal' },
  { nome: 'Acompanhamento de parcelamentos', descricao: 'Acompanhamento semanal dos parcelamentos em andamento', tipo_recorrencia: 'semanal', dia_vencimento: null, dia_semana_vencimento: 3, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'todos', setor: 'Fiscal' },
  { nome: 'Revisão de pendências de clientes', descricao: 'Revisão diária das pendências em aberto de cada cliente', tipo_recorrencia: 'diaria', dia_vencimento: null, dia_semana_vencimento: null, mes_vencimento: null, aplica_regime: 'todos', aplica_servico: 'todos', setor: 'Administrativo' },
];

const EMPRESAS_SEED = [
  {
    razao_social: 'Comércio Boa Vista Ltda',
    nome_fantasia: 'Boa Vista Comércio',
    cnpj: '12345678000190',
    email: 'contato@boavista.com.br',
    telefone: '(11) 3456-7890',
    regime_tributario: 'simples_nacional',
    tipo_empresa: 'comercio',
    status: 'ativo',
    servicos: ['contabil', 'fiscal', 'dp'],
  },
  {
    razao_social: 'Indústria Nortec S.A.',
    nome_fantasia: 'Nortec Indústria',
    cnpj: '98765432000155',
    email: 'financeiro@nortec.com.br',
    telefone: '(11) 2345-6789',
    regime_tributario: 'lucro_presumido',
    tipo_empresa: 'industrial',
    status: 'ativo',
    servicos: ['contabil', 'fiscal', 'dp', 'consultoria'],
  },
  {
    razao_social: 'João Pedro Fotografia',
    nome_fantasia: 'JP Fotografia',
    cnpj: '11222333000144',
    email: 'joao@jpfotografia.com.br',
    telefone: '(11) 9876-5432',
    regime_tributario: 'mei',
    tipo_empresa: 'servicos',
    status: 'ativo',
    servicos: ['contabil', 'fiscal'],
  },
];

function seedDatabase() {
  const usuarioCount = db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c;
  let adminId;
  if (usuarioCount === 0) {
    const senhaHash = bcrypt.hashSync('admin123', 10);
    const info = db.prepare(`
      INSERT INTO usuarios (nome, email, senha_hash, cargo)
      VALUES (?, ?, ?, ?)
    `).run('Administrador', 'admin@contaflow.com', senhaHash, 'admin');
    adminId = info.lastInsertRowid;
  } else {
    adminId = db.prepare('SELECT id FROM usuarios ORDER BY id LIMIT 1').get().id;
  }

  const grupoCount = db.prepare('SELECT COUNT(*) AS c FROM grupos_tarefas').get().c;
  if (grupoCount === 0) {
    const insertGrupo = db.prepare(`
      INSERT INTO grupos_tarefas
        (nome, descricao, tipo_recorrencia, dia_vencimento, dia_semana_vencimento, mes_vencimento, aplica_regime, aplica_servico, setor, ativo)
      VALUES (@nome, @descricao, @tipo_recorrencia, @dia_vencimento, @dia_semana_vencimento, @mes_vencimento, @aplica_regime, @aplica_servico, @setor, 1)
    `);
    const insertMany = db.transaction((rows) => {
      for (const row of rows) insertGrupo.run(row);
    });
    insertMany(GRUPOS_SEED);
  }

  const empresaCount = db.prepare('SELECT COUNT(*) AS c FROM empresas').get().c;
  if (empresaCount === 0) {
    const insertEmpresa = db.prepare(`
      INSERT INTO empresas (razao_social, nome_fantasia, cnpj, email, telefone, regime_tributario, tipo_empresa, responsavel_id, status)
      VALUES (@razao_social, @nome_fantasia, @cnpj, @email, @telefone, @regime_tributario, @tipo_empresa, @responsavel_id, @status)
    `);
    const insertServico = db.prepare(`
      INSERT INTO servicos_contratados (empresa_id, tipo_servico) VALUES (?, ?)
    `);
    const insertMany = db.transaction((empresas) => {
      for (const emp of empresas) {
        const info = insertEmpresa.run({ ...emp, responsavel_id: adminId });
        const empresaId = info.lastInsertRowid;
        for (const servico of emp.servicos) {
          insertServico.run(empresaId, servico);
        }
      }
    });
    insertMany(EMPRESAS_SEED);
  }

  const processoTipoCount = db.prepare('SELECT COUNT(*) AS c FROM processo_tipos').get().c;
  if (processoTipoCount === 0) {
    const PROCESSO_TIPOS_SEED = [
      {
        nome: 'Entradas de Clientes | Abertura de CNPJ',
        descricao: 'Fluxo de entrada de novos clientes com abertura de CNPJ',
        etapas: [
          'Entrada de Cliente',
          'Assinatura Contrato de Prestação de Serviços',
          'Solicitar Documentos Abertura',
          'Documentos Recebidos',
          'Processo de Abertura',
          'Aguardando Aprovação',
          'Contrato Social Aprovado',
          'Cadastro Sistema Calima',
          'Cadastro Sistema Financeiro',
          'Criar Pasta Drive',
        ],
      },
      {
        nome: 'Baixa de Empresa',
        descricao: 'Fluxo de encerramento/baixa de empresa',
        etapas: [
          'Solicitação de Baixa',
          'Verificação de Débitos',
          'Distrato Social',
          'Protocolo na Junta Comercial',
          'Baixa Receita Federal',
          'Baixa Municipal/Estadual',
          'Baixa Concluída',
        ],
      },
      {
        nome: 'Controle de Alvará',
        descricao: 'Emissão e renovação de alvarás',
        etapas: [
          'Levantamento de Documentos',
          'Protocolo do Pedido',
          'Em Análise no Órgão',
          'Exigências/Pendências',
          'Alvará Emitido',
          'Renovação Programada',
        ],
      },
      {
        nome: 'Integração de Cliente',
        descricao: 'Onboarding de cliente que já possui CNPJ',
        etapas: [
          'Reunião Inicial',
          'Assinatura de Contrato',
          'Coleta de Documentos',
          'Transferência de Contabilidade Anterior',
          'Cadastro nos Sistemas',
          'Treinamento do Cliente',
          'Integração Concluída',
        ],
      },
      {
        nome: 'Controle de IRPF',
        descricao: 'Declarações de Imposto de Renda Pessoa Física',
        etapas: [
          'Solicitar Documentos',
          'Documentos Recebidos',
          'Em Elaboração',
          'Revisão',
          'Declaração Transmitida',
          'Recibo Enviado ao Cliente',
        ],
      },
    ];

    const insertTipo = db.prepare('INSERT INTO processo_tipos (nome, descricao) VALUES (?, ?)');
    const insertEtapa = db.prepare('INSERT INTO processo_etapas (tipo_id, nome, ordem) VALUES (?, ?, ?)');
    const insertTipos = db.transaction((tipos) => {
      for (const tipo of tipos) {
        const info = insertTipo.run(tipo.nome, tipo.descricao);
        tipo.etapas.forEach((nome, idx) => insertEtapa.run(info.lastInsertRowid, nome, idx + 1));
      }
    });
    insertTipos(PROCESSO_TIPOS_SEED);
  }
}

createSchema();
runMigrations();
seedDatabase();

module.exports = db;
