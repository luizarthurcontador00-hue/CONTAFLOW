# Sistema da ONG 100% web (navegador + Supabase)

> Esta especificação **substitui** a versão anterior deste arquivo, que
> planejava manter o app Electron e migrar só o banco. A direção mudou em
> pontos centrais: agora é um **produto novo, 100% navegador, em repositório
> separado, sem backend próprio**. O que sobreviveu da versão anterior: o
> recorte de módulos da ONG, o Supabase como banco, e a migração dos dados
> que já existem no computador.

## Objetivo

Criar um sistema **acessível por navegador, sem instalar nada**, que atenda
as organizações do tipo **ONG/Instituto** — hoje representadas pelo modo
`perfil_negocio = 'instituto'` do CONTAFLOW desktop.

A ONG que hoje usa o CONTAFLOW instalado num computador passa a acessar o
mesmo trabalho por um endereço na internet, de qualquer máquina ou celular,
com login por pessoa. Os dados que já existem no computador sobem para a
nuvem e o uso local é encerrado para a ONG.

O que **não** é objetivo: mudar qualquer coisa para os clientes de comércio.

## Escopo definido com o usuário

### O que está dentro

Somente os módulos que a ONG usa. A lista foi tirada do próprio código
(`ESCONDIDAS_NO_INSTITUTO` e `rotaRamo` em `src/frontend/js/app.js`), não
inventada — são as telas que o sistema já mostra quando o perfil é
instituto:

| Tela | Módulo |
|---|---|
| `inicio` | Central de Gestão (panorama) |
| `clientes` | Pessoas (alunos, mantenedores, voluntários — campo `natureza`) |
| `fornecedores` | Fornecedores (aluguel, gráfica, cordas) |
| `cursos` | Cursos |
| `instrumentos` | Instrumentos e empréstimos |
| `turmas` | Turmas, horários, instrutores, matrículas |
| `chamada` | Presenças |
| `agenda` | Agenda / agendamentos |
| `voluntarios` | Voluntários |
| `membros` | Diretoria |
| `autorizacoes` | Autorizações |
| `lista-espera` | Lista de espera |
| `atas` | Atas |
| `impacto` | Impacto / Arrecadação (projetos, ofertas, doações) |
| `financeiro` | Contas a pagar/receber, contas fixas, caixa, conciliação OFX |
| `tarefas` | Tarefas e objetivos |
| `lembretes` | Lembretes |
| `relatorios` | Relatórios |
| `configuracoes` | Configurações da organização |
| `backup` | Exportação de dados |

Mais três telas **novas**, que não existem hoje:

| Tela nova | Para quê |
|---|---|
| Login | entrar no sistema (e-mail + senha) |
| Usuários | cadastrar colaboradores e marcar o que cada um acessa |
| Departamentos | criar modelos de acesso reutilizáveis |

### O que está fora, e por quê

- **Todos os módulos de comércio**: PDV, Vendas, Produtos, estoque,
  Compras (XML de NF-e), Pedidos de Compra, Precificação (5 módulos),
  Catálogo, Etiquetas de código de barras, Cadastro em Lote, Conferência de
  Mercadoria, Sacolas, Devoluções, Comissões, Ordens de Serviço/Orçamentos,
  módulo Fiscal, Dashboard. *Motivo: uma ONG não vende; o próprio sistema já
  esconde essas telas no modo instituto.*
- **Atendimento / WhatsApp — removido por completo.** Não existe na versão
  web, em nenhuma forma. Isso inclui as 7 tabelas
  (`conversas_whatsapp`, `mensagens_whatsapp`, `bot_respostas_whatsapp`,
  `contatos_whatsapp`, `respostas_rapidas_whatsapp`,
  `mensagens_agendadas_whatsapp`, `mensagens_recorrentes_whatsapp`), a
  biblioteca `whatsapp-web.js`, **e também os avisos automáticos por
  WhatsApp** que hoje a Agenda, o CRM e as Comissões disparam
  (`avisosWhatsappService.js`). Nenhuma funcionalidade de WhatsApp é
  reimplementada por outro caminho.
