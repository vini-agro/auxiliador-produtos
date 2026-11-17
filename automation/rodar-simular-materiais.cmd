@echo off
rem Simulacao diaria dos materiais das aulas (16h). %* = argumentos extras (ex.: --teams)
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" scripts\simular-materiais.mjs %* >> simular-materiais.log 2>&1
