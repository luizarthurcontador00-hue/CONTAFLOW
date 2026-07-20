# Gestor de Vendas (Desktop)

Sistema de **gestão de vendas** para uso local em um único computador, empacotável como aplicativo desktop para Windows (`.exe`). **Não emite nota fiscal** — foca em vendas, estoque, compras, financeiro e relatórios de apoio à gestão.

## Stack

- **Electron** (aplicativo desktop)
- **Node.js + Express** (backend embutido, roda em `127.0.0.1`)
- **SQLite** via `better-sqlite3` (banco em arquivo único, local)
- **Frontend** em HTML/CSS/JS puro (sem build step)

## Estrutura

```
src/
  main/       processo Electron (sobe o Express e abre a janela)
  backend/    Express + SQLite (rotas, serviços, migrations)
  frontend/   interface (HTML/CSS/JS)
data/         banco + uploads (dev); em produção vai para userData
```

## Rodando em desenvolvimento

```bash
npm install
# rebuild do módulo nativo para a ABI do Electron (necessário p/ o app):
npm run rebuild

npm run dev          # abre o app Electron
# ou apenas o backend, para testes:
npm run server       # http://localhost:3000
```

## Banco de dados

O schema é criado/atualizado automaticamente na inicialização por migrations
versionadas (`src/backend/db/migrations.js`). Em desenvolvimento o arquivo fica
em `data/vendas.db`; no app empacotado, na pasta de dados do usuário
(`userData`).

## Empacotamento (Windows)

O instalador `.exe` deve ser gerado **no Windows** (ou em uma máquina/CI Windows),
pois o `electron-builder` reconstrói o módulo nativo `better-sqlite3` para o
Electron e empacota o runtime específico do sistema:

```bash
npm install
npm run dist         # gera o instalador NSIS em dist/ (config em electron-builder.yml)
```

O instalador gerado **não exige** que o usuário final tenha Node.js instalado.
Antes da versão final, adicione um ícone em `build/icon.ico` e descomente a
linha `icon:` em `electron-builder.yml`.

## Backup

- **Manual:** menu **Backup → Fazer backup agora** (no desktop, permite escolher
  a pasta de destino — ex.: pen drive).
- **Automático:** ative a opção "Backup automático diário"; o programa gera uma
  cópia por dia enquanto estiver aberto, mantendo as 15 mais recentes.
- Os backups usam a API online do SQLite (`db.backup()`), segura mesmo com o
  banco em uso (modo WAL).

## Fases de desenvolvimento

1. ✅ Estrutura base (Electron + Express + SQLite + tela inicial)
2. ✅ Cadastro de produtos e categorias (com foto)
3. ✅ Compras com importação de XML de NF-e
4. ✅ Vendas + PDV
5. ✅ Precificação
6. ✅ Financeiro (contas a pagar/receber)
7. ✅ Dashboards e relatórios
8. ✅ Empacotamento final e backup

> A pasta `_legado/` contém o projeto anterior (ContaFlow, gestão de tarefas
> contábeis) arquivado — não faz parte deste sistema.
