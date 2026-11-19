# Painel dos robôs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Página local `painel-robos.html`, refeita a cada 5 min, mostrando para cada robô se rodou, erro, aviso no Teams, contagem para a próxima rodada e o que fez.

**Architecture:** Parte pura em `automation/src/painelRobos.js` (estado, resumos, faixa, HTML) testada com `node --test`; coletor `automation/scripts/painel-robos.mjs` lê Agendador (PowerShell JSON), relatórios/logs e n8n, e grava o HTML. Tarefa do Windows oculta via `.vbs` roda o coletor a cada 5 min.

**Tech Stack:** Node 24 (ESM, `node:test`), PowerShell 5.1 `Get-ScheduledTask`, API n8n, HTML/CSS/JS inline sem dependências.

**Spec:** `docs/superpowers/specs/2026-11-19-painel-robos-design.md`

## Global Constraints
- Só leitura: o coletor nunca roda, para ou altera robô, tarefa, LW ou n8n.
- Português, datas dd/mmm/aaaa (ex. 19/nov/2026), sem travessão no texto da página.
- Página única sem CDN nem arquivo externo; claro/escuro por `prefers-color-scheme`.
- Saída em `automation/painel/` (fora do git: adicionar `painel/` ao `.gitignore` de `automation`).
- "OK" só com código 0 **e** relatório/log atualizado na rodada; senão não é verde.
- Tarefa "Painel robos": a cada 5 min, sem janela, roda na bateria, só com usuário logado (igual aos robôs).

## Review Focus
- Log ou pasta de relatório inexistente/vazia (robô novo, log apagado): cartão mostra "sem relatório", não quebra a geração. → teste na Task 2.
- n8n fora do ar ou sem `N8N_API_KEY`: cartão do Presença Zoom fica "não consegui ler o n8n", demais cartões saem. → teste na Task 3 (montarHtml com cartão de erro) e try/catch na Task 4.
- Tarefa com código "ainda rodando" (267009) ou "nunca rodou" (267011): não pode virar erro vermelho. → teste na Task 1.
- Texto de relatório com `<`, `&` ou aspas (títulos de aula): HTML escapado. → teste na Task 3.
- Robô de várias tarefas (Troca 5, Revisor 3) com uma só perdida: cartão do robô fica amarelo e a faixa cita a tarefa exata ("Troca gravacao 10h"). → teste na Task 1.

---

### Task 1: Estado das tarefas e faixa do topo

**Files:**
- Create: `automation/src/painelRobos.js`
- Test: `automation/tests/painelRobos.test.js`

**Interfaces:**
- Produces:
  - `estadoDaTarefa(info, relatorioEm, agora) -> { estado: 'ok'|'erro'|'perdida'|'rodando'|'nunca'|'sem-relatorio', texto: string }` onde `info = { nome, ultima: Date|null, resultado: number, proxima: Date|null, perdidas: number }`, `relatorioEm: Date|null` (mtime do relatório/log).
  - `estadoDoRobo(estados) -> estado` (pior estado; ordem erro > perdida > sem-relatorio > rodando > nunca > ok).
  - `faixaTopo(robos) -> { ok: boolean, itens: string[] }` com `robos = [{ nome, tarefas: [{ nome, estado, texto }] }]`.

- [ ] **Step 1: Testes que falham** em `tests/painelRobos.test.js`:
  - `estadoDaTarefa` com resultado 0 e `relatorioEm` 30 s depois de `ultima` → `'ok'`.
  - resultado 0 e `relatorioEm` 2 h antes de `ultima` → `'sem-relatorio'`.
  - resultado 1 → `'erro'`, `texto` contém `código 1`; resultado 3221225786 → `'erro'`.
  - resultado 267009 → `'rodando'`; 267011 → `'nunca'`.
  - `perdidas: 1` com resultado 0 → `'perdida'`.
  - `estadoDoRobo(['ok','perdida','ok'])` → `'perdida'`; `(['ok','erro','perdida'])` → `'erro'`.
  - `faixaTopo` com Troca [0830 ok, 10h perdida] → `{ ok: false, itens: ['Troca gravacao 10h: rodada perdida'] }`; tudo ok → `{ ok: true, itens: [] }`.
