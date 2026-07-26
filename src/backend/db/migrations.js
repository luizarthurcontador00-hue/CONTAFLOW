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
  {
    version: 5,
    name: 'precificacao-markup-divisor',
    up(db) {
      db.exec(`
        -- Configuracao de faturamento e impostos (linha unica - Modulo 2).
        CREATE TABLE IF NOT EXISTS precificacao_config (
          id                    INTEGER PRIMARY KEY CHECK (id = 1),
          faturamento_mensal    REAL NOT NULL DEFAULT 0,
          simples_nacional_pct  REAL NOT NULL DEFAULT 0,
          icms_pct              REAL NOT NULL DEFAULT 0,
          pis_pct               REAL NOT NULL DEFAULT 0,
          cofins_pct            REAL NOT NULL DEFAULT 0,
          ir_pct                REAL NOT NULL DEFAULT 0,
          cs_pct                REAL NOT NULL DEFAULT 0,
          ibs_pct               REAL NOT NULL DEFAULT 0,
          cbs_pct                REAL NOT NULL DEFAULT 0,
          atividade             TEXT NOT NULL DEFAULT 'comercio',
          atualizado_em         TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        INSERT OR IGNORE INTO precificacao_config (id) VALUES (1);

        -- Despesas fixas e variaveis (Modulo 3).
        CREATE TABLE IF NOT EXISTS precificacao_despesas (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo       TEXT NOT NULL CHECK (tipo IN ('fixa','variavel')),
          descricao  TEXT NOT NULL,
          valor      REAL NOT NULL DEFAULT 0,
          ordem      INTEGER NOT NULL DEFAULT 0
        );

        -- Produtos/servicos da planilha de precificacao (Modulo 5).
        CREATE TABLE IF NOT EXISTS precificacao_produtos (
          id                 INTEGER PRIMARY KEY AUTOINCREMENT,
          referencia         TEXT,
          descricao          TEXT NOT NULL,
          quantidade         REAL NOT NULL DEFAULT 1,
          valor_pedido       REAL NOT NULL DEFAULT 0,
          custo_embalagem    REAL NOT NULL DEFAULT 0,
          custo_frete_fixo   REAL NOT NULL DEFAULT 0,
          frete_pct          REAL NOT NULL DEFAULT 0,
          taxa_cartao_pct    REAL NOT NULL DEFAULT 0,
          margem_pct         REAL NOT NULL DEFAULT 0,
          usar_margem_setor  INTEGER NOT NULL DEFAULT 1,
          preco_mercado      REAL,
          preco_praticado    REAL,
          ordem              INTEGER NOT NULL DEFAULT 0,
          criado_em          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em      TEXT
        );
      `);

      // Itens padrao de despesas (valor 0 - usuario preenche depois).
      const fixas = [
        'Aluguel', 'Internet', 'Condomínio', 'Pró-labore', 'Material de escritório',
        'Luz/Água', 'Telefone', 'Remunerações (Salário, Férias, 13º)',
        'Manutenção patrimonial', 'Outras despesas tributárias (MEI)',
        'Outras despesas com pessoal', 'Outros gastos gerais',
      ];
      const variaveis = [
        'Matérias-primas', 'Embalagens', 'Etiquetas', 'Mercadoria para revenda',
        'Frete', 'Propaganda e publicidade', 'Comissão',
      ];
      const ins = db.prepare('INSERT INTO precificacao_despesas (tipo, descricao, valor, ordem) VALUES (?, ?, 0, ?)');
      fixas.forEach((d, i) => ins.run('fixa', d, i));
      variaveis.forEach((d, i) => ins.run('variavel', d, i));
    },
  },
  {
    version: 6,
    name: 'precificacao-vinculo-produtos',
    up(db) {
      db.exec(`
        -- Vincula uma linha da precificacao ao produto real (para aplicar o
        -- preco sugerido de volta ao cadastro) e agrupa por lote de importacao.
        ALTER TABLE precificacao_produtos ADD COLUMN produto_id INTEGER REFERENCES produtos(id) ON DELETE SET NULL;
        ALTER TABLE precificacao_produtos ADD COLUMN lote TEXT;       -- rotulo do grupo (ex: "Cadastro em lote 20/07/2026 20:00")
        ALTER TABLE precificacao_produtos ADD COLUMN lote_data TEXT;  -- timestamp ISO para ordenar os grupos
        CREATE INDEX IF NOT EXISTS idx_prec_prod_lote ON precificacao_produtos(lote);
        CREATE INDEX IF NOT EXISTS idx_prec_prod_produto ON precificacao_produtos(produto_id);
      `);
    },
  },
  {
    version: 7,
    name: 'contas-financeiras-e-parcelamento',
    up(db) {
      db.exec(`
        -- Contas financeiras (carteiras/saldos): banco, dinheiro em caixa,
        -- maquina de cartao... Cada conta tem um saldo inicial e um extrato de
        -- movimentos; o saldo atual e o saldo inicial + entradas - saidas.
        CREATE TABLE IF NOT EXISTS contas_financeiras (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          nome          TEXT NOT NULL,
          tipo          TEXT NOT NULL DEFAULT 'outro',   -- dinheiro | banco | cartao | outro
          saldo_inicial REAL NOT NULL DEFAULT 0,
          ativa         INTEGER NOT NULL DEFAULT 1,
          ordem         INTEGER NOT NULL DEFAULT 0,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- Extrato das contas financeiras (uma linha por entrada/saida).
        CREATE TABLE IF NOT EXISTS contas_financeiras_mov (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          conta_id      INTEGER NOT NULL REFERENCES contas_financeiras(id) ON DELETE CASCADE,
          data          TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          tipo          TEXT NOT NULL,                   -- entrada | saida
          valor         REAL NOT NULL DEFAULT 0,
          origem        TEXT NOT NULL,                   -- venda | recebimento | pagamento | ajuste | abertura
          referencia_id INTEGER,
          descricao     TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_cfin_mov_conta ON contas_financeiras_mov(conta_id);
        CREATE INDEX IF NOT EXISTS idx_cfin_mov_data ON contas_financeiras_mov(data);

        -- Parcelamento das contas a pagar + conta financeira usada no pagamento.
        ALTER TABLE contas_pagar ADD COLUMN parcela INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE contas_pagar ADD COLUMN total_parcelas INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE contas_pagar ADD COLUMN conta_financeira_id INTEGER REFERENCES contas_financeiras(id) ON DELETE SET NULL;

        -- Marca as contas a receber geradas por venda a vista (registro ja
        -- "recebido"), para nao duplicar no fluxo de caixa; + conta usada.
        ALTER TABLE contas_receber ADD COLUMN tipo TEXT NOT NULL DEFAULT 'normal';  -- normal | venda_vista
        ALTER TABLE contas_receber ADD COLUMN conta_financeira_id INTEGER REFERENCES contas_financeiras(id) ON DELETE SET NULL;
      `);

      // Contas padrao.
      const ins = db.prepare('INSERT INTO contas_financeiras (nome, tipo, ordem) VALUES (?, ?, ?)');
      const idCaixa = ins.run('Caixa (dinheiro)', 'dinheiro', 0).lastInsertRowid;
      const idBanco = ins.run('Banco', 'banco', 1).lastInsertRowid;
      const idCartao = ins.run('Máquina de cartão', 'cartao', 2).lastInsertRowid;

      // Mapa forma de pagamento -> conta financeira (editavel em Configuracoes).
      const mapa = {
        dinheiro: idCaixa,
        pix: idBanco,
        transferencia: idBanco,
        boleto: idBanco,
        cartao_credito: idCartao,
        cartao_debito: idCartao,
      };
      db.prepare("INSERT INTO config (chave, valor) VALUES ('financeiro_mapa_contas', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor")
        .run(JSON.stringify(mapa));
    },
  },
  {
    version: 8,
    name: 'produtos-multiplas-fotos',
    up(db) {
      db.exec(`
        -- Galeria de fotos por produto. A foto marcada como principal continua
        -- refletida em produtos.foto_path (compatibilidade com cards/PDV/etc.).
        CREATE TABLE IF NOT EXISTS produtos_fotos (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          produto_id INTEGER NOT NULL REFERENCES produtos(id) ON DELETE CASCADE,
          arquivo    TEXT NOT NULL,
          ordem      INTEGER NOT NULL DEFAULT 0,
          principal  INTEGER NOT NULL DEFAULT 0,
          criado_em  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_produtos_fotos_produto ON produtos_fotos(produto_id);

        -- Migra a foto unica existente para a galeria (como principal).
        INSERT INTO produtos_fotos (produto_id, arquivo, ordem, principal)
          SELECT id, foto_path, 0, 1 FROM produtos
          WHERE foto_path IS NOT NULL AND TRIM(foto_path) <> '';
      `);
    },
  },
  {
    version: 9,
    name: 'dre-categorias-despesa',
    up(db) {
      db.exec(`
        -- Categorias de despesa (para o DRE). Categorias com considera_dre=0
        -- (ex.: compra de mercadoria) ficam de fora das despesas operacionais
        -- do DRE, pois entram no resultado via CMV quando o item e vendido.
        CREATE TABLE IF NOT EXISTS categorias_despesa (
          id            INTEGER PRIMARY KEY AUTOINCREMENT,
          nome          TEXT NOT NULL,
          considera_dre INTEGER NOT NULL DEFAULT 1,
          ordem         INTEGER NOT NULL DEFAULT 0,
          criado_em     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        ALTER TABLE contas_pagar ADD COLUMN categoria_despesa_id INTEGER REFERENCES categorias_despesa(id) ON DELETE SET NULL;
      `);

      const ins = db.prepare('INSERT INTO categorias_despesa (nome, considera_dre, ordem) VALUES (?, ?, ?)');
      const operacionais = [
        'Aluguel', 'Água / Luz / Internet', 'Salários e encargos', 'Pró-labore',
        'Impostos e taxas', 'Marketing e propaganda', 'Manutenção', 'Frete / Logística',
        'Despesas administrativas', 'Outras despesas',
      ];
      operacionais.forEach((n, i) => ins.run(n, 1, i));
      // Categoria especial: compra de mercadoria (fora do DRE — vira CMV na venda).
      const idCompras = ins.run('Compra de mercadoria', 0, operacionais.length).lastInsertRowid;

      db.prepare("INSERT INTO config (chave, valor) VALUES ('categoria_compras_id', ?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor")
        .run(String(idCompras));
      // Gerar codigo de barras interno automaticamente ao importar produtos.
      db.prepare("INSERT INTO config (chave, valor) VALUES ('gerar_codigo_auto', '1') ON CONFLICT(chave) DO NOTHING")
        .run();
    },
  },
  {
    version: 10,
    name: 'servicos',
    up(db) {
      db.exec(`
        -- Serviços: reaproveitam a tabela de produtos, mas nao controlam
        -- estoque. eh_servico=1 marca o item como servico (ex.: corte de
        -- cabelo, mao de obra, consultoria). duracao_min = duracao estimada.
        ALTER TABLE produtos ADD COLUMN eh_servico INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE produtos ADD COLUMN duracao_min INTEGER;
        CREATE INDEX IF NOT EXISTS idx_produtos_eh_servico ON produtos(eh_servico);
      `);
    },
  },
  {
    version: 11,
    name: 'ordens-servico-e-orcamentos',
    up(db) {
      db.exec(`
        -- Ordens de servico e orcamentos (mesma estrutura, campo tipo).
        --  tipo 'os'        -> status: aberta|em_andamento|concluida|entregue|cancelada
        --  tipo 'orcamento' -> status: aberto|aprovado|recusado|expirado|cancelada
        CREATE TABLE IF NOT EXISTS ordens_servico (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          tipo           TEXT NOT NULL DEFAULT 'os',
          numero         INTEGER NOT NULL,
          cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          status         TEXT NOT NULL DEFAULT 'aberta',
          -- Dados do equipamento/objeto (OS de oficina/assistencia tecnica).
          equipamento    TEXT,
          marca_modelo   TEXT,
          identificacao  TEXT,          -- serie/placa/patrimonio
          defeito        TEXT,          -- defeito relatado / escopo do servico
          laudo          TEXT,          -- diagnostico/solucao
          responsavel    TEXT,          -- tecnico responsavel (texto livre)
          observacao     TEXT,
          desconto       REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0,
          garantia_dias  INTEGER NOT NULL DEFAULT 0,
          validade       TEXT,          -- validade do orcamento (data)
          data_previsao  TEXT,
          data_conclusao TEXT,
          data_entrega   TEXT,
          venda_id       INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
          atualizado_em  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_os_tipo ON ordens_servico(tipo);
        CREATE INDEX IF NOT EXISTS idx_os_status ON ordens_servico(status);
        CREATE INDEX IF NOT EXISTS idx_os_cliente ON ordens_servico(cliente_id);

        CREATE TABLE IF NOT EXISTS ordens_servico_itens (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          os_id          INTEGER NOT NULL REFERENCES ordens_servico(id) ON DELETE CASCADE,
          produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,
          tipo           TEXT NOT NULL DEFAULT 'produto',  -- produto | servico | livre
          descricao      TEXT NOT NULL,
          quantidade     REAL NOT NULL DEFAULT 1,
          preco_unitario REAL NOT NULL DEFAULT 0,
          custo_unitario REAL NOT NULL DEFAULT 0,
          valor_total    REAL NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_os_itens_os ON ordens_servico_itens(os_id);
      `);
    },
  },
  {
    version: 12,
    name: 'agenda-e-profissionais',
    up(db) {
      db.exec(`
        -- Profissionais / equipe (usados na Agenda e nas Comissões).
        CREATE TABLE IF NOT EXISTS profissionais (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          nome         TEXT NOT NULL,
          telefone     TEXT,
          cor          TEXT NOT NULL DEFAULT '#2563eb',
          comissao_pct REAL NOT NULL DEFAULT 0,
          ativo        INTEGER NOT NULL DEFAULT 1,
          criado_em    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );

        -- Agendamentos (horários marcados). Podem virar venda ao "atender".
        CREATE TABLE IF NOT EXISTS agendamentos (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          data           TEXT NOT NULL,                 -- YYYY-MM-DD
          hora_inicio    TEXT NOT NULL,                 -- HH:MM
          hora_fim       TEXT,                          -- HH:MM
          cliente_id     INTEGER REFERENCES clientes(id) ON DELETE SET NULL,
          cliente_nome   TEXT,                          -- avulso (sem cadastro)
          telefone       TEXT,
          profissional_id INTEGER REFERENCES profissionais(id) ON DELETE SET NULL,
          produto_id     INTEGER REFERENCES produtos(id) ON DELETE SET NULL,  -- serviço
          servico_nome   TEXT,
          valor          REAL NOT NULL DEFAULT 0,
          status         TEXT NOT NULL DEFAULT 'agendado', -- agendado|confirmado|atendido|cancelado|faltou
          observacao     TEXT,
          venda_id       INTEGER REFERENCES vendas(id) ON DELETE SET NULL,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_agenda_data ON agendamentos(data);
        CREATE INDEX IF NOT EXISTS idx_agenda_prof ON agendamentos(profissional_id);
      `);
    },
  },
  {
    version: 13,
    name: 'comissoes',
    up(db) {
      db.exec(`
        -- Vincula a OS a um profissional cadastrado (opcional), para que o
        -- trabalho de oficina/assistencia tecnica tambem entre no relatorio
        -- de comissoes (alem dos atendimentos da Agenda, que ja tem o vinculo).
        ALTER TABLE ordens_servico ADD COLUMN profissional_id INTEGER REFERENCES profissionais(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_os_profissional ON ordens_servico(profissional_id);

        -- Registro de comissao ja lancada em Contas a Pagar, para nao lancar
        -- a mesma comissao (profissional + periodo) duas vezes.
        CREATE TABLE IF NOT EXISTS comissoes_lancamentos (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          profissional_id INTEGER NOT NULL REFERENCES profissionais(id) ON DELETE CASCADE,
          periodo_inicio  TEXT NOT NULL,
          periodo_fim     TEXT NOT NULL,
          valor           REAL NOT NULL DEFAULT 0,
          conta_pagar_id  INTEGER REFERENCES contas_pagar(id) ON DELETE SET NULL,
          criado_em       TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_comissoes_lanc_prof ON comissoes_lancamentos(profissional_id);
      `);
    },
  },
  {
    version: 14,
    name: 'assinaturas-mensalidades',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS assinaturas (
          id             INTEGER PRIMARY KEY AUTOINCREMENT,
          cliente_id     INTEGER NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
          descricao      TEXT NOT NULL,
          valor          REAL NOT NULL DEFAULT 0,
          dia_vencimento INTEGER NOT NULL,     -- 1 a 31 (ajustado ao ultimo dia do mes quando necessario)
          data_inicio    TEXT NOT NULL DEFAULT (date('now','localtime')),
          data_fim       TEXT,                 -- null = por tempo indeterminado
          observacao     TEXT,
          ativa          INTEGER NOT NULL DEFAULT 1,
          criado_em      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
        );
        CREATE INDEX IF NOT EXISTS idx_assinaturas_cliente ON assinaturas(cliente_id);

        ALTER TABLE contas_receber ADD COLUMN assinatura_id INTEGER REFERENCES assinaturas(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS idx_creceber_assinatura ON contas_receber(assinatura_id);
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
