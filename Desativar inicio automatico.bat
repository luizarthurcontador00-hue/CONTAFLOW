@echo off
setlocal
chcp 65001 >nul 2>&1
title ContaFlow - Desativar inicio automatico

set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"

echo ==================================================================
echo   DESLIGAR O INICIO AUTOMATICO DO CONTAFLOW
echo ==================================================================
echo.

set "ACHOU="
if exist "%STARTUP%\ContaFlow.lnk" (
    del "%STARTUP%\ContaFlow.lnk"
    echo Removido o atalho ContaFlow.lnk
    set "ACHOU=1"
)
REM Remove tambem copias antigas do .bat, que era o jeito que dava erro.
if exist "%STARTUP%\Ativar inicio automatico.bat" (
    del "%STARTUP%\Ativar inicio automatico.bat"
    echo Removida a copia antiga "Ativar inicio automatico.bat"
    set "ACHOU=1"
)
if exist "%STARTUP%\INICIAR CONTAFLOW.bat" (
    del "%STARTUP%\INICIAR CONTAFLOW.bat"
    echo Removida a copia antiga "INICIAR CONTAFLOW.bat"
    set "ACHOU=1"
)

if not defined ACHOU (
    echo Nao havia nada do ContaFlow na inicializacao do Windows.
) else (
    echo.
    echo Pronto. O ContaFlow nao abre mais sozinho.
)

echo.
pause
endlocal
