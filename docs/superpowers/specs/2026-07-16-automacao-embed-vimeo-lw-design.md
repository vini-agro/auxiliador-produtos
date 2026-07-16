# Automação de embed Vimeo → LearnWorlds (via Airtable)

**Data:** 2026-07-16
**Status:** Aprovado para plano de implementação

## Contexto

Hoje, toda vez que uma aula ao vivo (MBA-LW) acontece, alguém precisa manualmente:

1. Encontrar o vídeo da aula no Vimeo (pasta organizada por professor/palestrante, dentro de "MBA - LW")
2. Copiar o link de embed do vídeo
3. Ir até a aula certa no editor da LearnWorlds
4. Colar esse HTML, substituindo dois placeholders — o link do embed do Vimeo e o link do formulário de CSAT do Airtable:

```html
<div style="height: 60px;"></div>
<div style="text-align: center; margin-bottom: 20px;">
  <a href="{LINK_CSAT}" target="_blank" style="background-color: #007BFF; color: white; padding: 14px 28px; text-decoration: none; font-size: 18px; border-radius: 6px; display: inline-block; font-family: sans-serif;">
    ➜ Avalie a aula de hoje!
  </a>
</div>
<div style="height: 720px; width: 1280px"><iframe src="{EMBED_VIMEO}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen frameborder="0" style="width:100%;height:100%;"></iframe></div>
```

Esse trabalho se repete a cada aula, é sujeito a erro de copiar/colar, e a aula "mestre" atualizada é propagada para as demais turmas/cursos vinculados via sync nativo da LearnWorlds (confirmado funcionando novamente em 2026-07-16, após um incidente investigado nesta mesma base de conhecimento — ver `learnworlds-api-agroadvance.md`).

## Objetivo

Eliminar o trabalho manual de identificar o vídeo certo, montar o HTML e colar na LW — do momento em que o vídeo é enviado pro Vimeo até o conteúdo aparecer atualizado na aula da LW, sem intervenção humana recorrente.

## Descobertas que fundamentam este desenho

- **Convenção de nomenclatura dos vídeos no Vimeo** (pasta "MBA - LW", subpastas por professor): `{CÓDIGO}[_ ]{DDMMYYYY}[_ ]{PROFESSOR}[_ ]{TÍTULO}`, com variações de separador (`_` ou espaço) e sufixos opcionais (`Ed`, `T4`). Exemplos reais:
  - `GPA_01062026_MARCOS NASCIMBEM FERRAZ_GESTÃO POR INDICADORES E USO DE DADOS NO AGRO`
  - `MBAs_04052026_TATIANA BATISTELA_CULTURA ORGANIZACIONAL: ALINHANDO VALORES A RESULTADOS SUSTENTÁVEIS`
  - `Agro 07052026 Leonardo Godinho Case Ed`
  - Código genérico `MBAs` (plural) = aula compartilhada entre todos os programas MBA.
- **Base Airtable (`appdXh6tqtPxRpebn`) já modela isso:**
  - `Op 4.0 (Calendário Operacional)`: 1 registro = 1 ocorrência de aula (Data + Professor + Módulo + Turmas vinculadas).
  - `Evento × Curso`: 1 linha por Turma vinculada ao evento; campo `LINK CSAT` (fórmula) já gera `https://airtable.com/appdXh6tqtPxRpebn/pagbEYRl5TYR2FltN/form?prefill_EventoCursoID={RECORD_ID}` — não precisa ser recriado.
  - `Turmas`: campo `course_id_LW` já mapeia pra LW.
  - `Aulas`: representa o tópico/tema recorrente. **Confirmado com o usuário:** quando a mesma aula ocorre de novo pra uma turma nova, a LW **atualiza o mesmo unit existente** (não cria um novo) — ou seja, existe 1 unit fixo na LW por Aula recorrente.
- **API da LearnWorlds (`plataforma.agroadvance.com.br/admin/api/v2/`):**
  - Suporta criar curso (`POST /courses`) e criar seção (`POST /courses/{id}/sections`) e criar unit tipo `embed` (`POST /courses/{id}/sections/{sectionId}/units` com `objectType: "embed"`).
  - **Não suporta escrever o conteúdo HTML do embed via API** — testado exaustivamente (11 variações de payload/endpoint num curso de teste descartável) e o campo `data.embed` sempre retorna `null`. Conclusão: bloqueio deliberado da LW (provável prevenção de XSS via API pública). Sem endpoint de DELETE de curso disponível — limpeza de testes é manual pelo painel.
  - Confirmado via UI: existe um textarea "Copy and paste your embed code" no modal "Update Embed learning activity" — o mecanismo certo do lado da LW, só acessível pela interface web.

## Arquitetura

