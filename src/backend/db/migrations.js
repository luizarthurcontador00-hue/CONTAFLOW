'use strict';

/**
 * Migrations versionadas do banco.
 *
 * Cada item do array `migrations` tem { version, up(db) }. Ao iniciar, o
 * sistema le a versao atual em `schema_version` e aplica, em ordem, todas as
 * migrations com versao maior. Assim o schema evolui sem perder dados do
 * usuario final entre atualizacoes do app.
 */

const { getDb } = require('./connection');

const migrations = [
  {
    version: 1,
    name: 'schema-inicial',
    up(db) {
      db.exec(`
        -- ============================ Categorias ============================
        CREATE TABLE IF NOT EXISTS categorias (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          nome          TEXT NOT NULL UNIQUE,
          markup_padrao REAL,                       -- % de markup padrao da categoria
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- ========================== Fornecedores ===========================
        CREATE TABLE IF NOT EXISTS fornecedores (
          id        INTEGER PRIMARY KEY AUTOINCREMENT,
          nome      TEXT NOT NULL,
          cnpj      TEXT UNIQUE,
          contato   TEXT,
          telefone  TEXT,
          email     TEXT,
          criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- ============================ Produtos =============================
        CREATE TABLE IF NOT EXISTS produtos (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          nome           TEXT NOT NULL,
          descricao      TEXT,
          codigo_barras  TEXT,                       -- EAN
          categoria_id   INTEGER REFERENCES categorias(id) ON DELETE SET NULL,
          fornecedor_id  INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
          unidade        TEXT NOT NULL DEFAULT 'UN',
          custo          REAL NOT NULL DEFAULT 0,
          markup         REAL,                        -- % markup do produto (sobrepoe a categoria)
          preco_venda    REAL NOT NULL DEFAULT 0,
          estoque_atual  REAL NOT NULL DEFAULT 0,
          estoque_minimo REAL NOT NULL DEFAULT 0,
          foto_path      TEXT,                        -- nome do arquivo em uploads/produtos
          ativo          INTEGER NOT NULL DEFAULT 1,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_produtos_codigo_barras ON produtos(codigo_barras);
        CREATE INDEX IF NOT EXISTS idx_produtos_nome ON produtos(nome);
        CREATE INDEX IF NOT EXISTS idx_produtos_categoria ON produtos(categoria_id);

        -- ============================ Compras ==============================
        CREATE TABLE IF NOT EXISTS compras (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          fornecedor_id   INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
          numero_nf       TEXT,
          chave_nfe       TEXT UNIQUE,                -- chave de acesso (44 digitos) p/ evitar duplicidade
          xml_path        TEXT,                       -- nome do arquivo em uploads/notas
          data_emissao    TEXT,
          data_importacao TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          valor_total     REAL NOT NULL DEFAULT 0,
          status          TEXT NOT NULL DEFAULT 'importada'  -- importada | cancelada
        );

        CREATE TABLE IF NOT EXISTS compras_itens (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          compra_id      INTEGER NOT NULL REFERENCES compras(id) ON DELETE CASCADE,
          produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
          codigo_fornec  TEXT,                        -- codigo do produto no fornecedor (cProd)
          descricao_nf   TEXT,                        -- descricao como veio na NF
          ncm            TEXT,
          ean            TEXT,
          quantidade     REAL NOT NULL DEFAULT 0,
          valor_unitario REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_compras_itens_compra ON compras_itens(compra_id);

        -- ============================= Vendas ==============================
        CREATE TABLE IF NOT EXISTS vendas (
          id          INTEGER PRIMARY KEY AUTOINCREMENT,
          data        TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          valor_bruto REAL NOT NULL DEFAULT 0,        -- soma dos itens antes do desconto
          desconto    REAL NOT NULL DEFAULT 0,
          valor_total REAL NOT NULL DEFAULT 0,        -- valor_bruto - desconto
          status      TEXT NOT NULL DEFAULT 'concluida', -- concluida | cancelada
          caixa_id    INTEGER REFERENCES caixa(id) ON DELETE SET NULL,
          observacao  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas(data);
        CREATE INDEX IF NOT EXISTS idx_vendas_status ON vendas(status);

        CREATE TABLE IF NOT EXISTS vendas_itens (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          venda_id       INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
          produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
          descricao      TEXT,                        -- snapshot do nome do produto na venda
          quantidade     REAL NOT NULL DEFAULT 0,
          preco_unitario REAL NOT NULL DEFAULT 0,
          custo_unitario REAL NOT NULL DEFAULT 0,     -- snapshot do custo p/ calculo de margem
          desconto_item  REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_vendas_itens_venda ON vendas_itens(venda_id);
        CREATE INDEX IF NOT EXISTS idx_vendas_itens_produto ON vendas_itens(produto_id);

        CREATE TABLE IF NOT EXISTS vendas_pagamentos (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          venda_id       INTEGER NOT NULL REFERENCES vendas(id) ON DELETE CASCADE,
          forma_pagamento TEXT NOT NULL,              -- dinheiro | cartao_credito | cartao_debito | pix | prazo
          valor          REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_vendas_pag_venda ON vendas_pagamentos(venda_id);

        -- ====================== Movimentacoes de estoque ===================
        CREATE TABLE IF NOT EXISTS movimentacoes_estoque (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_id    INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
          tipo          TEXT NOT NULL,                -- entrada | saida
          quantidade    REAL NOT NULL,
          custo_unitario REAL,
          estoque_apos  REAL,                         -- saldo do produto apos a movimentacao
          origem        TEXT NOT NULL,                -- compra | venda | ajuste | estorno | inicial
          referencia_id INTEGER,                      -- id da compra/venda relacionada
          observacao    TEXT,
          data          TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_mov_produto ON movimentacoes_estoque(produto_id);
        CREATE INDEX IF NOT EXISTS idx_mov_data ON movimentacoes_estoque(data);

        -- ========================== Contas a pagar =========================
        CREATE TABLE IF NOT EXISTS contas_pagar (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          fornecedor_id   INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
          compra_id       INTEGER REFERENCES compras(id) ON DELETE SET NULL,
          descricao       TEXT NOT NULL,
          valor           REAL NOT NULL DEFAULT 0,
          vencimento      TEXT,
          status          TEXT NOT NULL DEFAULT 'pendente', -- pendente | pago
          forma_pagamento TEXT,
          data_pagamento  TEXT,
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_cpagar_status ON contas_pagar(status);
        CREATE INDEX IF NOT EXISTS idx_cpagar_venc ON contas_pagar(vencimento);

        -- ========================= Contas a receber ========================
        CREATE TABLE IF NOT EXISTS contas_receber (
          id               INTEGER PRIMARY KEY AUTOINCREMENT,
          venda_id         INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
          descricao        TEXT NOT NULL,
          valor            REAL NOT NULL DEFAULT 0,
          parcela          INTEGER NOT NULL DEFAULT 1,
          total_parcelas   INTEGER NOT NULL DEFAULT 1,
          vencimento       TEXT,
          status           TEXT NOT NULL DEFAULT 'pendente', -- pendente | recebido
          forma_recebimento TEXT,
          data_recebimento TEXT,
          criado_em        TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_creceber_status ON contas_receber(status);
        CREATE INDEX IF NOT EXISTS idx_creceber_venc ON contas_receber(vencimento);

        -- ============================== Caixa ==============================
        CREATE TABLE IF NOT EXISTS caixa (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          data_abertura   TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          valor_abertura  REAL NOT NULL DEFAULT 0,
          data_fechamento TEXT,
          valor_fechamento REAL,                      -- valor contado no fechamento
          valor_esperado  REAL,                       -- valor calculado esperado em dinheiro
          diferenca       REAL,                       -- contado - esperado
          status          TEXT NOT NULL DEFAULT 'aberto', -- aberto | fechado
          observacao      TEXT
        );

        CREATE TABLE IF NOT EXISTS caixa_movimentos (
          id       INTEGER PRIMARY KEY AUTOINCREMENT,
          caixa_id INTEGER NOT NULL REFERENCES caixa(id) ON DELETE CASCADE,
          tipo     TEXT NOT NULL,                     -- sangria | suprimento
          valor    REAL NOT NULL DEFAULT 0,
          motivo   TEXT,
          data     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_caixa_mov_caixa ON caixa_movimentos(caixa_id);

        -- ============================== Config =============================
        CREATE TABLE IF NOT EXISTS config (
          chave TEXT PRIMARY KEY,
          valor TEXT
        );
      `);
    },
  },
  {
    version: 2,
    name: 'clientes-e-fiado',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS clientes (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          nome           TEXT NOT NULL,
          cpf            TEXT,
          telefone       TEXT,
          email          TEXT,
          endereco       TEXT,
          limite_credito REAL NOT NULL DEFAULT 0,
          observacao     TEXT,
          ativo          INTEGER NOT NULL DEFAULT 1,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_clientes_nome ON clientes(nome);

        ALTER TABLE vendas ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
        ALTER TABLE contas_receber ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;
      `);
    },
  },
  {
    version: 3,
    name: 'kits-e-variacoes',
    up(db) {
      db.exec(`
        -- Kits/combos: produto composto por outros produtos (estoque
        -- controlado pelos componentes, nao pelo proprio kit).
        ALTER TABLE produtos ADD COLUMN eh_kit INTEGER NOT NULL DEFAULT 0;
        -- Variacoes: rotulo livre para agrupar produtos gerados em lote
        -- (ex: "Camiseta Modelo X" com variacao "Tamanho M").
        ALTER TABLE produtos ADD COLUMN grupo_variacao TEXT;
        ALTER TABLE produtos ADD COLUMN variacao TEXT;

        CREATE TABLE IF NOT EXISTS produtos_composicao (
          id                    INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_kit_id        INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
          produto_componente_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE RESTRICT,
          quantidade            REAL NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS idx_composicao_kit ON produtos_composicao(produto_kit_id);
        CREATE INDEX IF NOT EXISTS idx_produtos_grupo_variacao ON produtos(grupo_variacao);
      `);
    },
  },
  {
    version: 4,
    name: 'contas-fixas',
    up(db) {
      db.exec(`
        -- Contas fixas: modelo de conta a pagar recorrente (aluguel, internet,
        -- agua/luz...). A cada mes, uma conta_pagar e gerada automaticamente
        -- a partir do modelo, se ainda nao existir uma para o mes corrente.
        CREATE TABLE IF NOT EXISTS contas_fixas (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          descricao      TEXT NOT NULL,
          fornecedor_id  INTEGER REFERENCES fornecedores(id) ON DELETE SET NULL,
          valor          REAL NOT NULL DEFAULT 0,
          dia_vencimento INTEGER NOT NULL,     -- 1 a 31 (ajustado ao ultimo dia do mes quando necessario)
          ativa          INTEGER NOT NULL DEFAULT 1,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        ALTER TABLE contas_pagar ADD COLUMN conta_fixa_id INTEGER REFERENCES contas_fixas(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_cpagar_conta_fixa ON contas_pagar(conta_fixa_id);
      `);
    },
  },
];

/**
 * Aplica todas as migrations pendentes. Idempotente.
 */
function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version    INTEGER NOT NULL,
      aplicada_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
    );
  `);

  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get();
  const atual = row && row.v ? row.v : 0;

  const pendentes = migrations
    .filter((m) => m.version > atual)
    .sort((a, b) => a.version - b.version);

  for (const m of pendentes) {
    const aplicar = db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(m.version);
    });
    aplicar();
    // eslint-disable-next-line no-console
    console.log(`[db] migration aplicada: v${m.version} (${m.name})`);
  }

  return { de: atual, para: migrations[migrations.length - 1].version };
}

module.exports = { runMigrations };
