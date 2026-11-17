@echo off
rem Robo de D+1: troca o Zoom pela gravacao (ter/qua/qui). %* = argumentos extras (ex.: --gravar embed)
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" scripts\troca-gravacao.mjs %* >> troca-gravacao.log 2>&1
