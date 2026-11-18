@echo off
rem Robo de D+1: troca o Zoom pela gravacao (ter/qua/qui). %* = argumentos extras (ex.: --gravar embed)
rem O proprio robo escreve no log (--log), sem prender o arquivo: rodadas que comecam juntas nao se derrubam.
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" scripts\troca-gravacao.mjs %* --log troca-gravacao.log
