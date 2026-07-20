# Recursos de build

Coloque aqui os recursos usados pelo `electron-builder` na geração do instalador.

## Ícone do aplicativo

Adicione o ícone do Windows como `build/icon.ico` (recomendado 256×256, formato
`.ico`). Depois, descomente a linha `icon: build/icon.ico` em
`electron-builder.yml`.

Se nenhum ícone for fornecido, o `electron-builder` usa o ícone padrão do
Electron — o instalador funciona normalmente, apenas sem a identidade visual.
