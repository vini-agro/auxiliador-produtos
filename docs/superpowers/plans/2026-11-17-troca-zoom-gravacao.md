# Troca do Zoom pela gravação: plano de construção

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** robô que, ter/qua/qui, acha as gravações `_ED` novas no Vimeo e, em cada aula B2C, deixa um Embed com o vídeo + CSAT do Agrotable, anexa o material de novo, dispara o robô de Presença Zoom, passa a presença do Zoom para o Embed e diz se o Zoom estaria seguro para apagar (sem apagar).

**Architecture:** lógica pura e testável em `automation/src/trocaGravacao.js`; um orquestrador `automation/scripts/troca-gravacao.mjs` que lê Vimeo, Teamup, Airtable e LW, monta um plano por aula e, conforme as flags `--gravar`, executa passos reaproveitando os scripts já testados (criar/mover Embed, anexar material, paridade, marcação em lote). Roda como tarefa do Windows no PC do usuário, com a sessão Playwright da LW.

**Tech Stack:** Node 24 ESM, `node --test`, Playwright, APIs: Vimeo (`VIMEO_TOKEN`), Teamup, Airtable (`airtable` lib), LW v2 OAuth + API interna de sessão, webhook n8n.

**Spec:** `docs/superpowers/specs/2026-11-17-troca-zoom-gravacao-design.md`

## Global Constraints

- Só cursos **B2C**: categoria LW "MBA"/"Pós-graduação" ou, sem categoria, slug começando com `mba-` ou `pos-`. Qualquer outro: ignora, relatório "fora do escopo".
- **Nunca apagar o Zoom** nesta fase. Nenhum código chama `claude-lw-apagar-unit.mjs`.
- Dias: só **ter, qua, qui** (tarefa agendada às 10h, 13h, 16h, 18h).
- Corte: aulas com data ≥ `TROCA_INICIO` (YYYY-MM-DD no `.env`, valor = dia em que o usuário ligar) e ≤ 7 dias atrás. Nunca mexer em aula mais antiga.
- CSAT lido do **Agrotable** (Postgres `intranet` pela porta local 15432 do túnel SSH; psql em `C:\Program Files\PostgreSQL\18\bin\psql.exe`; usuário/senha em `.env` `AGROTABLE_PG_USER`/`AGROTABLE_PG_PASSWORD`), só leitura; nunca do Airtable. Sem Agrotable = aula vai para "Precisa de você".
- CSAT: `https://pesquisa.agroadvance.com.br/<id do Evento no Agrotable>`, só se Tipo de Entrega ∈ {`Ao vivo`, `Gravada (reex)`, `Gravada (comum)`, `Presencial`} e status ≠ `CANCELADO`. Aula compartilhada (mais de uma sigla) = **sem** CSAT.
- Vídeo: só nomes com `_ED`, duração > 0; URL do player `https://player.vimeo.com/video/<id>` (com `?h=<hash>` quando a API trouxer `player_embed_url` com hash).
- Seção sincronizada: escrever em UMA turma; fotografia (`claude-secao-snapshot.mjs`) antes e depois de criar Embed; diferença inesperada = parar e reportar.
- Relatório sempre: `automation/troca-gravacao/<YYYY-MM-DD>_<HHMM>.txt` + `troca-gravacao.log`. Datas no relatório em `dd/mmm/aaaa`. Sem travessão nos textos.
- Estado: **sem tag no Vimeo**. Cada rodada relê a LW e decide pelo estado real (`planoDaAula` → `ja-feito` não faz nada), então rodar de novo é seguro e retoma do ponto onde parou (decisão do construtor que a spec deixou em aberto).
- Simulação é o padrão: sem `--gravar`, nada é escrito em LW, Vimeo ou n8n.

## Review Focus