- [ ] **Step 2:** `node --test tests/painelRobos.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** implementar as 3 funções. Tolerância do relatório: `relatorioEm >= ultima - 60 s`.
- [ ] **Step 4:** `node --test tests/painelRobos.test.js` → PASS.

### Task 2: Resumo do que cada robô fez + aviso no Teams

**Files:**
- Modify: `automation/src/painelRobos.js`
- Test: `automation/tests/painelRobos.test.js`

**Interfaces:**
- Produces:
  - `ultimaRodada(texto, inicio: RegExp) -> string` (trecho do log a partir da última linha que casa com `inicio`; texto inteiro se nenhuma; `''` se texto vazio/nulo).
  - `resumir(robo: 'troca'|'divisor'|'revisor'|'materiais'|'certificados', texto) -> string[]` (máx. 5 linhas, já curtas).
  - `avisouTeams(texto) -> boolean` (`/aviso enviado/i`).
  - `INICIO_RODADA = { troca: /^TROCA DO ZOOM PELA GRAVACAO/m, divisor: /^Divisor PROXIMAS AULAS/m, revisor: /conferindo de \d{4}-/, certificados: /olhando cursos alterados/ }` (materiais usa o relatório inteiro mais novo de `simulacao-materiais/`).
- Regras de resumo (valores tirados dos logs reais):
  - troca: por `🎬 <SIGLA>_<DDMMAAAA>_...` uma linha `SIGLA DD/mmm` + o primeiro marcador seguinte entre `🟢 seguro`, `🔴 não seguro`, `ja concluida` → `já feita`, `fora do escopo` → `fora (B2B)`, `❌` → `erro`; sem 🎬 → `Nenhuma gravação nova`.
  - divisor: a linha `Fim: ...`.
  - revisor: `fim: N achado(s) em M aula(s)` + `Mudou desde a ultima conferida: ...` se houver.
  - materiais: linhas `Resumo DD/mmm/AAAA: ...`.
  - certificados: a linha `fim: ...`.

- [ ] **Step 1: Testes que falham**, com trechos reais copiados dos logs (nomes de aluno trocados por fictícios):
  - `ultimaRodada` com dois blocos do divisor devolve só o segundo; `ultimaRodada('', /x/)` → `''`.
  - `resumir('troca', blocoComGPAeVNA)` → `['GPA 16/nov: 🟢 seguro', 'VNA 16/nov: já feita']`.
  - `resumir('divisor', bloco)` → `['Fim: 3 movidos, 7 acertados pela sync, 0 falhas, 0 avisos.']`.
  - `resumir('revisor', bloco)` contém `'fim: 92 achado(s) em 100 aula(s)'`.
  - `resumir('certificados', bloco)` → `['fim: 0 traduzido(s), 0 erro(s).']`.
  - `resumir('materiais', '')` → `[]` (sem relatório não quebra).
  - `avisouTeams('...\naviso enviado pro Teams.')` → `true`; sem a frase → `false`.
- [ ] **Step 2:** rodar → FAIL. **Step 3:** implementar. **Step 4:** rodar → PASS.

### Task 3: HTML da página

**Files:**
- Modify: `automation/src/painelRobos.js`
- Test: `automation/tests/painelRobos.test.js`

**Interfaces:**
- Consumes: estados da Task 1, resumos da Task 2.
- Produces: `montarHtml({ geradoEm: Date, faixa, robos }) -> string`, com `robos = [{ nome, estado, tarefas: [{ nome, estado, texto, ultima, proxima }], resumo: string[], teams: boolean|null, erroLeitura?: string }]`.
- Página: título "Robôs", hora de geração em dd/mmm/aaaa HH:MM, faixa verde "Tudo rodou" ou amarela/vermelha com os itens; um cartão por robô com ícone (✅ ok, ⚠️ perdida/sem-relatorio, ❌ erro, ⏳ rodando, · nunca), última rodada, "próxima HH:MM em Xh Ymin" calculada no navegador a partir de `data-proxima="<ISO>"`, e **barra de progresso** (pedido do usuário) que enche da última rodada até a próxima (`data-ultima` + `data-proxima`, largura = (agora - ultima)/(proxima - ultima)), cor da barra = estado do robô; contagem e barra atualizam a cada 1 s (visual aprovado no esboço de 19/nov: cartões em grade, faixa do topo, ícone de estado à direita do nome), lista de tarefas do robô, linhas do resumo, "Teams: sim/não". Aviso discreto se a página tiver mais de 15 min (geração parou). `<meta http-equiv="refresh" content="300">`.

- **Perguntar ao Claude (pedido do usuário, opção 1):** cada cartão tem um campo de texto e o botão "Copiar pergunta". Copia para a área de transferência: `Painel dos robôs · <robô> · <estado> (última rodada <dd/mmm HH:MM>)` + uma linha por fonte (`Log: <caminho>` / `Relatório: <caminho>`) + `Pergunta: <texto>`. Usa `navigator.clipboard.writeText` e, se falhar, `execCommand('copy')`; mostra "Copiado. Cole numa conversa do Claude Code." Campo vazio = aviso inline "Escreva a pergunta primeiro". Nada sai do PC. `robos[].fontes: string[]` traz os caminhos absolutos.

- [ ] **Step 1: Testes que falham:**
  - Cartão com `fontes: ['C:\\x\\troca-gravacao.log']` tem botão `Copiar pergunta` e o caminho em `data-fontes` (escapado).
  - HTML contém `Tudo rodou` quando `faixa.ok`; contém `Troca gravacao 10h: rodada perdida` quando não.
  - Resumo `Aula <A&B> "x"` aparece escapado (`&lt;A&amp;B&gt;`), nunca cru.
  - Cada tarefa com `proxima` gera `data-proxima="2026-11-19T13:00:00.000Z"`; o cartão do robô gera `data-ultima` e `data-proxima` da sua barra (próxima = a mais cedo entre as tarefas do robô; última = a mais recente).
  - Robô sem próxima rodada (tarefa desligada) não gera barra e mostra "sem próxima rodada".
  - Robô com `erroLeitura: 'não consegui ler o n8n'` mostra esse texto.
  - Data `19/nov/2026` aparece para `geradoEm` em 19/11/2026; o texto não contém `—`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (CSS com variáveis em `:root` e `@media (prefers-color-scheme: dark)`; cartões em grade que vira 1 coluna no celular). **Step 4:** PASS.
- [ ] **Step 5: Commit** das Tasks 1-3: `git add automation/src/painelRobos.js automation/tests/painelRobos.test.js` + `feat(painel): estado, resumo e HTML do painel dos robos`.

### Task 4: Coletor e primeira página real

**Files:**
- Create: `automation/scripts/painel-robos.mjs`
- Modify: `automation/.gitignore` (linha `painel/`)

**Interfaces:**
- Consumes: tudo de `src/painelRobos.js`.
- Produces: arquivo `automation/painel/painel-robos.html`; saída 0 mesmo se uma fonte falhar.
- Mapa de robôs (nome no cartão → tarefas → fonte):
  - Divisor → `Descer divisor 06h` → `descer-divisor.log` (+ `divisor/` mtime).
  - Revisor CSAT → `Revisor CSAT 08h/14h/17h` → `revisor-csat.log`.
  - Materiais → `Robo Materiais` → arquivo mais novo de `simulacao-materiais/` (+ `simular-materiais.log` para Teams).
  - Certificados → `Traduzir certificados LW` → `traduzir-certificados.log`.
  - Troca de gravação → `Troca gravacao 0830/10h/13h/16h/18h` → `troca-gravacao.log` (+ `troca-gravacao/` mtime).
  - Presença Zoom (n8n) → sem tarefa; `GET https://editor.agroadvance.com.br/api/v1/executions?workflowId=na42taXeTMbq3IAv&limit=1` com `X-N8N-API-KEY`; estado ok se `status === 'success'` e começou hoje depois das 07:00, `erro` se `error`, `perdida` se depois das 07:10 não há execução de hoje; próxima = amanhã 07:00.
