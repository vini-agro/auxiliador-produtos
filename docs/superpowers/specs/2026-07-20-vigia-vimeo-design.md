# Vigia do Vimeo (watcher automático de vídeo novo)

**Data:** 2026-07-20
**Status:** Aprovado para plano de implementação

## Contexto

O spec anterior ([`2026-07-16-automacao-embed-vimeo-lw-design.md`](2026-07-16-automacao-embed-vimeo-lw-design.md)) já projetou e validou, com sistemas reais, toda a cadeia de processamento de um vídeo: reconhecer o nome do arquivo no Vimeo, achar a aula certa no Airtable, montar o HTML de embed (vídeo + CSAT) e colar isso na aula certa da LearnWorlds (via robô Playwright, confirmado escrevendo e persistindo). Essa cadeia hoje é disparada manualmente: alguém roda `automation/scripts/process-video.js "<nome do vídeo>" "<url de embed>"` na mão, uma vez por vídeo.

Falta a peça que descobre sozinha quando um vídeo novo apareceu na pasta "MBA - LW" do Vimeo (recursiva por subpastas de professor) e dispara essa cadeia sem intervenção manual — esse é o "Watcher & Parser" já descrito na arquitetura do spec anterior, mas ainda não implementado.

## Decisões desta rodada

- **n8n é self-hosted** — pode rodar comandos Node/Playwright diretamente (nó "Execute Command"), sem precisar de uma ponte HTTP separada.
- **Estado de "já processado" vive no próprio Vimeo**, como uma tag no vídeo (`automacao-ok`), não em um arquivo local. Confirmado via teste real (`OPTIONS /videos/{id}` retornou `Allow: GET,POST,PUT,DELETE,PATCH,OPTIONS` para o token atual) que o token do Vimeo em uso tem permissão de escrita.
- **O agendamento (\"rodar de tempos em tempos\") é responsabilidade do n8n** (nó Schedule Trigger), não de um script Node com loop próprio nem de um agendador externo (Task Scheduler do Windows). Isso é consistente com o desenho original, que já colocava o Watcher dentro do n8n.
- **Toda lógica com chance de erro sutil (paginação recursiva de pastas, filtro de tag, decisão de resultado) mora em módulos Node testáveis.** O n8n fica "burro": agenda, chama comandos, decide o próximo passo a partir de uma saída estruturada, notifica. Mesma separação de responsabilidades já usada no resto do projeto.
- **Notificação de itens em revisão manual: Microsoft Teams**, via webhook, disparado pelo próprio n8n quando o resultado não for sucesso.

## Arquitetura

```
n8n (self-hosted) — Schedule Trigger (~20 min, ajustável no próprio n8n)
   │
   ▼
Execute Command: node scripts/list-new-videos.js
   │  devolve JSON: [{ name, embedUrl, videoUri }, ...] — só vídeos sem a tag automacao-ok
   ▼
n8n itera a lista, um vídeo por vez
   │
   ▼
Execute Command: node scripts/process-video.js "<name>" "<embedUrl>"
   │  última linha do stdout: RESULT_JSON: {"status": "ok"} | {"status": "manual_review", "reason": "..."} | {"status": "error", "message": "..."}
   ▼
n8n decide pelo status:
   ├─ ok → Execute Command: node scripts/mark-video-processed.js <videoUri>  (marca no Vimeo)
   └─ manual_review | error → webhook do Teams (nome do vídeo + motivo)
```

## Confirmado contra a API real (2026-07-20, somente leitura)

- Pasta raiz "MBA - LW" = `/me/projects/16743590` (113 itens diretos, todos do tipo `folder`, um por professor — ex: "Tatiana Batistela", "Leonardo Godinho" — bate com os nomes reais usados como exemplo no spec anterior).
- Listagem de conteúdo de uma pasta: `GET /me/projects/{project_id}/items?per_page=&page=` (paginado). Cada item tem `type: "folder"` (com `item.folder.uri`, `item.folder.name`) ou `type: "video"` (com `item.video`). **Não existe endpoint de subpasta separado** — é o mesmo `items` que mistura pastas e vídeos no mesmo nível.
- Vídeo real de exemplo dentro da pasta "Tatiana Batistela" (`/me/projects/29092325/items`): `video.name = "MBAs_04052026_TATIANA BATISTELA_CULTURA ORGANIZACIONAL..."`, `video.uri = "/videos/1188068233"`, `video.player_embed_url = "https://player.vimeo.com/video/1188068233?h=cd3613700f"`, `video.tags = []` (array, vazio quando sem tags).
- Confirmado também que `/me/...` funciona como alias do usuário autenticado tanto pra `/me/projects/{id}/items` quanto pra listagem de topo — não precisa fixar nenhum `user_id` no código.

## Componentes

### 1. `automation/src/vimeoWatcher.js` (novo)

- **`isProcessed(video)`** — função pura. Recebe o objeto de vídeo (formato confirmado acima, com `video.tags`) e retorna `true` se algum tag tiver `canonical === 'automacao-ok'`. Trata `tags` ausente/vazio como não-processado (`false`).
- **`listFolderVideosRecursive({ vimeoToken, projectUri })`** — I/O. Pagina `GET {projectUri}/items?per_page=100&page=N` (usando `fields=uri,name,player_embed_url,tags` no request dos vídeos pra reduzir payload). Para cada item `type === "folder"`, chama a si mesma recursivamente com `item.folder.uri`; para cada item `type === "video"`, acumula `item.video` na lista de retorno. `projectUri` de entrada é `/me/projects/16743590` (pasta raiz "MBA - LW", ver acima) — vira uma nova variável de config, `VIMEO_MBA_LW_PROJECT_URI`, no `.env`.
- **`findNewVideos({ vimeoToken, projectUri })`** — combina os dois acima: lista tudo recursivamente, filtra com `isProcessed`, retorna só os vídeos ainda não tratados, no formato `{ name, embedUrl, videoUri }` (`embedUrl` = `video.player_embed_url`; `videoUri` = `video.uri`, ex: `/videos/1188068233`, usado depois por `mark-video-processed.js`).

### 2. `automation/scripts/list-new-videos.js` (novo)

CLI sem argumentos. Lê `VIMEO_TOKEN` do `.env`, chama `findNewVideos()` com o `projectUri` da pasta "MBA - LW" (novo valor de config, ex: `VIMEO_MBA_LW_PROJECT_URI` no `.env`), imprime o resultado como uma única linha JSON no stdout (array, vazio se não houver vídeo novo). Erros de rede/API imprimem em stderr e saem com código 1 (o n8n trata isso como falha do node "Execute Command", diferente do "sem vídeo novo" que é sucesso com array vazio).

### 3. `automation/scripts/mark-video-processed.js <videoUri>` (novo)

CLI que recebe a `videoUri` (ex: `/videos/1210287549`) como argumento e chama `PUT https://api.vimeo.com/videos/{id}/tags/automacao-ok` (endpoint de tag única do Vimeo — idempotente, não precisa ler/mesclar o array de tags existente). Sai com código 1 e mensagem em stderr se a chamada falhar.

### 4. Ajuste em `automation/scripts/process-video.js` (existente)

Cada ponto de saída do script (sucesso, cada motivo de revisão manual, erro) já loga uma mensagem legível via `console.log`/`console.error` — isso continua, é útil pra quem rodar na mão. Adiciona-se, como **última linha de stdout antes de sair**, uma linha estruturada:

```
RESULT_JSON: {"status":"ok"}
RESULT_JSON: {"status":"manual_review","reason":"nenhum evento em Op 4.0 pra data 2026-07-20"}
RESULT_JSON: {"status":"error","message":"<mensagem de updateEmbedUnit quando ok:false>"}
```

O prefixo `RESULT_JSON: ` existe pra o n8n conseguir achar essa linha entre os logs legíveis (procura a última linha que começa com esse prefixo e faz `JSON.parse` do restante). Cada `process.exit(0)` de revisão manual já existente passa a imprimir essa linha com o motivo correspondente antes de sair; o caminho de sucesso e o de erro (quando `updateEmbedUnit` retorna `ok:false`) idem.

## Fluxo de erro / revisão manual

Os motivos de cair em revisão manual continuam exatamente os já implementados em `process-video.js` (nome de vídeo fora do padrão, nenhum ou múltiplos eventos em "Op 4.0" pra data, evento sem Aula/Evento×Curso vinculado, Aula sem `LW Unit URL` cadastrado, sem `LINK CSAT`, `courseTitleId` fora da allowlist, ou `updateEmbedUnit` retornando erro). A diferença é só o canal: em vez de só aparecer no terminal de quem rodou na mão, o n8n lê o `RESULT_JSON` e posta no Teams (nome do vídeo + motivo) quando o status não for `ok`.

## Testes

- **Unidade** (`automation/tests/vimeoWatcher.test.js`): testa `isProcessed()` com objetos de vídeo fictícios — com a tag presente, sem tags, com `tags: []`, com `tags: undefined`, com outras tags mas não a `automacao-ok`. Não bate em API real.
- **Validação manual contra sistema real** (`automation/scripts/test-vimeo-watcher.js`, seguindo o mesmo padrão usado nos outros componentes deste projeto): roda `findNewVideos()` contra a pasta real "MBA - LW", confirma que a paginação recursiva encontra vídeos em subpastas de professor, e testa `mark-video-processed.js` contra um vídeo real de teste, confirmando (com uma segunda leitura, sessão nova) que a tag persistiu.

## Fora de escopo (confirmado com o usuário)

- **Configurar o workflow dentro do n8n em si** (nós, credenciais do Execute Command, teste do Schedule Trigger, webhook do Teams) — feito junto com o usuário quando ele tiver o n8n aberto, já que exige acesso ao ambiente self-hosted dele. Este spec cobre só as CLIs que o n8n vai chamar.
- **Desambiguação por professor quando duas aulas caem na mesma data** — gap já conhecido e documentado do orquestrador (`process-video.js`), não faz parte deste componente.
- **Migração da credencial pessoal da LW pra uma conta de automação dedicada** — decisão de segurança já registrada nos "Próximos passos" do plano anterior, independente deste componente.

## Referências

- [`2026-07-16-automacao-embed-vimeo-lw-design.md`](2026-07-16-automacao-embed-vimeo-lw-design.md) — spec original da cadeia de processamento (parser, matcher, gerador de HTML, robô da LW)
- [`../../../automation/src/lwRobot.js`](../../../automation/src/lwRobot.js) — robô Playwright, incluindo `isCourseAllowed()` (allowlist movida pra dentro do robô nesta mesma rodada)
- [`C:\Users\User212\Documents\Dev\APIS.md`](../../../../APIS.md) — credenciais (Vimeo, Airtable, LW) usadas nesta investigação
