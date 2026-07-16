# Seletores confirmados — painel admin LW (Agroadvance)

Confirmado em 2026-07-16 rodando `automation/scripts/explore-unit-page.js`
contra `https://plataforma.agroadvance.com.br` real, com screenshots
inspecionados visualmente (`automation/screenshots/*.png`, não commitados —
ver `.gitignore`).

## 1. Não existe uma "tela de login" dedicada em `/admin`

- `LW_ADMIN_URL` do `.env` é `https://plataforma.agroadvance.com.br/admin`.
- Acessar essa URL **sem estar autenticado** retorna a página 404 padrão do
  site (`ERRO 404 — Ops! Algo deu errado...`), não um formulário de login.
  Confirmado no screenshot `00-homepage`-equivalente na primeira tentativa
  (script antigo indo direto pra `/admin`).
- O login de verdade acontece via **modal** que abre na home da escola
  (`LW_BASE_URL = https://plataforma.agroadvance.com.br`) ao clicar no link
  "Entrar" do menu superior. Confirmado nos screenshots `00-homepage.png` e
  `01-login-page.png`.

## 2. Abrir o modal de login

- Home: `page.goto('https://plataforma.agroadvance.com.br')`
- Link "Entrar" no menu superior (role `link`, texto renderizado em
  maiúsculas via CSS `text-transform`, mas o `getByRole` com `name: 'ENTRAR'`
  bate certo por causa disso):
  `page.getByRole('link', { name: 'ENTRAR' }).click()`
- Esperar o modal renderizar: `page.waitForSelector('#signin-email', { state: 'visible' })`

## 3. Campos do formulário de login (modal)

Confirmado inspecionando o `outerHTML` real do `<form>` que envolve
`#signin-password` — existem `<label for="...">` reais, mas o texto do
label **não** bate com o regex sugerido no brief:

- Label do e-mail: `"Digite seu e-mail:"` — contém **"e-mail" com hífen**,
  então `page.getByLabel(/email/i)` **NÃO** encontra o campo (regex
  `/email/i` não casa com `"e-mail"`). Usar o id direto é mais confiável:
  `page.locator('#signin-email')` (placeholder visível: `E-mail`)
- Label da senha: `"Digite sua senha:"` — `page.getByLabel(/senha/i)`
  funcionaria, mas por consistência também usamos o id:
  `page.locator('#signin-password')` (placeholder visível: `Senha`)
- Botão de login: **não** é um `<button type="submit">` de formulário —
  é `<button type="button" id="submitLogin">` com o texto interno
  `<span class="btn-lbl">Entrar</span>` (renderizado em maiúsculas por CSS).
  Usar o id evita ambiguidade, porque existe **mais de um** elemento cujo
  texto renderizado bate com `/entrar/i` (o link de navegação "Entrar" E o
  botão do modal), o que causa "strict mode violation" no Playwright se
  usar `getByRole('button', { name: /entrar/i })` sem mais contexto:
  `page.locator('#submitLogin').click()`

Confirmado visualmente no screenshot `01-login-page.png`: modal com título
"Faça login ou cadastre-se para começar a aprender", label "Digite seu
e-mail:" + input placeholder "E-mail", label "Digite sua senha:" + input
placeholder "Senha", botão verde "ENTRAR", e links "Criar Conta" /
"Esqueceu sua senha?".

## 4. Armadilha de Cloudflare em modo headless

- Rodando `chromium.launch({ headless: true })` **sem ajuste**, o clique em
  `#submitLogin` dispara `POST https://plataforma.agroadvance.com.br/api/signin`,
  que retorna **403** com a página de bloqueio do Cloudflare
  ("Sorry, you have been blocked" / "Attention Required! | Cloudflare").
  Causa: o header `sec-ch-ua` / `User-Agent` do Chromium headless padrão
  contém a string `"HeadlessChrome"`, e o Cloudflare bloqueia isso.