- **CRM e Viagens.** A versão anterior desta spec listava as duas no escopo
  da ONG, mas isso estava errado: em `app.js:71`, `crm` e `viagens` são
  exclusivas do ramo `agencia_viagem` e **não aparecem no modo instituto**.
  Ficam fora. *(Ponto a confirmar com o usuário — se ele quiser CRM na ONG,
  é uma adição consciente, não uma migração.)*
- **Envio de e-mail (Brevo)** — descartado. Se em algum momento for preciso
  recuperar senha, o próprio Supabase faz isso.
- **Sistema de licença por máquina** (`scripts/licenca/`) — não existe no
  produto web. Ver "Licenciamento" abaixo.
- **Modo offline.** O sistema exige internet o tempo todo. Não há fila de
  operações nem sincronização posterior.

### O que continua exatamente como está

O **CONTAFLOW desktop atual não é tocado**. Continua Electron + Express +
SQLite, sem login, instalado por máquina, atendendo os clientes de comércio.
Nenhuma tarefa desta spec altera aquele repositório. Isso é definitivo, não
uma fase de transição.

## Decisões confirmadas na entrevista

1. **Navegador puro.** Site acessado por endereço, sem instalador, sem
   `.exe`, sem Electron. Destino final confirmado.
2. **Repositório novo**, separado do CONTAFLOW, chamado **`icmb`**. Criar o
   repositório é parte deste trabalho.
3. **Hospedagem: Cloudflare Pages (telas) + Supabase (todo o resto).**
   **Não existe backend próprio.** As telas conversam direto com o Supabase.
   Custo: R$ 0/mês nos planos gratuitos.
4. **Banco e login: Supabase.** Postgres + Supabase Auth (e-mail/senha) +
   Supabase Storage (arquivos).
5. **Multi-organização desde o início**, mas **hoje só uma ONG real** vai
   usar. O isolamento entre organizações precisa existir desde o primeiro
   dia para não ter que redesenhar depois.
6. **Vários usuários**, com departamentos e permissões, prontos desde o
   começo — mesmo que no início só o Luiz esteja cadastrado.
7. **Migrar e parar de usar o local.** Os dados atuais sobem uma vez; a
   ONG abandona o desktop. Sem uso paralelo.
8. **Tudo pronto de uma vez.** Sem entrega por fases; a troca acontece
   quando o sistema inteiro estiver funcionando.
9. **Sem prazo declarado.** Prioridade é estar certo, não estar rápido.

## Modelo de organização, departamento e permissão

Esta é a parte que **não existe hoje** e precisa ser construída do zero: as
79 tabelas atuais não têm dono — quem abre o programa vê tudo.

### Os três níveis

```
Plataforma (Luiz, super-admin)
   └── Organização (uma ONG)          ← isolamento real de dados
          ├── Departamento            ← só controla acesso, não separa dados
          └── Usuário
```

- **Organização = o cliente.** Todo dado pertence a uma organização e
  **nenhuma organização enxerga dado de outra, nunca**. Duas unidades
  físicas diferentes (ex: "Loja Centro" e "Loja Bairro", ou duas sedes) são
  **duas organizações**, não dois departamentos.
- **Departamento = função dentro da organização.** Serve **só** para dizer
  quais telas a pessoa abre. **Não separa dados.** Dentro de uma organização
  existe **um cadastro de pessoas só, um financeiro só, uma agenda só** — o
  que muda é quem consegue chegar até eles. Ex: quem é do Financeiro abre
  Contas a Pagar/Receber, Caixa e Conciliação; quem é da Secretaria abre
  Turmas, Matrículas e Chamada.
- **Super-admin (Luiz)** tem um painel acima de tudo, para ver e criar
  organizações. É o único papel que atravessa organizações.

### Como a permissão funciona

