# Troca do Zoom pela gravação (robô de D+1)

**Data:** 17/nov/2026
**Status:** aprovado pelo usuário em 17/nov/2026

## Intenção

As aulas ao vivo (seg, ter e qua) acontecem numa atividade **Zoom** da LW, criada antes pela automação do Claude a partir do Teamup. No dia seguinte o audiovisual sobe a gravação editada no Vimeo e avisa no grupo AUDIOVISUAL do Teams (`SIGLA - PROFESSOR - DATA` + link do Vimeo). Hoje alguém faz à mão a troca: cria o Embed com o vídeo e o botão de CSAT, anexa o material de novo, passa a presença do Zoom para o Embed, confere e apaga o Zoom. O robô passa a fazer essa troca sozinho, sem perder presença de ninguém.

## Objetivos

1. Achar sozinho as aulas cuja gravação ficou pronta.
2. Em cada aula: deixar uma atividade **Embed** com o vídeo gravado e o botão de CSAT, no lugar do Zoom.
3. Anexar de novo o material da aula (pasta Share, mesma regra do robô de materiais).
4. Disparar o robô de Presença Zoom para a data da aula, assim que o Embed existir.
5. Passar a presença: todo aluno que concluiu o Zoom fica com o Embed concluído, turma por turma.
6. Conferir que ninguém ficou sem presença e só então apagar a atividade Zoom.

## Escopo desta versão (usuário, 17/nov/2026)

- **Só B2C** (MBA e Pós-graduação). B2B fica de fora, incluindo Bayer/UAB (`teamsMeeting`) e os cursos com Zoom na seção "Oculto".
- **Não apaga o Zoom por enquanto**, "para ir testando". O robô faz os passos 1 a 6 e 8 e deixa o Zoom no lugar; o relatório diz, por aula, se estaria "SEGURO apagar" ou não. O passo 7 fica desligado até o usuário pedir.

## Fora do escopo

- Automações nativas "[PRESENÇA]" da LW: **não usar** (decisão do usuário). A transferência é feita pelo robô, aluno por aluno.
- Ler o grupo do Teams (ver Abordagens).
- Apagar a reunião no Zoom web (apagar a unit na LW não apaga a reunião; já é assim hoje).
- Criar o Zoom antes da aula (outra automação, já existe).

## O que seria um fracasso mesmo "funcionando"

- Apagar um Zoom com algum aluno que tinha presença e ficou sem ela no Embed.
- Criar o Embed na turma errada, com o vídeo de outra aula, ou com CSAT apontando para outro curso.
- Mexer em seção sincronizada e sumir atividade em turma peer (já aconteceu em 30/ago com "Add activity").
- Agir em silêncio: toda rodada precisa deixar um relatório do que fez e do que pulou.

## Restrições conhecidas

- **Dias:** só roda **ter, qua e qui** (dia seguinte às aulas). Horários dentro do dia: decisão do construtor (proposta: 10h, 13h, 16h e 18h, porque as mensagens do audiovisual chegam entre 14h e 17h).
- **Sessão da LW pelo navegador** (Playwright + `.lw-session-state.json`): roda como tarefa do Windows no PC do usuário, igual ao revisor de CSAT e à simulação de materiais. O Cloudflare barra login de sessão por HTTP puro daqui.
- **Seção sincronizada:** mexer em UMA turma e deixar a sync levar para as peers. Antes de qualquer criação/exclusão, fotografia da estrutura (`claude-secao-snapshot.mjs` / `claude-snap-titulos.mjs`) e comparação depois. Diálogos de sync confirmados só pelo robô nos passos previstos.
- **Presença por turma:** a sync leva a atividade, mas cada turma tem seus alunos. A transferência roda turma por turma.
- **Transferência só com sessão do próprio aluno** (impersonar "Log in as this user"; sessão de admin responde `success:true` e não grava). Lenta: 15 a 90 s por aluno. Vídeo > ~1h50 precisa `TOTAL_TIME` = duração da unit. Releitura imediata do progresso pode mentir por alguns minutos.
- **Robô de Presença Zoom** (n8n `na42taXeTMbq3IAv`): só enxerga a aula enquanto a atividade Zoom existe; aceita `GET webhook?data=DD/MM/AAAA` sem editar o n8n. Só dá presença, nunca tira.
- **CSAT:** aula de um curso só leva o botão (`prefill_EventoCursoID` = registro Evento × Curso `SIGLA | DD/MM/AAAA`); aula com o mesmo nome em mais de um curso (LGE/GTC/MEA, PFS+PSS) vai **sem** CSAT.
- **Aulas VMIX** (agenda "4 - VMIX"): já são Embed com o evento ao vivo do Vimeo; nesse caso só troca o vídeo, mantém o CSAT, e não há Zoom para apagar nem presença para passar.
- **Bayer/UAB** usam `teamsMeeting` em vez de `zoomMeeting`; o robô de Presença Zoom não cobre essas (fora do escopo: B2B).
- **Como saber que é B2C:** categoria do curso na LW "MBA" / "Pós-graduação", ou, sem categoria, slug `mba-`/`pos-` (mesma regra do robô de Presença Zoom). Qualquer outro curso é ignorado e aparece no relatório como "fora do escopo".

