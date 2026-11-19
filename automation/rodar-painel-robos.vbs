' Painel dos robos: refaz painel\painel-robos.html sem abrir janela (tarefa "Painel robos", a cada 5 min).
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
sh.CurrentDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
sh.Run """C:\Program Files\nodejs\node.exe"" scripts\painel-robos.mjs", 0, True
