# LearnWorlds API & Webhooks — AgroAdvance

> Plataforma: `plataforma.agroadvance.com.br` (LearnWorlds, plano **High Volume & Corporate**)
> Objetivo: conectar eventos da plataforma de cursos ao stack de automação (n8n → RD Station / Pipedrive / Meetime)

---

## 1. Credenciais

Pegar em: painel LearnWorlds → `Settings > Developers` (API Keys e Webhooks ficam em seções separadas).

| Item | Valor | Status |
|---|---|---|
| Client ID | *(ver `C:\Users\User212\Documents\Dev\APIS.md` — não commitado no git)* | ✅ |
| Client Secret | *(ver `APIS.md`)* | ✅ |
| Access Token (OAuth2) | *(ver `APIS.md`)* | ✅ |
| School domain/subdomain | `plataforma.agroadvance.com.br` | ✅ |
| Webhook Signature Secret | *(ver `APIS.md`)* | ✅ |

**Onde encontrar cada coisa:**
- API Keys / Access Token → `Settings > Developers > API` (artigo: "How to Request your API Keys and Access Tokens")
- Webhook Signature → `Settings > Developers > Webhooks` (aparece junto de cada webhook configurado)

⚠️ Nunca commitar essas credenciais no git — guardar em `.env` local ou nas credentials do n8n.

---

## 2. Autenticação da API REST

- Protocolo: **OAuth 2.0**
- Versão: usar sempre a API atual (v1 está descontinuada)
- Base URL: `https://plataforma.agroadvance.com.br/admin/api/v2/` ✅ (confirmado por teste — o path sem `/v2/` dá 404)

```bash
curl -X GET "https://plataforma.agroadvance.com.br/admin/api/v2/users" \
  -H "Authorization: Bearer {access_token}" \
  -H "Lw-Client: {client_id}"
```

- [x] Testar chamada simples (ex: listar usuários ou cursos) — ✅ 2026-07-15, `GET /admin/api/v2/users` retornou 200 com lista de usuários
- [x] Confirmar formato exato de autenticação — Bearer token + header `Lw-Client: {client_id}`, ambos obrigatórios

---

## 3. Webhooks — eventos disponíveis

Marcar quais interessam e pra onde cada um deve rotear no n8n.

| Evento | Usar? | Destino (RD Station / Pipedrive / Meetime / outro) |
|---|---|---|
| Usuário registrado/atualizado | ⬜ | |
| Produto comprado | ⬜ | |
| Matrícula em curso gratuito | ⬜ | |
| Lead capturado (email) | ⬜ | |
| Certificado emitido | ⬜ | |
| Curso concluído | ⬜ | |
| Programa de aprendizagem concluído | ⬜ | |
| Assinatura/parcela paga | ⬜ | |
| Assinatura/parcela cancelada | ⬜ | |
| Trial de assinatura iniciado | ⬜ | |
| Trial terminando em 3 dias | ⬜ | |
| Seção gratuita visualizada (preview) | ⬜ | |
| Assinatura atualizada | ⬜ | |
| Usuário desmatriculado | ⬜ | |
| Tags adicionadas ao usuário | ⬜ | |
| Tags removidas do usuário | ⬜ | |
| Pagamento criado | ⬜ | |

**Configuração no painel:** `Settings > Developers > Webhooks` → marcar checkbox "Activate" do evento → colar URL do webhook n8n.

**Retry policy (LearnWorlds):** se não receber resposta de sucesso, retenta 20x com backoff exponencial (1min, 2min, 4min...). Ou seja, o endpoint n8n precisa responder rápido com 200, mesmo que o processamento pesado seja assíncrono.

---

## 4. Validação de assinatura (segurança)

Cada payload chega com o header:
```
Learnworlds-Webhook-Signature: v1=<hash>
```

Comparar esse hash com o "Webhook Signature" mostrado no painel (`Settings > Developers > Webhooks`) — se não bater, descartar o payload (possível spoofing).

- [ ] Node de validação no n8n (Function/Code node comparando o header)
- [ ] Guardar o secret como variável de ambiente (ex: `LW_WEBHOOK_SECRET`), igual ao padrão que já usamos pro `x-webhook-secret` do FluentForms

---

## 5. Plano de implementação