## Abordagens consideradas

- **A. Descobrir a gravação pelo Vimeo (ESCOLHIDA).** Tarefa agendada lista vídeos `_ED` novos via API (token já existente; `vimeoWatcher.js` e o spec de 20/jul já fazem a varredura recursiva e marcam vídeo tratado com a tag `automacao-ok`). Sigla e data saem do nome (`SIGLA_DDMMAAAA_PROFESSOR_..._ED`; aula conjunta dos MBAs vem como `MBAs_`). Prós: só acessos que já funcionam, independe de alguém postar. Contra: nome fora do padrão não casa; nesse caso avisa e não chuta.
- **B. Ler o grupo AUDIOVISUAL do Teams.** Fiel ao processo de hoje, mas exige pôr a conta do n8n no grupo + permissão de leitura de chat (admin) e uma ponte n8n → PC, já que o navegador da LW roda no PC. Mais peças.
- **C. Tudo dentro do n8n.** Descartada: o Playwright da LW roda no PC (o spec de jul previa n8n "Execute Command", mas o padrão que funcionou desde então é tarefa no PC).

## Fluxo de uma aula

1. **Achar:** vídeo `_ED` novo → sigla + data → evento do Teamup daquela data com a mesma sigla na cabeça do título → turmas pelos links do comentário → em cada turma, a atividade da aula pela data + nome (`escolherAtividades`, já usada no robô de materiais). Sem casamento único = relatório "precisa de você", nada é feito.
2. **Embed:** se a aula já é Embed (VMIX), troca o vídeo mantendo o CSAT. Se é Zoom, cria Embed com o MESMO título numa turma, sobe para logo abaixo do Zoom (`claude-lw-mover-unit.mjs`), e confere com fotografia que a sync levou para todas as peers sem sumir nada. HTML pelo `generateEmbedHtml` (vídeo `player.vimeo.com/video/<id>` + CSAT pela regra acima).
3. **Material:** anexa os PDFs da pasta Share daquela aula numa turma (sync leva), esperando o upload terminar (`anexar-material.mjs`).
4. **Presença Zoom:** chama o webhook do robô de Presença Zoom com a data da aula e espera terminar.
5. **Transferência:** por turma, lista quem concluiu o Zoom e não concluiu o Embed; impersona cada um e marca o Embed.
6. **Conferência:** `verify-presence-parity.js` por turma. Só com "SEGURO apagar" em TODAS as turmas (com releitura após alguns minutos) segue.
7. **Apagar o Zoom:** por ID, numa turma (sync leva), conferindo com fotografia que só o Zoom saiu.
8. **Marcar o vídeo** como tratado (`automacao-ok`) e registrar no relatório.

Se uma rodada parar no meio, a próxima retoma pelo estado real da LW (Embed já existe? material já está? presença já passou?), nunca por memória local.

## Implantação em degraus