1. **Duas gravações para a mesma aula** (upload repetido, `_ED` e `_ED2`): espera-se usar uma só (a mais recente com duração) e nunca criar dois Embeds. Teste em Task 1 (`escolherGravacao`).
2. **Teamup com evento de mesma sigla duas vezes no dia** (aula manhã e noite): espera-se "precisa de você", não chute. Teste em Task 1 (`eventoDaGravacao`).
3. **Robô rodando duas vezes ao mesmo tempo** (tarefa das 13h ainda rodando às 16h): espera-se que a segunda saia sem fazer nada. Trava em Task 4.
4. **Embed já existe mas está vazio ou com o evento ao vivo do Vimeo** (aula VMIX): espera-se trocar só o vídeo e manter o CSAT. Teste em Task 1 (`planoDaAula`).
5. **Robô de Presença Zoom devolve erro ou "revisar" para a aula**: espera-se veredito "NÃO seguro" com o motivo, mesmo com paridade OK. Teste em Task 1 (`veredito`).

---

### Task 1: Lógica pura da troca

**Files:**
- Create: `automation/src/trocaGravacao.js`
- Test: `automation/tests/trocaGravacao.test.js`

**Interfaces:**
- Consumes: `cabecaDoEvento`, `normalizar`, `escolherAtividades`, `nomeDaAula` de `src/materiaisAula.js`; `parseVideoName` de `src/parseVideoName.js`.
- Produces:
  - `lerGravacao(nome: string, duracao: number): {sigla: string, dataIso: string} | null` (só `_ED`, duração > 0; `MBAs` vira `MBAS`)
  - `escolherGravacao(videos: {id, nome, duracao, criado}[]): Map<'SIGLA|dataIso', video>` (uma por aula, a mais recente)
  - `eventoDaGravacao(eventos: {titulo, data, turmas}[], sigla, dataIso): {evento} | {erro: string}`
  - `ehB2C({categorias: string[], slug: string}): boolean`
  - `aulaCompartilhada(tituloEvento: string): boolean` (cabeça com mais de uma sigla)
  - `linkCsat(evento: {id, tipoEntrega, status, siglas: string[]} | null, compartilhada: boolean): string | null` (null também quando `siglas.length > 1`)
  - `eventoDaAula(eventos, dataIso, tituloTeamup)` (ver Task 3)
  - `planoDaAula(units: Map, tituloEvento, dataIso, unitDoLink): {acao: 'criar-embed'|'trocar-video'|'ja-feito'|'nao-achada', zoom?, embed?}`
  - `veredito({paridade: {turma, faltando: number}[], presencaZoom: {erro?: string, revisar: string[]}}): {seguro: boolean, motivos: string[]}`

- [ ] **Step 1: Write the failing tests** (um `test()` por item, valores reais):
  - `lerGravacao('AGRICHEM_13112026_ANDRE REIS_O PAPEL..._ED', 5400)` → `{sigla:'AGRICHEM', dataIso:'2026-11-13'}`; sem `_ED` → `null`; duração 0 → `null`; `'MBAs_16112026_ADELINO..._ED'` → sigla `'MBAS'`.
  - `escolherGravacao` com dois vídeos da mesma aula → mantém o de `criado` mais recente.
  - `eventoDaGravacao`: `'GPA | Planejamento ... | Melina'` em `2026-11-16` casa `GPA`; `MBAS` casa `'LGE, GTC, MEA | Segmentacao ...'`; dois eventos `GPA` no mesmo dia → `{erro: /mais de um evento/}`; nenhum → `{erro: /sem evento/}`.
  - `ehB2C`: `{categorias:['MBA'], slug:'x'}` true; `{categorias:[], slug:'pos-graduacao-soja-milho-4'}` true; `{categorias:['B2B-Sanjo'], slug:'sanjo'}` false.
  - `linkCsat({id:'recAbc123', tipoEntrega:'Ao vivo', status:'Finalizado'}, false)` → `'https://pesquisa.agroadvance.com.br/recAbc123'`; `tipoEntrega:'Gravada'` → `null`; `status:'CANCELADO'` → `null`; `compartilhada=true` → `null`.
  - `planoDaAula`: só Zoom → `criar-embed`; Zoom + Embed de mesmo título → `ja-feito` (embed preenchido) ou `trocar-video` quando o embed não tem `player.vimeo.com/video`; só Embed com `vimeo.com/event/` → `trocar-video`; nada → `nao-achada`.
  - `veredito`: paridade toda 0 e presencaZoom sem erro/revisar → `{seguro:true}`; uma turma com 2 faltando → `seguro:false` com motivo citando a turma; `presencaZoom.revisar=['Fulano']` → `seguro:false`.
