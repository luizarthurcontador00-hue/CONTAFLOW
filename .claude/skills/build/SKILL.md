---
name: build
description: Constrói diretamente a partir da especificação e constrói exatamente o que está escrito. Sem recursos extras, sem escopo redefinido, sem palpites. Use quando o usuário disser "/build" ou pedir para implementar o que foi definido em uma especificação salva em specs/.
---

Delegue a implementação a um subagente rodando no modelo **Sonnet 5**, em
vez de escrever o código você mesmo nesta conversa.

Use a ferramenta Agent com:
- `subagent_type`: `"general-purpose"`
- `model`: `"sonnet"`
- `run_in_background`: `false` — a sessão atual continua responsável pelo
  que vem depois (testar, commitar, enviar).
- `prompt`: instrua o subagente a ler a especificação em `specs/<nome>.md` e
  construir **exatamente** o que ela descreve — sem adicionar
  funcionalidades, sem refatorar código irrelevante, sem inventar
  requisitos que não estejam na especificação. Ao concluir, o subagente
  deve listar quais requisitos da especificação atendeu (para a etapa de
  revisão poder verificá-los) e quais arquivos alterou ou criou.

Depois que o subagente retornar, a sessão atual (você) continua responsável
por: testar as mudanças, verificar que nenhum arquivo sensível (licença,
chave privada, log de emissão) foi tocado antes de qualquer commit, e
prosseguir com commit/push seguindo as convenções já estabelecidas neste
projeto — o subagente **não** deve fazer commit sozinho.
