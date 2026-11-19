# Painel dos robôs (19/nov/2026)

## Por quê
O Vinicius quer abrir uma tela **de manhã, aqui no PC**, e ver se todos os robôs rodaram. Hoje isso exige ler 6 logs e o Agendador do Windows (ex.: 19/nov a Troca das 10h foi perdida por bateria e ninguém viu).

## Objetivos
- Uma página com um cartão por robô: **rodou? deu erro? avisou no Teams? quando é a próxima (contagem ao vivo)? o que fez na última rodada** (2 a 5 linhas tiradas do relatório).
- Faixa no topo respondendo "tudo rodou?": verde se nada falhou/perdeu desde a véspera, senão a lista do que falhou ou foi perdido.
- Robôs: Divisor 06h, Revisor CSAT (08/14/17h), Robo Materiais (2 em 2h), Traduzir certificados (07:30), Troca de gravação (08:30/10/13/16/18h, ter-qua-qui) e Presença Zoom 75% (n8n, 07:00).

## Não objetivos
- Sem botões de rodar/parar, sem celular, sem histórico além de hoje + última rodada.

## Anti-objetivo
- Cartão verde com robô que falhou calado. "OK" só quando a última rodada terminou com código 0 **e** gerou relatório/log naquele horário; rodada esperada que não aconteceu = "perdida".

## Abordagens
- **A (escolhida pelo usuário):** script Node gera `painel-robos.html` a cada 5 min (tarefa do Windows), lido no navegador; contagem por JS na página. Poucas peças, mesmo padrão dos robôs.
- B: servidor local em localhost, sempre atual e com botões, mas é um processo a mais para vigiar.
- C: resumo da manhã no Teams: não é painel nem mostra contagem.

## Como (decidido)
- `automation/scripts/painel-robos.mjs` (só leitura): lê as tarefas do Agendador por PowerShell (`Get-ScheduledTask`/`Get-ScheduledTaskInfo`, JSON), os logs/relatórios em `automation/` (troca-gravacao/, divisor/, simulacao-materiais/, revisor-csat.log, traduzir-certificados.log) e a última execução do workflow n8n `na42taXeTMbq3IAv` pela API (`.env` N8N_API_KEY).
- Saída: `automation/painel/painel-robos.html` (fora do git), página única sem dependência externa, claro/escuro, datas dd/mmm/aaaa, português, sem travessão.
- Tarefa "Painel robos" a cada 5 min, **sem abrir janela** (lançador .vbs ou PowerShell oculto), roda na bateria. Atalho na área de trabalho para a página.
- Lógica de estado (parte pura, com testes): ok / erro (código ≠ 0) / perdida (horário previsto passou sem rodar) / rodando / sem rodada hoje.

## Fica com quem constrói
- Quais linhas de cada relatório viram "o que fez".
- Visual exato dos cartões (seguir o esboço abaixo).

```
┌ Robôs · 19/nov/2026 08:05 ────────────────────────────┐
│ ⚠️ 1 rodada perdida: Troca gravação 10h (bateria?)     │
├────────────────────────────────────────────────────────┤
│ ✅ Divisor 06h      rodou 06:00 · próxima em 21h55     │
│    3 movidos, 9 pela sync, 0 falhas · Teams: não       │
│ ✅ Troca gravação   rodou 08:30 · próxima 10h em 1h55  │
│    GPA 16/nov 🟢 seguro · VNA ✅ · Teams: sim         │
│ ❌ Revisor CSAT 14h erro ontem 15:03 (código ...)      │
└────────────────────────────────────────────────────────┘
```