- Agendador: `powershell -NoProfile -Command "Get-ScheduledTask -TaskName <nomes> | % { $i = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{nome=$_.TaskName; ultima=$i.LastRunTime; resultado=$i.LastTaskResult; proxima=$i.NextRunTime; perdidas=$i.NumberOfMissedRuns} } | ConvertTo-Json"`, datas convertidas para ISO no próprio PowerShell (`.ToString('o')`) para o Node não depender do formato pt-BR.

- [ ] **Step 1:** implementar o coletor; cada fonte em try/catch que preenche `erroLeitura` no cartão.
- [ ] **Step 2:** `node scripts/painel-robos.mjs` → sai 0 e imprime o caminho do HTML.
- [ ] **Step 3:** abrir o arquivo no painel do navegador (file://) e conferir: faixa cita "Troca gravacao 10h" perdida de hoje; cartão da Troca mostra GPA 16/nov 🟢; contagem anda; nenhum erro no console. Print para o usuário.
- [ ] **Step 4:** renomear temporariamente `N8N_API_KEY` no ambiente (`N8N_API_KEY= node scripts/painel-robos.mjs`) → página sai com o cartão do n8n em erro de leitura e os outros normais.
- [ ] **Step 5: Commit** `automation/scripts/painel-robos.mjs automation/.gitignore` + `feat(painel): coletor do painel dos robos`.

### Task 5: Rodar sozinho a cada 5 min e atalho

**Files:**
- Create: `automation/rodar-painel-robos.vbs` (`CreateObject("WScript.Shell").Run """C:\Program Files\nodejs\node.exe"" scripts\painel-robos.mjs", 0, False` com `CurrentDirectory` na pasta do .vbs)

- [ ] **Step 1:** criar a tarefa "Painel robos" (PowerShell `Register-ScheduledTask`): ação `wscript.exe "<caminho>\rodar-painel-robos.vbs"`, gatilho diário 00:00 repetindo a cada 5 min por 1 dia, `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew`, logon interativo do usuário atual.
- [ ] **Step 2:** `Start-ScheduledTask "Painel robos"`; em até 1 min o mtime de `painel/painel-robos.html` muda e nenhuma janela aparece; `LastTaskResult` 0.
- [ ] **Step 3:** atalho `Painel dos robôs.url` (ou `.lnk`) na Área de Trabalho apontando para `file:///.../automation/painel/painel-robos.html`.
- [ ] **Step 4: Commit** `automation/rodar-painel-robos.vbs` + `chore(painel): lancador oculto do painel`; atualizar memória do projeto.
