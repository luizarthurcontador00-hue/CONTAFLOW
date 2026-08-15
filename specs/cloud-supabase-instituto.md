# Migração do módulo ONG/Instituto do CONTAFLOW para nuvem (Supabase)

## Objetivo

Hoje o CONTAFLOW (Electron + Express + SQLite local) roda inteiramente numa
única máquina, sem login e sem acesso remoto — cada computador tem sua
própria base de dados isolada. Esta primeira etapa da migração para nuvem
tem um objetivo restrito e concreto: fazer com que **instalações
configuradas no modo ONG/Instituto** (`ramo_servico = 'instituto'`) passem a
guardar seus dados no Supabase (Postgres gerenciado) em vez do SQLite local,
com **login de usuário** protegendo o acesso, permitindo que a mesma base
seja acessada de computadores diferentes.

Instalações em qualquer outro modo (comércio, serviço genérico, "ambos")
**não são afetadas por este trabalho** e continuam 100% locais, sem login,
exatamente como funcionam hoje. Isso restringe bastante o raio de impacto
da mudança e elimina o risco de regressão no uso comercial atual do app.

## Requisitos confirmados com o usuário

1. **Escopo por modo, não por módulo isolado**: o gatilho para usar a nuvem
   é a config `ramo_servico = 'instituto'`. Quando esse é o modo ativo, os
   módulos abaixo passam a ler/escrever no Supabase; em qualquer outro modo,
   nada muda.
2. **Sem modo offline** — o app pode exigir conexão com a internet o tempo
   todo para os módulos migrados. Não é necessário sincronização
   posterior nem fila de operações offline.
3. **App desktop (Electron) continua existindo** — só passa a apontar para
   a API na nuvem em vez de `127.0.0.1`, quando `ramo_servico = 'instituto'`.
4. **Multi-empresa pronto, mas não exercido ainda**: o schema e as regras de
   acesso (RLS) devem já isolar dados por organização/empresa desde o
   início (para não ter que redesenhar depois), mas nesta etapa só **uma**
   organização real vai usar o sistema.
5. **Login simples, sem perfis de permissão por enquanto**: cada pessoa loga
   com e-mail/senha (Supabase Auth); todo usuário autenticado da
   organização enxerga e edita tudo igual — sem RBAC granular nesta etapa.
6. **Carregar dados existentes automaticamente**: ao configurar o login pela
   primeira vez, um script (rodado uma vez pelo usuário) precisa ler o
   SQLite local atual e subir os dados para o Supabase, preservando os
   vínculos entre tabelas (ex.: turma → curso → matrículas → presenças).
7. **Sem prazo apertado** — priorizar fazer certo e bem testado antes de
   trocar de vez para a nuvem.
8. **Projeto Supabase**: criar um projeto **novo**, dedicado só a este uso
   (não reaproveitar "LibMoney" nem o projeto vazio já existente na conta).

## Escopo: módulos e tabelas migrados

Baseado no que o próprio app já esconde/mostra no modo ONG hoje
(`ESCONDIDAS_NO_INSTITUTO` em `src/frontend/js/app.js`), ficam **dentro**
do escopo desta migração:

| Módulo | Tabelas (SQLite atual) |
|---|---|
| Pessoas/Clientes (alunos, mantenedores, voluntários — mesma tabela, campo `natureza`) | `clientes` |
| Fornecedores (despesas do instituto: aluguel, gráfica, cordas, etc.) | `fornecedores` |
| Cursos | `cursos` |
| Instrumentos | `instrumentos`, `instrumentos_unidades`, `emprestimos_instrumento`, `alunos_instrumentos_proprios` |
| Turmas | `turmas`, `turmas_horarios`, `turmas_instrutores`, `turmas_instrumentos`, `matriculas`, `aulas_recorrentes` |
| Chamada / Presenças | `presencas` |
| Agenda | `agendamentos`, `profissionais` |
| Voluntários | `voluntarios_disponibilidade`, `voluntarios_atividades` |
| Diretoria (membros) | `membros_instituto` |
| Autorizações | `autorizacoes` |
| Lista de espera | `lista_espera` |
| CRM | `leads` |
| Viagens | `vendas_viagem` |
| Tarefas | `tarefas`, `tarefas_fixas`, `objetivos` |
| Lembretes | `lembretes` |
| Atendimento (WhatsApp) | `conversas_whatsapp`, `mensagens_whatsapp`, `bot_respostas_whatsapp`, `contatos_whatsapp`, `respostas_rapidas_whatsapp`, `mensagens_agendadas_whatsapp`, `mensagens_recorrentes_whatsapp` |
| Financeiro | `contas_pagar`, `contas_receber`, `contas_fixas`, `caixa`, `caixa_movimentos`, `contas_financeiras`, `contas_financeiras_mov`, `categorias_despesa`, `extrato_ofx_transacoes`, `regras_conciliacao` |
| Impacto / Arrecadação | `projetos`, `ofertas`, `doacoes_especie` |
| Atas | `atas`, `atas_participantes` |
| Documentos | `modelos_documento` |
| Configurações | `config` |

**Tabelas a confirmar durante a implementação** (uso compartilhado entre
comércio e instituto, precisa checar caso a caso qual serviço realmente lê
delas no modo instituto antes de decidir se migram): `categorias`,
`assinaturas`, `avisos_enviados`.

### Explicitamente fora de escopo (continuam 100% locais/SQLite)

PDV, Vendas, Produtos (cadastro/fotos/composição), Compras (NF-e), Pedidos
de Compra, Precificação, Sacolas de venda, Comissões, Ordens de
Serviço/Orçamentos, Catálogo, Etiquetas, Cadastro em lote, Conferência de
Mercadoria, Dashboard, Devoluções, Notas Fiscais (módulo fiscal),
movimentações de estoque. Ou seja: toda a tabela `produtos` e o que depende
dela.

## Arquitetura proposta

- **Banco de dados**: Postgres gerenciado pelo Supabase (projeto novo,
  criado nesta etapa). Substitui o SQLite local **apenas para as tabelas
  listadas acima**, num banco separado — o SQLite local continua existindo
  e sendo usado normalmente para tudo que está fora de escopo.
- **Autenticação**: Supabase Auth (e-mail/senha). O sistema de licença por
  chave assinada (`scripts/licenca/`) continua existindo, sem mudanças —
  são camadas independentes: a licença protege a instalação do app, o login
  Supabase protege o acesso aos dados na nuvem.
- **Multi-tenant desde o schema**: toda tabela migrada ganha uma coluna
  `empresa_id` (nova tabela `empresas` no Supabase) e políticas de **Row
  Level Security** que restringem cada usuário autenticado a enxergar só
  as linhas da própria empresa. Só existirá uma linha em `empresas` por
  enquanto, mas a estrutura já suporta adicionar mais organizações sem
  redesenho.
- **Backend**: o Express atual (`src/backend/server.js` + `routes/*` +
  `services/*`) continua existindo como a API que o Electron consome — não
  faz sentido reescrever o frontend para falar direto com o Supabase via
  `supabase-js`, isso manteria a mesma arquitetura de rotas/serviços já
  testada. O que muda é a camada de acesso a dados: os serviços dos módulos
  em escopo passam a rodar contra Postgres (via driver `pg`, com queries
  assíncronas) em vez de `better-sqlite3` (síncrono). Os serviços fora de
  escopo continuam exatamente como estão, apontando pro SQLite local.
- **Hospedagem do backend**: como o Postgres passa a ser gerenciado pelo
  Supabase (sem necessidade de disco persistente no servidor da API), a
  hospedagem do Express fica mais simples/barata do que se estivesse
  guardando arquivos SQLite — dá pra usar uma camada gratuita/barata
  (Fly.io, Render ou Railway) sem o risco de perda de dados por reinício
  que existiria se fosse SQLite num disco efêmero.