```
Vimeo (pasta "MBA - LW")
   │  (1) polling detecta vídeo novo
   ▼
n8n — Watcher & Parser
   │  (2) regex extrai código+data+professor+título
   ▼
n8n — Matcher (Airtable API)
   │  (3) busca "Op 4.0" por Data (+ Professor/Sigla p/ desambiguar)
   │  (4) segue Op 4.0 → Aulas → campo "LW Unit URL" (cadastro único, manual)
   │  (5) segue Op 4.0 → Evento × Curso → campo "LINK CSAT" (já existe)
   ▼
n8n — Gerador de HTML
   │  (6) monta o bloco final substituindo os 2 placeholders no template
   ▼
Robô headless (Playwright), disparado pelo n8n
   │  (7) login no admin da LW → abre "LW Unit URL" → cola o HTML no
   │      campo de embed → salva
   ▼
LearnWorlds — sync nativo propaga pra todas as turmas/cursos vinculados
```

### Componentes

**1. Setup único no Airtable (manual, uma vez por Aula recorrente)**
Campo novo `LW Unit URL` (singleLineText/URL) na tabela `Aulas`, apontando pra URL de edição do unit "mestre" na LW. Sem isso cadastrado, a aula cai na fila de revisão manual (não é erro — é o estado esperado até alguém cadastrar).

**2. Watcher & Parser (Vimeo)**
Polling periódico (ex: a cada 15–30 min) na pasta "MBA - LW" via API do Vimeo (`GET /users/{id}/projects/{id}/videos`), recursivo pelas subpastas de professor. Regex tolerante a separador `_`/espaço e sufixos, extraindo: código do curso (opcional — pode ser código específico ou `MBAs`/`Agro` genérico), data (DDMMYYYY), e o restante (professor+título, sem split confiável entre os dois — não é necessário pro matching).

**3. Matcher (Airtable)**
Busca em `Op 4.0` por `Data` igual à extraída do nome do vídeo. Se houver mais de um registro na mesma data, usa o nome do professor (fuzzy match) pra desambiguar. Sem match único e confiável → fila de revisão manual.

**4. Gerador de HTML**
Template fixo (o mesmo já em uso hoje), com os dois placeholders substituídos:
- `{EMBED_VIMEO}` → URL do vídeo encontrado
- `{LINK_CSAT}` → valor do campo `LINK CSAT` (Airtable, já existe, não precisa gerar)

**5. Robô de atualização (Playwright)**
Script headless que:
1. Faz login no painel admin da LW com credencial dedicada (não a pessoal do Vinicius — ver Segurança)
2. Navega direto pra `LW Unit URL`
3. Abre o modal de edição do embed (se não abrir direto nele)
4. Limpa o textarea e cola o HTML novo
5. Salva
6. Confirma visualmente que salvou (ex: checar se o modal fechou sem erro) antes de marcar como concluído

Erros de seletor/layout não encontrado → aborta sem clicar às ciegas, loga o erro, marca para revisão manual.

## Fila de revisão manual

Situações que caem aqui (nunca falha silenciosamente):
- Nome do vídeo fora do padrão esperado (não extrai código+data)
- Nenhum registro em `Op 4.0` com a Data extraída, ou múltiplos registros ambíguos
- `Aula` correspondente sem `LW Unit URL` cadastrado ainda
- Robô não conseguiu localizar o campo/botão esperado na tela da LW (layout mudou)

## Segurança e riscos assumidos

- **Credencial de admin da LW para o robô:** recomendado criar uma conta de admin **dedicada à automação** (não usar a pessoal), com o mínimo de permissão necessária, e guardar a senha como credencial segura no n8n (não em texto puro em nenhum arquivo). *(Decisão de implementação — não é parte deste spec.)*
- **Fragilidade a mudanças de UI:** se a LW reformular a tela de edição de unit, o robô quebra. Mitigação: alerta imediato quando o robô não encontra o seletor esperado, em vez de falhar silenciosamente.
- **Sem endpoint de delete de curso na API:** relevante só para os testes feitos durante esta investigação (curso `teste-automacao-claude-apagar`, a ser apagado manualmente pelo painel).

## Fora de escopo (confirmado com o usuário)

- **Pipelines "Case/Arena" (Zoom→LW) e "Estúdio ao vivo" (VMix→Zoom→LW):** não precisam de tratamento separado — o conteúdo dessas origens cai automaticamente na mesma pasta do Vimeo por um processo já existente fora deste projeto. O watcher da pasta Vimeo já cobre todos os casos.
- **Abordagem "push 100% via API pública da LW":** tecnicamente bloqueada (ver descobertas acima). Não será perseguida a menos que a LW mude essa política no futuro.

## Referências

- [`../../learnworlds-api-agroadvance.md`](../../learnworlds-api-agroadvance.md) — endpoints testados da API da LW, incluindo o incidente de sync e os testes de escrita
- [`C:\Users\User212\Documents\Dev\APIS.md`](../../../../APIS.md) — credenciais (Vimeo, Airtable, LW) usadas nesta investigação