- [ ] **Step 2:** `node --test tests/trocaGravacao.test.js` → FAIL (módulo não existe).
- [ ] **Step 3:** implementar em `src/trocaGravacao.js`. `planoDaAula` recebe units com `{titulo, tipo, anexos, html?}`; use `escolherAtividades` para achar as atividades da aula.
- [ ] **Step 4:** `node --test tests/trocaGravacao.test.js` → PASS; `npm test` → todos passam.
- [ ] **Step 5:** commit `feat(troca-gravacao): logica pura` (só os 2 arquivos).

### Task 2: Embed sem botão de CSAT

**Files:**
- Modify: `automation/src/generateEmbedHtml.js`
- Test: `automation/tests/generateEmbedHtml.test.js`

**Interfaces:**
- Produces: `generateEmbedHtml({vimeoEmbedUrl: string, csatLink: string | null}): string`. Com `csatLink` null: sem o bloco do botão "➜ Avalie a aula de hoje!", mantém o espaçador e o iframe 1280x720.

- [ ] **Step 1:** testes: com link contém `href="https://pesquisa.agroadvance.com.br/rec1"` e `Avalie a aula de hoje`; com `null` não contém `Avalie` nem `href=`, contém `player.vimeo.com/video/123`.
- [ ] **Step 2:** rodar → FAIL no caso null.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** commit `feat(embed): csat opcional`.

### Task 3: Leitores (só leitura)

**Files:**
- Create: `automation/src/trocaGravacaoFontes.js`

**Interfaces:**
- Produces (todas só leitura):
  - `gravacoesRecentes({desde: string}): Promise<{id, nome, duracao, criado, embedUrl}[]>` via `GET https://api.vimeo.com/me/videos?sort=date&direction=desc&fields=uri,name,duration,created_time,player_embed_url` (mesmo padrão de `indiceDeGravacoes` em `scripts/revisor-csat-diario.mjs`), parando quando `created_time` < `desde`.
  - `eventosTeamup(inicio, fim): Promise<{titulo, data, turmas: {courseid, unit}[]}[]>` (mesmo código de `scripts/simular-materiais.mjs eventosDoTeamup`; mover para cá e reusar nos dois).
  - `abrirTunelAgrotable(): Promise<() => void>`: se `localhost:15432` já responde `select 'ok'`, devolve no-op; senão sobe `ssh -N -L 15432:127.0.0.1:5432` com chave e host do `.env` (`AGROTABLE_SSH_KEY`, `AGROTABLE_SSH_HOST`) e devolve a função que o encerra.
  - `eventosAgrotable(inicio, fim): Promise<{id, data, tipoEntrega, status, aula, siglas: string[]}[]>`: psql `-tA` com `json_agg` da consulta de `listarLinksCsat` (intranet `evento-pesquisa-links.ts`), filtrando `nome_completo::date BETWEEN`, `naoApagado` e status ≠ CANCELADO.
  - `eventoDaAula(eventos, dataIso, tituloTeamup): evento | null` (pura, vai na Task 1): mesma data e `nomeDaAula(aula) === nomeDaAula(tituloTeamup)`.
  - `cursoLw(page, slug): Promise<{categorias: string[], units: Map<id, {titulo, tipo, anexos, secao}>}>` (categorias pela API v2 `courses/{slug}`; units por `/api/course/{slug}?contents&path-player`, como em `simular-materiais.mjs unitsDoCurso`).
  - `htmlDoEmbed(page, slug, unitId): Promise<string>` (mesma técnica de `scripts/claude-dump-embed-frame.mjs`).

