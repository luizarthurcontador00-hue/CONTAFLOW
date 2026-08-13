@echo off
setlocal
chcp 65001 >nul 2>&1
title ContaFlow
REM ---------------------------------------------------------------------
REM  Esta linha e a mais importante do arquivo: manda o Windows entrar na
REM  pasta onde ESTE arquivo esta antes de rodar qualquer coisa. Sem ela,
REM  o "node server.js" procura o server.js na pasta de onde o Windows
REM  chamou o programa, e da "Cannot find module ...\server.js".
REM ---------------------------------------------------------------------
cd /d "%~dp0"

echo ==================================================================
echo   ContaFlow - Sistema de Controle de Tarefas
echo ==================================================================
echo.

if not exist "server.js" (
    echo [ERRO] Nao encontrei o server.js nesta pasta.
    echo Pasta atual: %CD%
    echo.
    echo Este arquivo precisa ficar DENTRO da pasta do ContaFlow,
    echo do lado do server.js. Nao adianta copiar ele para outro lugar:
    echo para iniciar junto com o Windows, use o
    echo "Ativar inicio automatico.bat", que cria um atalho.
    echo.
    pause
    exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo [ERRO] O Node.js nao foi encontrado.
    echo Instale em https://nodejs.org  e tente de novo.
    echo.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Primeira execucao: instalando as dependencias...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERRO] Falha no npm install.
        pause
        exit /b 1
    )
    echo.
)

echo   Endereco : http://localhost:3000
echo.
echo   Para PARAR o sistema, feche esta janela.
echo ==================================================================
echo.

node server.js

echo.
echo O servidor foi encerrado.
pause
endlocal