- O **dono da organização** cria os departamentos e marca, em cada um,
  quais módulos ele abre. O departamento é um **modelo reutilizável**: ao
  cadastrar um colaborador, escolhe-se o departamento e ele herda tudo.
- Além da herança, o dono pode **ligar ou desligar um módulo específico só
  para uma pessoa** (ex: a Maria é da Secretaria, mas excepcionalmente
  também vê Relatórios). O ajuste individual vence o do departamento.
- Cada módulo tem **dois níveis**: `ver` (abre a tela, lê os dados, não
  altera nada) e `mexer` (cria, edita, exclui). Sem marcação = a tela nem
  aparece no menu.
- Além disso existem **travas separadas** para ações sensíveis, marcadas
  uma a uma por usuário. Lista proposta *(a confirmar — a lista original
  discutida era de comércio e foi adaptada para a realidade da ONG)*:
  - ver valores financeiros (saldos, contas, caixa)
  - abrir e fechar caixa
  - excluir registros (turma, matrícula, pessoa, lançamento)
  - ver dados pessoais sensíveis (CPF, endereço, dados de responsáveis
    de menores)
  - ver relatórios completos da organização
  - exportar/baixar dados
  - gerenciar usuários e departamentos

### Tabelas novas

`organizacoes`, `usuarios` (ligada ao Supabase Auth), `departamentos`,
`departamento_modulos`, `usuario_permissoes`, `usuario_travas`.

E **toda tabela migrada ganha `organizacao_id`**, obrigatório, com Row Level
Security ligada.

## Arquitetura

### Como as peças se encaixam

- **Telas**: HTML/CSS/JS estático publicado no **Cloudflare Pages**. A base
  visual pode ser reaproveitada do CONTAFLOW: o frontend atual é JS puro,
  sem framework, sem etapa de build — isso facilita muito o transplante.
- **Banco**: Postgres do **Supabase**, projeto novo e dedicado.
- **Login**: **Supabase Auth**, e-mail/senha.
- **Arquivos** (fotos de alunos/voluntários, anexos): **Supabase Storage**.
  Substitui as pastas em disco de `src/backend/paths.js`.
- **Sem servidor próprio.** As telas usam `supabase-js` e falam direto com
  o banco.

### Onde mora a regra de negócio — o ponto crítico desta migração

Hoje existem **~5.900 linhas** de regra de negócio em Node, nos serviços do
escopo da ONG (`turmasService.js` sozinho tem 1.068 linhas;
`financeiroService.js`, 932). **Sem backend, esse código não tem para onde
ir do jeito que está.** Ele precisa ser redistribuído em três lugares:

1. **No banco (Postgres)** — tudo que precisa ser verdade sempre:
   restrições (`CHECK`, `UNIQUE`, chaves estrangeiras), funções e gatilhos.
   Ex: não permitir duas presenças da mesma pessoa na mesma aula; não
   permitir matrícula em turma lotada; recalcular saldo de caixa.
2. **Em Supabase Edge Functions** — operações que tocam várias tabelas de
   uma vez, ou que **não podem ser confiadas ao navegador**. Ex: gerar as
   aulas de uma turma recorrente, fechar caixa, importar OFX.
3. **No navegador** — só apresentação, montagem de tela e validação leve
   (a que existe para ajudar o usuário, não para proteger o dado).

**Regra inegociável de segurança:** com o navegador falando direto com o
banco, qualquer pessoa logada pode enviar comandos que a tela não enviaria.
Portanto **nenhuma regra de segurança ou de integridade pode viver só no
JavaScript da tela.** A fronteira real é o **RLS** e as restrições do
Postgres. Toda tabela nasce com RLS ligada; nenhuma tabela fica aberta.

### RLS: como as permissões entram

As políticas precisam responder duas perguntas em cada acesso:
1. A linha é da organização deste usuário? (isolamento entre ONGs)
2. Este usuário tem permissão neste módulo, no nível certo? (`ver` para
   leitura, `mexer` para escrita)