- [ ] **Step 1:** implementar e mover `eventosDoTeamup`/`unitsDoCurso` de `simular-materiais.mjs` para cá (o script de materiais passa a importar daqui).
- [ ] **Step 2:** verificação real só leitura: `node -e` que imprime `gravacoesRecentes({desde:'2026-11-09'})` (espera ver o `_ED` do IAL 09/nov) e `eventosAgrotable('2026-11-16','2026-11-16')` (espera GPA `rectjZOHcFC99Dzta` `Ao vivo`, MBAs com siglas `GTC, LGE, MEA`).
- [ ] **Step 3:** `node scripts/simular-materiais.mjs --data 2026-11-17` → mesmo resumo de antes (12 já estavam).
- [ ] **Step 4:** commit `feat(troca-gravacao): leitores`.

### Task 4: Orquestrador em modo simulação + relatório

**Files:**
- Create: `automation/scripts/troca-gravacao.mjs`, `automation/rodar-troca-gravacao.cmd`

**Interfaces:**
- Consumes: Tasks 1-3; `montarPlano`/`lerCaminho` de `src/materiaisAula.js` para saber o material da aula.
- Produces: CLI `node scripts/troca-gravacao.mjs [--data YYYY-MM-DD] [--gravar embed,material,presenca]`. Sem `--gravar` = simulação.

- [ ] **Step 1:** implementar: trava `.troca-gravacao.lock` (pid + início; recusa se dono vivo; assume se > 60 min, igual ao revisor), fora de ter/qua/qui sai com "fora do dia" (a não ser com `--data`), corte `TROCA_INICIO`/7 dias, e para cada gravação: evento → turmas B2C → plano por turma → CSAT → material (PDFs da pasta Share da data via `pastaShareNoOneDrive`) → linha no relatório com o que faria em cada passo. Aulas não B2C, sem evento, ambíguas ou sem atividade: seção "Precisa de você".
- [ ] **Step 2:** rodar `node scripts/troca-gravacao.mjs --data 2026-11-09` e conferir à mão: IAL 09/nov aparece como "ja-feito ou trocar-video" (gravação já está como embed), com 2 PDFs a anexar nas 4 turmas, CSAT presente (curso único).
- [ ] **Step 3:** rodar `--data 2026-11-16`: MBAs (LGE/GTC/MEA) sem CSAT; GPA com CSAT `pesquisa.../rec...`; Bayer/PNV conforme B2C (PNV é Pós, Bayer fora do escopo).
- [ ] **Step 4:** `.cmd` igual ao `rodar-simular-materiais.cmd` (log em `troca-gravacao.log`).
- [ ] **Step 5:** commit `feat(troca-gravacao): simulacao`.
- [ ] **Step 6 (checkpoint com o usuário):** mostrar o relatório de 16/nov e 17/nov; só seguir para a Task 5 com o ok dele.

### Task 5: Passo "embed" (gravar)

**Files:**
- Modify: `automation/scripts/troca-gravacao.mjs`
- Modify: `automation/scripts/claude-embed-preencher.mjs` (aceitar `TROCAR=1`: só substitui se o embed atual tiver `vimeo.com/event/`; nunca sobrescreve outro vídeo gravado)

**Interfaces:**
- Consumes: `scripts/claude-embed-criar.mjs <slug> <nSecao> "<titulo>" <html> <pasta>` (env `SALVAR=1`, `SEC_TXT`), `scripts/claude-lw-mover-unit.mjs <slug> <idNovo> <idZoom> <pasta>`, `scripts/claude-secao-snapshot.mjs`, chamados por `child_process.execFileSync` com o `.env` herdado.

