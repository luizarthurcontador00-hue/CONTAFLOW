@echo off
setlocal
chcp 65001 >nul 2>&1
title ContaFlow - Ativar inicio automatico
cd /d "%~dp0"

echo ==================================================================
echo   INICIAR O CONTAFLOW JUNTO COM O WINDOWS
echo ==================================================================
echo.

if not exist "server.js" (
    echo [ERRO] Este arquivo precisa estar na pasta do ContaFlow,
    echo do lado do server.js.
    echo Pasta atual: %CD%
    echo.
    pause
    exit /b 1
)

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "ATALHO=%STARTUP%\ContaFlow.lnk"
set "ALVO=%~dp0INICIAR CONTAFLOW.bat"

if not exist "%ALVO%" (
    echo [ERRO] Nao encontrei o "INICIAR CONTAFLOW.bat" nesta pasta.
    echo.
    pause
    exit /b 1
)

REM ---------------------------------------------------------------------
REM  Cria um ATALHO na pasta de inicializacao, e nao uma copia do .bat.
REM  O atalho guarda a "pasta de trabalho" (WorkingDirectory), que e o que
REM  faz o node achar o server.js. Copiar o .bat para a pasta Startup nao
REM  funciona: la a pasta de trabalho vira a propria Startup.
REM ---------------------------------------------------------------------
powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%ATALHO%');" ^
  "$s.TargetPath = '%ALVO%';" ^
  "$s.WorkingDirectory = '%~dp0';" ^
  "$s.WindowStyle = 7;" ^
  "$s.Description = 'ContaFlow';" ^
  "$s.Save()"

if exist "%ATALHO%" (
    echo Pronto! O ContaFlow vai abrir sozinho quando o Windows iniciar.
    echo.
    echo Atalho criado em:
    echo   %ATALHO%
    echo Apontando para:
    echo   %ALVO%
    echo.
    echo Para desligar isso depois, use o "Desativar inicio automatico.bat".
) else (
    echo [ERRO] Nao consegui criar o atalho.
    echo.
    echo Faca a mao: aperte Windows+R, digite  shell:startup  e ARRASTE
    echo o "INICIAR CONTAFLOW.bat" para dentro da pasta que abrir,
    echo segurando ALT ^(assim o Windows cria um atalho, nao uma copia^).
)

echo.
pause
endlocal