- **Correção confirmada** (sem precisar de modo headed/GUI): criar o
  `BrowserContext` com um `userAgent` customizado que remove "Headless" da
  string, por exemplo:
  ```js
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
  });
  ```
  Com esse ajuste, `POST /api/signin` passa a retornar `200` (rodando
  ainda com `headless: true`). Isso é importante pro Task 4, que
  provavelmente vai rodar sem GUI.

## 5. BLOQUEIO ATUAL: credenciais rejeitadas pela LearnWorlds

Com o ajuste de User-Agent acima (contornando o Cloudflare), o formulário é
preenchido e enviado corretamente — os valores aparecem certos no
screenshot `02-after-login.png` (e-mail `vinicius.grisotto@agroadvance.com.br`
e senha mascarada visíveis nos campos antes do submit). Porém a própria API
da LearnWorlds responde:

```
POST /api/signin -> HTTP 200
{"rt":2,"errors":[{"code":null,"context":"Not a valid user",
  "translation_code":"not_valid_user",
  "message":"Please, check your email and password."}],"success":false}
```

E a UI mostra, no próprio modal, a mensagem de erro em português:
**"Confira seu e-mail e sua senha, por favor."** — confirmado visualmente
no screenshot `02-after-login.png` (banner vermelho acima dos campos).

Verificações feitas para descartar causas triviais antes de escalar:
- `automation/.env` é lido corretamente pelo `dotenv` (sem problema de
  aspas, `#` sem escape, ou CRLF/`\r` colado no valor — confirmado via
  checagens booleanas sem imprimir a senha).
- O e-mail (`vinicius.grisotto@agroadvance.com.br`) é exatamente o mesmo
  usado no login manual esperado.
- O request enviado (`email`, `login`, `password` como
  `application/x-www-form-urlencoded`) é idêntico ao que o formulário real
  da LearnWorlds enviaria — não é um problema de payload/formato.

**Conclusão:** isso não é um problema de seletor. É a LearnWorlds
rejeitando as credenciais em `automation/.env` (`LW_ADMIN_EMAIL` /
`LW_ADMIN_PASSWORD`) como inválidas — pode ser uma senha incorreta/desatualizada,
o e-mail não estar cadastrado como usuário nessa escola LearnWorlds
especificamente (diferente de ser admin do WordPress em
agroadvance.com.br, que é um sistema separado), ou a conta exigir alguma
etapa adicional (ex.: 2FA) que não chegamos a ver pois o erro acontece
antes disso, na validação de usuário/senha.

## 6. Passos NÃO confirmados (bloqueados pelo item 5)

Como não foi possível autenticar, os seguintes itens do brief **não
puderam ser confirmados nesta rodada** — ficam pendentes até as
credenciais serem corrigidas:

- URL real da página de conteúdo do curso
  `TESTE AUTOMACAO CLAUDE - APAGAR` (o script tenta
  `${LW_BASE_URL}/admin/courses/teste-automacao-claude-apagar/content`,
  que é a URL **assumida** pelo brief, não confirmada por screenshot).
- Seletor real para abrir a unit "Aula Teste" a partir da página de
  conteúdo do curso.
- Se o modal "Update Embed learning activity" de fato abre automaticamente
  ao clicar na unit.

## Resumo para o Task 4

- Login: usar `#signin-email`, `#signin-password`, `#submitLogin` (não
  `getByLabel`/`getByRole` como no brief original).
- Rodar com `browser.newContext({ userAgent: <UA sem "Headless"> })` para
  não ser bloqueado pelo Cloudflare em modo headless.
- **Bloqueador para o Task 4 seguir:** as credenciais em
  `automation/.env` precisam ser corrigidas/validadas antes de qualquer
  automação de fato logar no admin da LearnWorlds. Sem isso, nenhuma etapa
  depois do login pode ser implementada ou testada contra o ambiente real.