1. [x] Gerar credenciais de API (Client ID/Secret/Access Token) no painel
2. [x] Testar 1 chamada REST simples (autenticação funcionando)
3. [ ] Escolher o(s) primeiro(s) evento(s) de webhook a implementar (sugestão: começar por `course.completed` ou `product.purchased`, que têm valor de negócio claro)
4. [ ] Criar workflow n8n novo: `LearnWorlds - Webhook - [evento]`
5. [ ] Configurar node de validação de assinatura
6. [ ] Mapear payload recebido → campos do RD Station/Pipedrive/Meetime
7. [ ] Ativar o webhook no painel LearnWorlds apontando pra URL do n8n
8. [ ] Testar end-to-end com evento real (ou sandbox, se disponível)
9. [ ] Documentar workflow ID e mapping final aqui embaixo (seção 6)

---

## 6. Workflows implementados (preencher conforme for)

| Evento | Workflow n8n (nome/ID) | Destino | Data implementação | Notas |
|---|---|---|---|---|
| | | | | |

---

## 7. Payload de exemplo (colar aqui conforme for capturando)

```json
{
  "event": "",
  "...": "..."
}
```

---

## 9. Endpoints confirmados (testado direto na escola, 2026-07-15)

A doc pública oficial (learnworlds.dev) é uma SPA em JS — não dá pra ler via scraping. Em vez disso, testei os endpoints reais direto no ambiente com as credenciais atuais. Só listo aqui o que foi **verificado com request real**; nada especulativo.

| Endpoint | Método | Status | Observação |
|---|---|---|---|
| `/v2/users` | GET | ✅ 200 | Lista paginada. `page` e `items_per_page` funcionam. Total: **16.097 usuários**. |
| `/v2/users/{id}` | GET | ✅ 200 | Detalhe de um usuário (email, nome, tags, campos custom, etc.) |
| `/v2/users/{id}/courses` | GET | ✅ 200 | Cursos/matrículas de um usuário |
| `/v2/courses` | GET | ✅ 200 | Lista paginada de cursos |
| `/v2/courses/{id}` | GET | ✅ 200 | Detalhe de um curso |
| `/v2/courses/{id}/users` | GET | ✅ 200 | Usuários matriculados num curso |
| `/v2/bundles` | GET | ✅ 200 | Lista de bundles/pacotes de cursos |
| `/v2/bundles/{id}` | GET | ✅ 200 | Detalhe de um bundle |
| `/v2/payments` | GET | ✅ 200 | Lista de pagamentos/transações (34.835 registros). Traz `user_id`, `product`, `price`, `coupon`, `affiliate`, `gateway`, etc. |
| `/v2/certificates?user_id=` ou `?course_id=` | GET | ✅ rota existe | Exige um dos dois params; sem certificado emitido pra esse usuário no teste |
| `/v2/subscription-plans` | GET | ⚠️ rota existe | Retornou "Subscription plans not found" — parece que a escola não tem planos de assinatura configurados (ou precisa de outro param) |

**Não encontrados (404 genérico "resource does not exist") neste ambiente:** `learning-programs`, `products`, `programs`, `coupons`, `tags`, `user-tags`, `custom-user-fields`, `custom-fields`, `webhooks`, `categories`, `instructors`, `affiliates`, `orders`, `schools`, `enrollments`, `reports`, `pixels`, `courses/{id}/enrolled-users`, `courses/{id}/progress`, `courses/{id}/certificate`, `users/{id}/tags`, `users/{id}/payments`, `users/{id}/enrollments` (o correto é `/users/{id}/courses`).

**Limitação importante:** os parâmetros de busca (`email=`, `search=`, `query=`, `filter=`) na listagem de `/users` são **ignorados** pelo servidor — não filtram nada, só retornam a paginação normal. Não achei um jeito de buscar usuário por email direto na API. Implicação pro n8n: **não depender de consultar `/users` por email** — usar o `user_id`/objeto completo que já vem no payload do próprio webhook, em vez de re-consultar a API pra achar o usuário.

⚠️ Só testei métodos **GET** (leitura). Não testei POST/PUT/DELETE (criar/editar/excluir usuário, matricular, emitir cupom, etc.) pra não arriscar alterar dados reais da escola — isso deve ser validado num ambiente de teste antes de automatizar.

---

## 10. Troubleshooting / Notas

- 2026-07-15: primeiro teste em `/admin/api/users` (sem `v2`) deu 500; `/admin/api/` (raiz) deu 404. Path correto é `/admin/api/v2/users` → 200 OK. Auth: `Authorization: Bearer {access_token}` + `Lw-Client: {client_id}`, os dois headers são obrigatórios juntos.
- 2026-07-15/16: incidente do sync nativo (~90% do conteúdo compartilhado perdeu a sincronização) **se resolveu sozinho / foi corrigido** — usuário confirmou que a duplicação voltou a funcionar. Causa raiz não identificada com certeza (hipótese: bug temporário do lado da LW, já que billing/plano/outage geral foram descartados). Sem ação nossa necessária.