- [ ] **Step 1:** com `--gravar embed`: `criar-embed` → fotografia das turmas da aula, cria na 1ª turma (título idêntico ao do Zoom, `SEC_TXT` = título da seção do Zoom), move para logo abaixo do Zoom, fotografia depois: esperado exatamente 1 unit nova por turma peer e nenhuma sumida; diferente disso, para e reporta. `trocar-video` → `claude-embed-preencher.mjs` com `TROCAR=1`.
- [ ] **Step 2:** teste no curso `teste-automacao-claude-apagar` (criar um Zoom "[Ao vivo] 17/11/2026 | Teste troca | Claude" à mão via `claude-zoom-criar.mjs` antes) rodando o passo isolado com `--data` e um evento falso injetado por `TROCA_EVENTO_TESTE=<json>`; conferir Embed criado abaixo do Zoom, iframe e botão.
- [ ] **Step 3:** commit `feat(troca-gravacao): passo embed`.

### Task 6: Passo "material" (gravar)

**Files:**
- Modify: `automation/scripts/troca-gravacao.mjs`

**Interfaces:**
- Consumes: `scripts/anexar-material.mjs <slug> "<titulo>" "<arquivo>"` (env `SALVAR=1 CONFIRMAR_SYNC=1`); comparação de nomes ignorando prefixo `^\d+-`.

- [ ] **Step 1:** com `--gravar material`: para cada PDF da pasta da aula que o Embed não tem, anexar na 1ª turma (a sync leva); conferir depois nas outras turmas.
- [ ] **Step 2:** teste no curso apagar (mesma aula falsa da Task 5) com um PDF pequeno.
- [ ] **Step 3:** commit `feat(troca-gravacao): passo material`.

### Task 7: Passo "presença" (gravar) e veredito

**Files:**
- Modify: `automation/scripts/troca-gravacao.mjs`
- `.env`: `PRESENCA_ZOOM_WEBHOOK_URL` (URL do Webhook GET do workflow n8n `na42taXeTMbq3IAv`; ler pela API do n8n, só GET, sem editar o workflow)

**Interfaces:**
- Consumes: webhook `GET <url>?data=DD/MM/AAAA` → JSON `{data, dryRun, log[], relatorio[{aula, turmas, ...}], ...}` (formato em `scripts/n8n-presenca-zoom-75-ultima.json`); `scripts/verify-presence-parity.js <slug> <zoomId> <embedId> <saida.json>` → `{missingVideo[{name,email,...}], safeToDeleteZoom}`; `scripts/bulk-mark-video-complete-generic.js <entrada.json> <saida.json> <courseInternalId> <slug> <sectionId> <unitId>` (env `TOTAL_TIME` = duração da unit quando > 6173 s; `BULK_MARK_CONCURRENCY=3`); `scripts/resolve-course-internal-ids.js` para ids internos.

- [ ] **Step 1:** com `--gravar presenca` (só depois do embed existir): chamar o webhook com a data da aula e guardar a resposta; por turma: paridade → lista `missingVideo` → bulk-mark no Embed → esperar 3 min → paridade de novo (até 2 vezes) → `veredito` (Task 1) com a saída do webhook filtrada para essa aula.
- [ ] **Step 2:** relatório por aula: "Zoom estaria SEGURO apagar" ou "NÃO seguro: <motivos>". Nada é apagado.
- [ ] **Step 3:** teste no curso apagar com o aluno de teste: concluir o Zoom de teste (webhook `teste=1&unit=<id>`), rodar o passo, conferir Embed concluído e veredito "SEGURO".
- [ ] **Step 4:** commit `feat(troca-gravacao): passo presenca`.

### Task 8: Agendamento e registro

**Files:**
- Create: tarefas do Windows "Troca gravacao 10h/13h/16h/18h" (ter, qua, qui) chamando `rodar-troca-gravacao.cmd` (sem `--gravar` até o usuário liberar cada degrau)
- Modify: memória `project_robo_materiais_aula_16h.md` → nova memória `project_robo_troca_gravacao.md` + linha no `MEMORY.md`

- [ ] **Step 1:** registrar as tarefas com `Register-ScheduledTask` (`-Weekly -DaysOfWeek Tuesday,Wednesday,Thursday`, `-StartWhenAvailable`, limite 3 h) e conferir `NextRunTime`.
- [ ] **Step 2:** escrever a memória (onde mora, flags, degraus, o que está ligado).
- [ ] **Step 3:** commit `chore(troca-gravacao): agendamento`.