- **Modo de operação do app**: ao iniciar, o Electron lê `ramo_servico` da
  config local. Se for `instituto`, a UI pede login (Supabase Auth) antes
  de liberar as telas dos módulos em escopo, e a API dessas telas passa a
  apontar para o backend na nuvem. Se for qualquer outro modo, comportamento
  idêntico ao atual (sem login, tudo local).

## Migração dos dados existentes

Script único (rodado manualmente pelo usuário na primeira vez que ativar o
modo nuvem numa instalação): lê o SQLite local (só as tabelas em escopo),
gera a linha da empresa no Supabase, e insere os dados preservando as
chaves estrangeiras (ex.: recriar `cursos` primeiro, depois `turmas`
referenciando o novo id do curso, depois `matriculas` referenciando o novo
id da turma, e assim por diante — os ids do Postgres não precisam bater com
os ids antigos do SQLite, só as referências entre as tabelas migradas
precisam continuar consistentes entre si). Depois de migrar, o usuário loga
e os dados aparecem carregados — exatamente como pedido.

## Casos extremos a tratar

- **Instalação nova, sem dados locais ainda**: o script de migração deve
  rodar sem erro mesmo com tabelas vazias (não é obrigatório ter dado
  legado para começar a usar a nuvem).
- **Rodar o script duas vezes por engano**: não pode duplicar os dados no
  Supabase — precisa de alguma trava (ex.: marcar no config local que a
  migração já foi feita, ou checar no Supabase se a empresa já tem dados
  antes de inserir de novo).
- **Sem internet no momento do login**: mensagem de erro clara — já que não
  há modo offline, o usuário precisa entender que precisa de conexão.
- **Trocar o modo de `instituto` para outro depois de já estar na nuvem**:
  fora de escopo resolver agora (não é um fluxo previsto nesta etapa); só
  precisa não quebrar o app — o comportamento pode ficar indefinido/a
  esclarecer quando esse caso aparecer de verdade.

## Critérios de aceite

- [ ] Projeto Supabase novo criado, com tabelas + RLS para todos os módulos
      listados no escopo, isoladas por `empresa_id`.
- [ ] Numa instalação com `ramo_servico = 'instituto'`, abrir o app pede
      login (e-mail/senha) antes de mostrar as telas dos módulos em escopo.
- [ ] Script de migração roda uma vez, sobe os dados locais existentes
      (cursos, turmas, matrículas, presenças, financeiro, agenda,
      voluntários, etc.) para o Supabase preservando os vínculos entre eles.
- [ ] Depois de logar, todas as telas dos módulos em escopo mostram os
      dados migrados corretamente (nada aparece vazio ou duplicado).
- [ ] Criar/editar/excluir em qualquer módulo em escopo persiste no
      Supabase e aparece igual ao abrir o sistema em outro computador
      logado com a mesma conta.
- [ ] Módulos fora de escopo (PDV, Vendas, Produtos, etc.) continuam
      funcionando exatamente como hoje, sem exigir login, para qualquer
      modo (incluindo instalações que não são `instituto`).
- [ ] Instalação em modo comércio/serviço/"ambos" não pede login em nenhum
      momento — comportamento idêntico ao atual, sem regressão.
- [ ] Testes de backend (Node contra o Postgres do Supabase) e um teste de
      navegador cobrindo login → carregamento de dados migrados → criar um
      registro novo → conferir que persistiu.

## Decisões técnicas assumidas (revisar se algo estiver errado)

- O sistema de licença por chave (`scripts/licenca/`) **não muda** — login
  Supabase é uma camada adicional, não substitui a ativação da licença.
- `categorias`, `assinaturas` e `avisos_enviados` têm uso ambíguo
  (compartilhado com módulos fora de escopo) e serão avaliadas tabela por
  tabela durante a implementação, não bloqueiam o início do trabalho.
- Não é necessário migrar o histórico de `movimentacoes_estoque` nem
  qualquer tabela ligada a `produtos`, já que Produtos está fora de escopo.