1. **Simulação:** só lista, por aula, o que faria em cada passo (sem gravar). Rodar alguns dias de ter a qui.
2. **Liga Embed + material** (passos 2 e 3).
3. **Liga presença** (4 a 6).
4. **Liga apagar o Zoom** (7), por último e só quando o usuário pedir (decisão de 17/nov: por enquanto não apaga).

## Decidido pelo usuário

- Vimeo como gatilho (A); robô roda ter, qua e qui.
- Presença transferida pelo robô, sem automações nativas da LW.
- Robô de Presença Zoom disparado na hora em que o Embed é criado.
- Aula que já é Embed: só atualiza.
- Só B2C (MBA e Pós); B2B fora.
- Zoom não é apagado nesta fase.

## Decisões do Claude (o usuário pode corrigir)

- **O que mais trava a exclusão do Zoom:** além da paridade, se a execução do robô de Presença Zoom para aquela data trouxer, para essa aula, item em "revisar", professor não achado no relatório do Zoom, curso sem regra ou erro, o Zoom **não** é apagado e a aula vai para "precisa de você". Motivo: a paridade só olha quem já concluiu o Zoom; depois de apagado, o robô de presença não enxerga mais a aula e esses alunos perdem a presença para sempre. Por isso o robô lê a saída da execução do n8n (`relatorio`/`revisar`), não só espera ela terminar.
- **Corte de datas:** só aulas a partir da data em que o robô for ligado e no máximo 7 dias para trás. Vídeos `_ED` antigos sem a tag não são tocados (evita reescrever meses de aulas já trocadas).
- **Convivência com a troca manual:** como o Zoom não é apagado nesta fase, o risco de corrida é só de Embed duplicado, e a regra abaixo evita isso. Se alguém fizer a troca à mão no mesmo dia, o robô encontra o Embed e segue dali.
- **Se a troca já foi feita à mão** (Embed com vídeo gravado já existe e o Zoom já sumiu): o robô só confere, anexa material se faltar e marca o vídeo como tratado. Nunca cria segundo Embed: antes de criar, procura atividade não-Zoom com a mesma data + nome.
- **CSAT: vem do Agrotable (usuário, 17/nov/2026):** link `https://pesquisa.agroadvance.com.br/<id do Evento>`, a mesma regra de `linkPesquisaDoEvento` (intranet, `backend/src/modules/operacional/agrotable/evento-pesquisa-link.ts`): id = registro do Calendário Operacional (`op4_calendario_operacional.id`, mesmo `rec...` do Airtable "Op 4.0 (Calendário Operacional)"); só existe com Tipo de Entrega em `Ao vivo`, `Gravada (reex)`, `Gravada (comum)`, `Presencial` e status diferente de CANCELADO. Sem link válido = Embed sem botão + aviso no relatório. **Leitura direto do Agrotable** (usuário, 17/nov/2026: "pegar o link do agrotable em vez do airtable"): o robô abre o túnel SSH do Postgres da intranet (chave e host no `.env`: `AGROTABLE_SSH_KEY`, `AGROTABLE_SSH_HOST`) e roda, só leitura, a mesma consulta de `listarLinksCsat` (op4_calendario_operacional + aulas + siglas dos cursos das turmas) no banco `intranet`. Testado 17/nov: GPA 16/nov = `rectjZOHcFC99Dzta`, MBAs = `GTC, LGE, MEA`. Agrotable fora do ar (túnel ou banco) = a aula vai para "precisa de você" e nada é criado (Embed de curso único sem CSAT seria um erro).
- **Aula compartilhada continua SEM CSAT** (usuário, 17/nov/2026): cabeça do título do Teamup com mais de uma sigla, ou Evento com turmas de mais de um curso = só o player.

## Deixado para o construtor

- Horários exatos dentro de ter/qua/qui.
- Onde fica o estado de "vídeo tratado" (tag do Vimeo, como no spec de jul, é a proposta).
- Pastas do Vimeo além de "MBA - LW" (Pós, B2B) e como achá-las.
- Formato e destino do relatório (arquivo local; Teams se o usuário quiser).
- Como esperar o fim do robô de Presença Zoom (resposta do webhook ou execução no n8n).
