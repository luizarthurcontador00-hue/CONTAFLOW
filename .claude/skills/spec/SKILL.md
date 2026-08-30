---
name: spec
description: Transforma uma ideia em um plano. Faz uma entrevista com o usuário até compreender completamente o que ele deseja, e então redige uma especificação detalhada para guiar a construção. Use quando o usuário disser "/spec" ou pedir para planejar um novo recurso ou aplicativo antes de começar a construir.
---

Delegue todo o planejamento a um subagente rodando no modelo **Opus 5** (mais
capaz para entender requisitos ambíguos e prever casos extremos), em vez de
conduzir a entrevista você mesmo nesta conversa.

Use a ferramenta Agent com:
- `subagent_type`: `"general-purpose"`
- `model`: `"opus"`
- `run_in_background`: `false` — a entrevista é interativa (o subagente vai
  usar AskUserQuestion diretamente com o usuário); a sessão atual precisa
  esperar terminar antes de continuar.
- `prompt`: instrua o subagente a entrevistar o usuário sobre o recurso ou
  aplicativo que ele quer construir, fazendo **uma pergunta específica por
  vez** (via AskUserQuestion) até entender completamente o objetivo, os
  requisitos indispensáveis, as restrições e o que significa "concluído".
  **Não começar a construir.** Inclua no prompt qualquer contexto relevante
  desta conversa que o subagente precise (o pedido original do usuário,
  módulos/arquivos já mencionados, decisões que já foram tomadas antes) —
  ele não tem acesso ao histórico desta conversa, só ao que você escrever no
  prompt. Quando tiver informações suficientes, o subagente deve escrever
  uma especificação clara e detalhada e salvá-la em `specs/<nome>.md`,
  cobrindo objetivo, requisitos exatos, casos extremos e critérios de
  aceite.

Ao final, resuma para o usuário o que foi decidido e onde o arquivo foi
salvo.