Isso se resolve com funções auxiliares em SQL (ex:
`organizacao_atual()` e `pode(modulo, acao)`) usadas por todas as políticas,
para não repetir a lógica 40 vezes e não errar em uma delas.

## Tabelas migradas

Todas ganham `organizacao_id` + RLS:

| Módulo | Tabelas |
|---|---|
| Pessoas | `clientes` |
| Fornecedores | `fornecedores` |
| Cursos | `cursos` |
| Instrumentos | `instrumentos`, `instrumentos_unidades`, `emprestimos_instrumento`, `alunos_instrumentos_proprios` |
| Turmas | `turmas`, `turmas_horarios`, `turmas_instrutores`, `turmas_instrumentos`, `matriculas`, `aulas_recorrentes` |
| Chamada | `presencas` |
| Agenda | `agendamentos`, `profissionais` |
| Voluntários | `voluntarios_disponibilidade`, `voluntarios_atividades` |
| Diretoria | `membros_instituto` |
| Autorizações | `autorizacoes` |
| Lista de espera | `lista_espera` |
| Atas | `atas`, `atas_participantes` |
| Impacto | `projetos`, `ofertas`, `doacoes_especie` |
| Tarefas | `tarefas`, `tarefas_fixas`, `objetivos` |
| Lembretes | `lembretes` |
| Financeiro | `contas_pagar`, `contas_receber`, `contas_fixas`, `caixa`, `caixa_movimentos`, `contas_financeiras`, `contas_financeiras_mov`, `categorias_despesa`, `extrato_ofx_transacoes`, `regras_conciliacao` |
| Documentos | `modelos_documento` |
| Configurações | `config` |

**A avaliar durante a construção** (uso ambíguo, compartilhado com módulos
de comércio): `categorias`, `avisos_enviados`. A `avisos_enviados` em
particular pode existir só por causa dos avisos de WhatsApp — se for esse o
caso, **não migra**.

## Migração dos dados que já existem

Um programa que **roda uma vez**, na máquina onde o CONTAFLOW da ONG está
instalado: lê o SQLite local, cria a organização no Supabase e sobe os
dados **respeitando a ordem das dependências** (cursos → turmas → horários
→ matrículas → presenças; contas financeiras → movimentos; projetos →
ofertas).

Os IDs do Postgres não precisam ser iguais aos do SQLite, mas **os vínculos
entre os registros precisam continuar corretos** — o programa mantém um
mapa `id antigo → id novo` durante a execução.

Depois da migração, o usuário entra no navegador e encontra tudo carregado:
alunos, turmas, presenças, financeiro, agenda.

### Cuidados de conversão que precisam ser tratados

Existem **165 usos de SQL específico do SQLite** no backend atual
(`INSERT OR REPLACE`, `strftime()`, `IFNULL`, `GROUP_CONCAT`,
`lastInsertRowid`, `date('now')`) que **não têm equivalente direto** no
Postgres. Os três que mais podem causar erro silencioso:

- **Datas e fuso horário.** O SQLite usa `date('now')`, que devolve a data
  em UTC; o sistema hoje roda na máquina do usuário, no Brasil. Se isso for
  transportado sem cuidado, **uma chamada feita à noite pode cair no dia
  seguinte**, e a presença aparece na aula errada. Todo campo de data
  precisa ser conferido: o que é "dia do calendário" (aula, vencimento,
  presença) deve ser `date`, não `timestamp`; o que é momento exato deve
  guardar o fuso.
- **Dinheiro.** O SQLite guarda valores como `REAL` (número quebrado, que
  arredonda errado em somas). No Postgres precisa ser `numeric`, senão o
  relatório financeiro fecha com centavos de diferença.
- **Booleanos e nulos.** O SQLite aceita `0`/`1` e é tolerante com tipos;
  o Postgres não é. Cada coluna precisa de tipo declarado de verdade.

## Funcionalidades que dependiam de estar instalado

Cinco coisas hoje só funcionam por ser um programa no computador. Como cada
uma passa a funcionar:

| Hoje (desktop) | Na versão web |
|---|---|
| **Backup** grava arquivo `.db` numa pasta escolhida no Windows (`backupService.js`) | A tela "Backup" vira **exportação**: o navegador baixa os dados (planilha/JSON). O backup real do banco passa a ser responsabilidade do Supabase + uma cópia periódica guardada fora dele. |
| **Gerar PDF** usa o motor do Electron (`preload.js` → `gerarPdf`) | Gerado **no próprio navegador** (impressão para PDF / biblioteca no cliente). Vale para autorizações, atas, recibos e documentos. |
| **Fotos** gravadas em pastas locais (`paths.js`) | **Supabase Storage**, com as mesmas regras de isolamento por organização. |
| **Importar OFX** (extrato do banco) via upload para o servidor | Arquivo **lido dentro do navegador** e enviado já interpretado; ou processado numa Edge Function. |
| **Iniciar com o Windows, ícone na bandeja, licença por máquina** | Deixam de existir. |

**Google Agenda** (`googleAgendaService.js`): a integração atual usa um
fluxo de autorização que abre um servidor em `127.0.0.1` — isso **não
funciona sem programa instalado**. Refazer no padrão web exige registrar um
endereço de retorno no Google Cloud Console. **Fica fora da primeira
versão**; a Agenda funciona normalmente, só não sincroniza com o Google.
*(Decisão a confirmar.)*

## Licenciamento

O sistema atual é ativado por **chave assinada por máquina**
(`scripts/licenca/`, validada localmente sem internet). Isso **não faz
sentido** num sistema sem instalação: não há máquina para amarrar.

Na versão web, o controle de acesso é a **própria conta**: existe
organização cadastrada e usuário com login, ou não existe. Quem cria e
libera organizações é o super-admin (Luiz), pelo painel.

**A chave privada de assinatura de licenças continua fora deste projeto e
não deve ser copiada, referenciada ou exposta em nenhum ponto do
repositório novo.** O repositório do desktop segue com seu sistema de
licença intacto.

## Casos extremos a tratar

- **Sem internet.** Não existe modo offline. A tela precisa dizer
  claramente que perdeu conexão, e **não fingir que salvou** algo que não
  foi salvo.
- **Sessão expirada no meio do trabalho.** Ex: a pessoa passa 40 minutos
  preenchendo uma chamada e o login vence. Não pode perder o que digitou
  sem aviso — precisa pedir para entrar de novo e preservar o preenchimento.
- **Duas pessoas na mesma tela ao mesmo tempo.** Agora que é multiusuário,
  dois instrutores podem abrir a chamada da mesma turma. Definir o
  comportamento: o último a salvar vence, ou avisa que alguém já alterou.
  Vale principalmente para Chamada, Caixa e Matrículas.
- **Rodar a migração duas vezes.** Não pode duplicar. Precisa de trava:
  verificar se a organização já tem dados antes de inserir.
- **Migração interrompida no meio** (queda de internet). Precisa poder
  recomeçar sem deixar metade dos dados soltos.
- **Organização sem nenhum dado ainda** (ONG nova). Tudo precisa funcionar
  vazio, sem erro e sem tela quebrada.
- **Usuário sem nenhuma permissão marcada.** Entra e não vê nada — a tela
  precisa explicar isso ("peça acesso ao responsável"), não mostrar um
  sistema vazio e confuso.
- **O dono removendo a própria permissão** de gerenciar usuários. Precisa
  ser impedido, senão a organização fica sem ninguém que possa administrar.
- **Excluir um departamento que tem gente dentro.** Definir: bloqueia,
  ou as pessoas ficam sem acesso?
- **Tentativa de acessar dado de outra organização** trocando um ID na
  requisição. O RLS precisa barrar. Isso deve ser **testado de propósito**,
  não presumido.
- **Arquivo grande ou formato errado** no envio de foto — limite e mensagem
  clara.
