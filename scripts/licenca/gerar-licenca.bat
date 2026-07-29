@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

echo ===============================================
echo   Gerador de chave de ativacao - ContaFlow
echo ===============================================
echo.

set /p CLIENTE=Nome do cliente:
if "%CLIENTE%"=="" (
  echo.
  echo Voce precisa informar um nome. Feche esta janela e tente de novo.
  pause
  exit /b 1
)

set /p MAQUINA=ID da maquina do cliente (ex.: A3B5-22EA-A6F7-DD89):
if "%MAQUINA%"=="" (
  echo.
  echo Voce precisa informar o ID da maquina. Feche esta janela e tente de novo.
  pause
  exit /b 1
)

set DIAS=365
set /p DIAS=Validade em dias (Enter para 365 = 1 ano):
if "%DIAS%"=="" set DIAS=365

echo.
node "%~dp0gerar-licenca.js" --cliente "%CLIENTE%" --maquina "%MAQUINA%" --dias %DIAS%

if errorlevel 1 (
  echo.
  echo Alguma coisa deu errado ao gerar a chave ^(veja a mensagem acima^).
  pause
  exit /b 1
)

echo.
echo ===============================================
echo Copie a chave "CF1...." acima e envie para o cliente.
echo ===============================================
pause
