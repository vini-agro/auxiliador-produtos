@echo off
rem Robo Materiais: anexa os PDFs da pasta Share nas aulas da LW e avisa no Teams. %* = argumentos (ex.: --gravar --teams)
rem O proprio robo escreve no log (--log), sem prender o arquivo.
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" scripts\simular-materiais.mjs %* --log simular-materiais.log