- **Limites do plano gratuito.** Supabase gratuito dá 500 MB de banco, 1 GB
  de arquivos, e **pausa o projeto após uma semana sem nenhum acesso**. Com
  uso diário não pausa, mas em período de férias da ONG pode acontecer —
  precisa estar documentado para não virar susto.

## Critérios de aceite

**Acesso e isolamento**
- [ ] O sistema abre por um endereço no navegador, em qualquer computador
      ou celular, **sem instalar nada**.
- [ ] Sem login, nenhuma tela e nenhum dado são acessíveis.
- [ ] Existem duas organizações de teste com dados; um usuário da
      organização A **não consegue** ver nem alterar nada da organização B,
      **nem mesmo forçando IDs na requisição** (testado de propósito).
- [ ] O painel de super-admin lista as organizações e permite criar uma
      nova.

**Usuários e permissões**
- [ ] O dono cria um departamento, marca os módulos dele e cadastra um
      colaborador nesse departamento; o colaborador entra e vê **apenas**
      os módulos marcados.
- [ ] Um módulo marcado como "só ver" abre a tela mas **não** permite criar,
      editar ou excluir — e isso continua valendo mesmo se a requisição for
      enviada por fora da tela.
- [ ] O ajuste individual (ligar um módulo extra só para uma pessoa)
      funciona e vence o do departamento.
- [ ] As travas sensíveis funcionam: quem não tem "ver valores financeiros"
      não enxerga saldos em nenhuma tela, nem em relatório.

**Dados migrados**
- [ ] O programa de migração roda uma vez sobre o banco real da ONG e sobe
      tudo: pessoas, cursos, turmas, matrículas, presenças, instrumentos,
      agenda, financeiro, projetos, ofertas, atas, autorizações.
- [ ] Conferência de amostra: uma turma escolhida na mão tem, na versão web,
      **os mesmos alunos, os mesmos horários e as mesmas presenças** do
      sistema antigo.
- [ ] Os totais do financeiro (a pagar, a receber, saldo de caixa) batem
      **centavo por centavo** com o sistema antigo.
- [ ] Rodar a migração uma segunda vez **não duplica** nada.

**Funcionamento**
- [ ] Todas as 20 telas do escopo funcionam: abrem, listam, criam, editam e
      excluem.
- [ ] Chamada: marcar presença de uma turma salva e aparece na data certa
      (**conferido perto da virada do dia**, para pegar erro de fuso).
- [ ] Foto de aluno é enviada, aparece na ficha e continua aparecendo em
      outro computador.
- [ ] Gerar PDF de uma autorização e de uma ata funciona pelo navegador.
- [ ] Importar um extrato OFX e conciliar funciona.
- [ ] Exportar os dados pela tela de Backup gera arquivo legível.
- [ ] Perder a conexão no meio de um salvamento mostra erro claro e não dá
      falso "salvo com sucesso".

**Não-regressão**
- [ ] O repositório do CONTAFLOW desktop **não foi alterado** por este
      trabalho.
- [ ] Nenhuma referência a WhatsApp sobrou no produto web: sem tela de
      Atendimento, sem as 7 tabelas, sem a biblioteca, sem avisos
      automáticos disparados por Agenda, Tarefas ou qualquer outro módulo.
- [ ] Nenhum arquivo, chave ou script de licenciamento do desktop foi
      copiado para o repositório novo.

## Pontos ainda em aberto

Não impedem começar, mas precisam de resposta antes de fechar:

1. **CRM e Viagens**: confirmar que ficam fora (o código diz que sim; a
   spec anterior dizia que não).
2. **Lista das travas sensíveis**: a proposta acima foi adaptada de uma
   lista pensada para comércio — confirmar se cobre o que a ONG precisa.
3. **Google Agenda**: confirmar que a sincronização fica fora da primeira
   versão.
4. **Endereço do site** (domínio próprio ou o endereço gratuito do
   Cloudflare Pages).
5. **`categorias` e `avisos_enviados`**: decidir tabela por tabela se
   migram.
6. **Conflito de edição simultânea**: definir o comportamento para Chamada,
   Caixa e Matrículas.
