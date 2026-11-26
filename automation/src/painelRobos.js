// Painel dos robos (19/nov/2026): parte pura. Estado de cada tarefa do Agendador, resumo do que
// cada robo fez (tirado do log/relatorio), faixa "tudo rodou?" e o HTML da pagina.
// Spec: docs/superpowers/specs/2026-11-19-painel-robos-design.md

const RODANDO = 267009; // 0x41301
const NUNCA = 267011; // 0x41303
const FOLGA_RELATORIO = 60 * 1000;
const FOLGA_INICIO = 5 * 60 * 1000; // a tarefa tem 5 min para comecar antes de contar como perdida

const ORDEM = ['erro', 'perdida', 'sem-relatorio', 'rodando', 'nunca', 'ok'];
const TEXTO_ESTADO = {
  ok: 'em dia', erro: 'erro', perdida: 'rodada perdida', 'sem-relatorio': 'rodou sem relatório', rodando: 'rodando agora', nunca: 'ainda não rodou',
};

/**
 * Estado de uma tarefa do Agendador. "ok" so com codigo 0 E relatorio/log atualizado na rodada.
 * info = { nome, ultima: Date|null, resultado: number, proxima: Date|null, perdidas: number }
 */
const CODIGOS = { 1: 'o robô terminou com erro', 3221225786: 'rodada interrompida (janela fechada ou PC suspenso)', 2147942402: 'arquivo do robô não encontrado' };
const textoErro = (r, quando) => `erro na rodada de ${curta(quando)}: ${CODIGOS[r] || `código ${r}`}`;

export function estadoDaTarefa(info, relatorioEm) {
  const r = Number(info.resultado);
  if (r === RODANDO) return { estado: 'rodando', texto: TEXTO_ESTADO.rodando };
  if (r === NUNCA || !info.ultima) return { estado: 'nunca', texto: TEXTO_ESTADO.nunca };
  // confere contra a agenda: o contador de perdidas do Windows zera quando a tarefa roda atrasada
  // (StartWhenAvailable), mesmo que essa rodada caia num dia em que o robo sai sem fazer nada
  // `quando` = momento do furo, usado por avisoDoDia (aviso so no dia do furo)
  const slot = info.agendada;
  if (slot && info.ultima.getTime() < slot.getTime() - FOLGA_INICIO) {
    return { estado: 'perdida', quando: slot, texto: `não rodou em ${curta(slot)}${r !== 0 ? `; a anterior deu ${textoErro(r, info.ultima)}` : ''}` };
  }
  if (slot && info.diasAgendados && !info.diasAgendados.includes(info.ultima.getDay())) {
    return { estado: 'perdida', quando: slot, texto: `não rodou em ${curta(slot)}; só rodou ${curta(info.ultima)}, fora dos dias dela (não fez nada)` };
  }
  // rodada perdida e' o fato mais recente: aparece antes do resultado da ultima que rodou
  // (contador do Windows sem horario conhecido: sem `quando`, alerta como sendo de hoje)
  if (info.perdidas > 0) return { estado: 'perdida', texto: r !== 0 ? `rodada perdida; a anterior deu ${textoErro(r, info.ultima)}` : TEXTO_ESTADO.perdida };
  if (r !== 0) return { estado: 'erro', quando: info.ultima, texto: textoErro(r, info.ultima) };
  if (!relatorioEm || relatorioEm.getTime() < info.ultima.getTime() - FOLGA_RELATORIO) return { estado: 'sem-relatorio', texto: TEXTO_ESTADO['sem-relatorio'] };
  return { estado: 'ok', texto: TEXTO_ESTADO.ok };
}

/**
 * Ultimo horario da agenda que ja passou (com FOLGA_INICIO para a tarefa comecar), ou null.
 * gatilhos = [{ tipo: 'semanal', inicio: ISO, dias: mascara do Windows (dom=1, seg=2 ... sab=64) }
 *            | { tipo: 'diario', inicio: ISO, intervalo: dias }]; outros tipos sao ignorados.
 */
export function ultimoHorarioAgendado(gatilhos, agora) {
  let melhor = null;
  for (const g of gatilhos || []) {
    if (g.tipo !== 'semanal' && g.tipo !== 'diario') continue;
    const inicio = new Date(g.inicio);
    if (Number.isNaN(inicio.getTime())) continue;
    for (let d = 0; d <= 14; d++) {
      const slot = new Date(agora);
      slot.setDate(slot.getDate() - d);
      slot.setHours(inicio.getHours(), inicio.getMinutes(), 0, 0);
      if (slot < inicio || slot.getTime() > agora.getTime() - FOLGA_INICIO) continue;
      const ok = g.tipo === 'semanal'
        ? (Number(g.dias) & (1 << slot.getDay())) !== 0
        : Math.round((slot - inicio) / 86400000) % (Number(g.intervalo) || 1) === 0;
      if (ok) { if (!melhor || slot > melhor) melhor = slot; break; }
    }
  }
  return melhor;
}

/** Dias da semana (getDay: dom=0) em que um gatilho semanal roda; null se algum gatilho roda todo dia/outro tipo. */
export function diasDaAgenda(gatilhos) {
  const semanais = (gatilhos || []).filter((g) => g.tipo === 'semanal');
  if (!semanais.length || semanais.length !== (gatilhos || []).length) return null;
  const dias = new Set();
  for (const g of semanais) for (let k = 0; k < 7; k++) if (Number(g.dias) & (1 << k)) dias.add(k);
  return [...dias].sort();
}

/**
 * Aviso so no dia (pedido do usuario, 24/nov): erro/perdida de um dia que ja passou vira "antiga" (cinza,
 * fora da faixa do topo) ate a proxima rodada; a rodada seguinte que der certo mostra, no dia dela, o furo
 * que cobriu. `furo` e' o guardado em disco entre uma geracao e outra ({ estado, texto, quando: ISO }).
 * Devolve { tarefa, furo } com o furo a guardar (null = apagar).
 */
export function avisoDoDia(tarefa, furo, agora) {
  if (tarefa.estado === 'erro' || tarefa.estado === 'perdida') {
    // furo sem horario (so o contador do Windows): fica a 1a vez que o painel viu, nao a ultima
    const aindaAberto = furo && !tarefa.quando && (!tarefa.ultima || tarefa.ultima <= new Date(furo.quando));
    const quando = tarefa.quando || (aindaAberto ? new Date(furo.quando) : agora);
    const novo = { estado: tarefa.estado, texto: tarefa.texto, quando: quando.toISOString() };
    if (mesmoDia(quando, agora)) return { tarefa, furo: novo };
    return { tarefa: { ...tarefa, estado: 'antiga', texto: `${tarefa.texto} · a próxima rodada cobre` }, furo: novo };
  }
  if (!furo) return { tarefa, furo: null };
  const quando = new Date(furo.quando);
  if (tarefa.estado !== 'ok' || !tarefa.ultima || tarefa.ultima <= quando) return { tarefa, furo };
  if (!mesmoDia(tarefa.ultima, agora)) return { tarefa, furo: null };
  return { tarefa: { ...tarefa, cobriu: { estado: furo.estado, quando } }, furo };
}

/** Pior estado entre as tarefas do robo. Sem tarefas = "nunca". Furo antigo nao pesa no cartao. */
export function estadoDoRobo(estados) {
  if (!estados || !estados.length) return 'nunca';
  const es = estados.map((e) => (e === 'antiga' ? 'ok' : e));
  return ORDEM.find((e) => es.includes(e)) || 'ok';
}

/** Faixa do topo: ok so se nenhuma tarefa com erro/perdida/sem relatorio e nenhum erro de leitura. */
export function faixaTopo(robos) {
  const itens = [];
  // o mesmo erro de leitura em varios robos (ex.: Agendador) vira uma linha so', com os robos afetados
  const leituras = new Map();
  for (const r of robos || []) if (r.erroLeitura) leituras.set(r.erroLeitura, [...(leituras.get(r.erroLeitura) || []), r.nome]);
  for (const [erro, nomes] of leituras) itens.push(nomes.length > 1 ? `${erro[0].toUpperCase()}${erro.slice(1)} (afeta: ${nomes.join(', ')})` : `${nomes[0]}: ${erro}`);
  for (const r of robos || []) {
    for (const t of r.tarefas || []) if (['erro', 'perdida', 'sem-relatorio'].includes(t.estado)) itens.push(`${t.nome}: ${t.texto}`);
  }
  return { ok: itens.length === 0, itens };
}

// ---------- o que cada robo fez ----------
export const INICIO_RODADA = {
  troca: /^TROCA DO ZOOM PELA GRAVACAO/m,
  divisor: /^Divisor PROXIMAS AULAS/m,
  revisor: /conferindo de \d{4}-/,
  certificados: /olhando cursos alterados/,
};

/** Trecho do log a partir da ultima linha que casa com `inicio` (texto inteiro se nenhuma). */
export function ultimaRodada(texto, inicio) {
  if (!texto) return '';
  const linhas = String(texto).split(/\r?\n/);
  const re = new RegExp(inicio.source, inicio.flags.replace('g', '').replace('m', ''));
  let i = -1;
  linhas.forEach((l, k) => { if (re.test(l)) i = k; });
  return i < 0 ? String(texto) : linhas.slice(i).join('\n');
}

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

function resumoTroca(texto) {
  const linhas = texto.split(/\r?\n/);
  const out = [];
  let atual = null;
  const fecha = () => { if (atual) out.push(`${atual.cab}: ${atual.marca || 'sem resultado'}`); };
  for (const l of linhas) {
    const v = l.match(/^🎬\s*([A-Za-z]+)_(\d{2})(\d{2})\d{4}_/);
    if (v) { fecha(); atual = { cab: `${v[1].toUpperCase()} ${v[2]}/${MESES[+v[3] - 1]}`, marca: null }; continue; }
    if (!atual || atual.marca) continue;
    if (/🟢/.test(l)) atual.marca = '🟢 seguro';
    else if (/🔴/.test(l)) atual.marca = '🔴 não seguro';
    else if (/ja concluida/i.test(l)) atual.marca = 'já feita';
    else if (/fora do escopo/i.test(l)) atual.marca = 'fora (B2B)';
    else if (/❌/.test(l)) atual.marca = 'erro';
  }
  fecha();
  return out.length ? out : ['Nenhuma gravação nova'];
}

/** Ate 5 linhas curtas com o que o robo fez na rodada. */
export function resumir(robo, texto, opcoes = {}) {
  if (!texto) return [];
  const t = String(texto);
  const achar = (re) => (t.match(re) || [])[0];
  let out = [];
  if (robo === 'troca') out = resumoTroca(t);
  else if (robo === 'divisor') out = [achar(/Fim:.*$/m)];
  else if (robo === 'revisor') out = [achar(/fim: \d+ achado\(s\).*$/m), achar(/Mudou desde a ultima conferida:[^<]*/)];
  else if (robo === 'certificados') out = [achar(/fim: \d+ traduzido.*$/m)];
  else if (robo === 'materiais') {
    // hoje em diante sempre; dia que ja passou so com algo a fazer ou problema
    const hoje = opcoes.hoje || new Date();
    const chave = (d, m, a) => `${a}${dois(MESES.indexOf(m) + 1)}${d}`;
    const hojeK = `${hoje.getFullYear()}${dois(hoje.getMonth() + 1)}${dois(hoje.getDate())}`;
    out = (t.match(/^Resumo \d{2}\/\w{3}\/\d{4}:.*$/gm) || []).filter((l) => {
      const [, d, m, a] = l.match(/^Resumo (\d{2})\/(\w{3})\/(\d{4})/);
      return chave(d, m, a) >= hojeK || /[1-9]\d* anexo\(s\) a subir|[1-9]\d* problema/.test(l);
    });
  }
  return out.filter(Boolean).map((l) => l.trim()).slice(0, 5);
}

export function avisouTeams(texto) {
  return /aviso enviado/i.test(texto || '');
}

// ---------- HTML ----------
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const dois = (n) => String(n).padStart(2, '0');
const dataHora = (d) => `${dois(d.getDate())}/${MESES[d.getMonth()]}/${d.getFullYear()} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
const curta = (d) => `${dois(d.getDate())}/${MESES[d.getMonth()]} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
const ICONE = { ok: '✅', erro: '❌', perdida: '⚠️', 'sem-relatorio': '⚠️', rodando: '⏳', nunca: '·' };

const mesmoDia = (a, b) => a && b && a.toDateString() === b.toDateString();
const hora = (d) => `${dois(d.getHours())}:${dois(d.getMinutes())}`;

// Uma linha por tarefa. Check verde so quando a rodada de HOJE ja aconteceu e deu certo (usuario, 19/nov);
// tarefa ok que ainda vai rodar hoje = "aguarda", ok que nao roda hoje = "sem rodada hoje". Erro/perdida seguem como estao.
function linhaTarefa(t, agora) {
  let classe = t.estado;
  let icone = ICONE[t.estado] || '';
  let texto = t.texto;
  // proxima ainda hoje = a rodada de hoje nao aconteceu, mesmo que a tarefa tenha rodado hoje cedo
  // (rodada atrasada de ontem que o Windows soltou ao ligar o PC: caso da 18h em 19/nov 08:17)
  if (t.estado === 'ok' && t.proxima && mesmoDia(t.proxima, agora)) {
    icone = '○'; classe = 'aguarda'; texto = `aguarda ${curta(t.proxima)}`;
  } else if (t.estado === 'ok' && !mesmoDia(t.ultima, agora)) {
    icone = '○'; classe = 'sem-hoje'; texto = `sem rodada hoje · última ${t.ultima ? curta(t.ultima) : 'nunca'}`;
  } else if (t.estado === 'ok') {
    texto = `concluída hoje ${hora(t.ultima)}`;
  } else if (t.estado === 'antiga') {
    icone = '○';
  }
  if (t.cobriu) texto += ` · cobriu a rodada de ${curta(t.cobriu.quando)} ${t.cobriu.estado === 'erro' ? 'que deu erro' : 'que não rodou'}`;
  const prox = t.proxima && classe !== 'aguarda' ? ` · próxima ${esc(curta(t.proxima))}` : '';
  return `<li class="t-${esc(classe)}">${icone} <b>${esc(t.nome)}:</b> ${esc(texto)}${prox}</li>`;
}

// proxima rodada do robo = a mais cedo entre as tarefas (cartoes ordenados por ela: pedido do usuario, 19/nov)
function proximaDoRobo(r) {
  const ds = (r.tarefas || []).map((t) => t.proxima).filter((d) => d instanceof Date && !Number.isNaN(d.getTime()));
  return ds.length ? Math.min(...ds.map((d) => d.getTime())) : Infinity;
}

function cartao(r, i, agora = new Date()) {
  const datas = (k) => (r.tarefas || []).map((t) => t[k]).filter((d) => d instanceof Date && !Number.isNaN(d.getTime()));
  const ultima = datas('ultima').sort((a, b) => b - a)[0] || r.ultima || null;
  const proxima = datas('proxima').sort((a, b) => a - b)[0] || r.proxima || null;
  const fontes = (r.fontes || []).map((f) => `${/\.log$/i.test(f) ? 'Log' : /^[A-Z]:\\/i.test(f) ? 'Relatório' : 'Fonte'}: ${f}`).join('\n');
  const barra = proxima
    ? `<div class="barra"${ultima ? ` data-ultima="${ultima.toISOString()}"` : ''} data-proxima="${proxima.toISOString()}"><div class="enche"></div></div>
      <div class="meta"><span>${ultima ? `rodou ${esc(curta(ultima))}` : 'ainda não rodou'}</span><span>próxima ${esc(curta(proxima))} · <b class="falta"></b></span></div>`
    : `<div class="meta"><span>${ultima ? `rodou ${esc(curta(ultima))}` : 'ainda não rodou'}</span><span>sem próxima rodada</span></div>`;
  const tarefas = (r.tarefas || []).length > 1
    ? `<ul class="tarefas">${r.tarefas.map((t) => linhaTarefa(t, agora)).join('')}</ul>`
    : '';
  const resumo = (r.resumo || []).length ? `<ul class="resumo">${r.resumo.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : '<p class="vazio">Sem resumo da última rodada.</p>';
  const teams = r.teams === null || r.teams === undefined ? '' : `<p class="teams">Teams: ${r.teams ? 'avisou' : 'não avisou'}</p>`;
  // o que vai junto no "Copiar pergunta": a conversa do Claude entende sem abrir o painel
  const contexto = [
    r.descricao ? `O que é: ${r.descricao}` : '',
    r.erroLeitura ? `Erro ao ler: ${r.erroLeitura}` : '',
    (r.tarefas || []).length ? ['Tarefas:', ...r.tarefas.map((t) => `- ${t.nome}: ${t.texto} (${t.ultima ? `rodou ${curta(t.ultima)}` : 'ainda não rodou'}${t.proxima ? ` · próxima ${curta(t.proxima)}` : ''})`)].join('\n') : '',
    (r.resumo || []).length ? ['Última rodada:', ...r.resumo.map((l) => `- ${l}`)].join('\n') : '',
    r.teams === null || r.teams === undefined ? '' : `Teams: ${r.teams ? 'avisou' : 'não avisou'}`,
  ].filter(Boolean).join('\n');
  const attr = (s) => esc(s).replace(/\n/g, '&#10;');
  return `<section class="cartao e-${esc(r.estado)}" data-robo="${esc(r.nome)}" data-estado="${esc(TEXTO_ESTADO[r.estado] || r.estado)}" data-ultima-txt="${ultima ? esc(curta(ultima)) : 'nunca'}" data-fontes="${attr(fontes)}" data-contexto="${attr(contexto)}">
  <header><h2>${esc(r.nome)}</h2><span class="selo">${ICONE[r.estado] || ''} ${esc(TEXTO_ESTADO[r.estado] || r.estado)}</span></header>
  ${r.erroLeitura ? `<p class="erro-leitura">${esc(r.erroLeitura)}</p>` : ''}
  ${barra}
  ${resumo}${teams}${tarefas}
  <details class="pergunta"><summary>Perguntar ao Claude</summary>
    <textarea id="q${i}" rows="2" placeholder="Por que a rodada das 10h não aconteceu?"></textarea>
    <div class="acoes"><button type="button" data-q="q${i}">Copiar pergunta</button><span class="msg" role="status"></span></div>
  </details>
</section>`;
}

/** Pagina completa. robos = [{ nome, estado, tarefas, resumo, teams, fontes, erroLeitura? }] */
// Identidade Agroadvance (tokens do AGENTS/Dev/Live/template-padrao.html): navy #012B4B, verde #00A256,
// mint #42E498, texto #22362D, fundo #F5F5F5, Montserrat. Logo com texto vem do site (sem internet, some e fica o simbolo).
const LOGO_TEXTO = 'https://agroadvance.com.br/wp-content/uploads/2025/03/logo-agroadvance-texto-branco-1024x196.webp';

export function montarHtml({ geradoEm, faixa, robos, logo = null }) {
  const topo = faixa.ok
    ? '<div class="faixa ok">✅ Tudo rodou</div>'
    : `<div class="faixa ruim">⚠️ Precisa de atenção<ul>${faixa.itens.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="300"><title>Robôs · Agroadvance</title>
${logo ? `<link rel="icon" href="${logo}">` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap">
<style>
:root{--navy:#012B4B;--verde:#00A256;--mint:#42E498;--fundo:#F5F5F5;--cartao:#fff;--texto:#22362D;--suave:#5f6f67;--borda:#e1e6e3;--trilho:#e8ecea;--ok:#00A256;--alerta:#c98a12;--erro:#c63b3b;--azul:#012B4B;--faixa-ok:#e2f7ec;--faixa-ruim:#fbf0d9}
@media (prefers-color-scheme:dark){:root{--fundo:#06131d;--cartao:#0d2233;--texto:#e6efe9;--suave:#9fb0a8;--borda:#1d3a50;--trilho:#173246;--ok:#42E498;--azul:#42E498;--faixa-ok:#0f3326;--faixa-ruim:#3a2f17}}
*{box-sizing:border-box}body{margin:0;background:var(--fundo);color:var(--texto);font:15px/1.5 Montserrat,"Helvetica Neue",Arial,sans-serif}
.marca{background:var(--navy);color:#fff;border-bottom:3px solid var(--mint)}.marca-in{max-width:1100px;margin:0 auto;padding:12px 16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.marca .simbolo{width:34px;height:34px}.marca .texto{height:22px}.marca .sep{width:1px;height:24px;background:rgba(255,255,255,.35)}
.marca h1{font-size:20px;font-weight:700;margin:0;letter-spacing:.2px}.marca .gerado{margin-left:auto;color:var(--mint);font-size:13px;font-weight:500}
main{max-width:1100px;margin:0 auto;padding:16px}.velho{color:var(--erro);font-size:13px;display:none;margin:0 0 10px}
.faixa{border-radius:10px;padding:10px 14px;margin-bottom:16px}.faixa.ok{background:var(--faixa-ok)}.faixa.ruim{background:var(--faixa-ruim)}.faixa ul{margin:6px 0 0 18px;padding:0}
.grade{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.cartao{background:var(--cartao);border:1px solid var(--borda);border-top:4px solid var(--borda);border-radius:12px;padding:14px 16px}.e-ok{border-top-color:var(--ok)}.e-erro{border-top-color:var(--erro)}.e-perdida,.e-sem-relatorio{border-top-color:var(--alerta)}
.cartao header{display:flex;justify-content:space-between;gap:8px;align-items:center}.cartao h2{font-size:16px;font-weight:700;margin:0;color:var(--azul)}.selo{font-size:13px;color:var(--suave)}
.e-ok .selo{color:var(--ok)}.e-erro .selo{color:var(--erro)}.e-perdida .selo,.e-sem-relatorio .selo{color:var(--alerta)}
.barra{height:8px;background:var(--trilho);border-radius:4px;overflow:hidden;margin:10px 0 4px}.enche{height:100%;width:0;background:var(--azul);transition:width 1s linear}
.e-ok .enche{background:var(--ok)}.e-erro .enche{background:var(--erro)}.e-perdida .enche,.e-sem-relatorio .enche{background:var(--alerta)}
.meta{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--suave);flex-wrap:wrap}.meta b{color:var(--texto);font-weight:600}
.resumo,.tarefas{margin:8px 0 0;padding-left:18px;font-size:14px}.tarefas{color:var(--suave);font-size:13px}.tarefas b{color:var(--texto);font-weight:600}.t-erro b{color:var(--erro)}.t-perdida b,.t-sem-relatorio b{color:var(--alerta)}.t-erro{color:var(--erro)}.t-perdida,.t-sem-relatorio{color:var(--alerta)}
.vazio,.teams{font-size:13px;color:var(--suave);margin:8px 0 0}.erro-leitura{color:var(--erro);font-size:13px;margin:8px 0 0}
.pergunta{margin-top:10px;font-size:13px}.pergunta summary{cursor:pointer;color:var(--azul)}.pergunta textarea{width:100%;margin-top:6px;font:inherit;padding:6px 8px;border:1px solid var(--borda);border-radius:8px;background:var(--fundo);color:var(--texto)}
.acoes{display:flex;gap:10px;align-items:center;margin-top:6px}.acoes button{font:inherit;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1px;padding:7px 16px;border-radius:26px;border:1px solid var(--mint);background:var(--verde);color:#fff;cursor:pointer}.msg{color:var(--suave)}.msg.erro{color:var(--erro)}
</style></head><body>
<header class="marca"><div class="marca-in">${logo ? `<img class="simbolo" src="${logo}" alt="">` : ''}<img class="texto" src="${LOGO_TEXTO}" alt="Agroadvance" onerror="this.remove()"><span class="sep"></span><h1>Robôs</h1><span class="gerado" data-gerado="${geradoEm.toISOString()}">atualizado ${esc(dataHora(geradoEm))}</span></div></header>
<main>
<p class="velho">A página não é atualizada há mais de 15 min: a tarefa "Painel robos" pode ter parado.</p>
${topo}
<div class="grade">${[...(robos || [])].sort((a, b) => proximaDoRobo(a) - proximaDoRobo(b)).map((r, i) => cartao(r, i, geradoEm)).join('\n')}</div>
</main>
<script>
(function(){
  function falta(ms){if(ms<=0)return 'agora';var s=Math.floor(ms/1000),h=Math.floor(s/3600),m=Math.floor(s%3600/60),x=s%60;
    if(h>=24){var d=Math.floor(h/24);return 'em '+d+'d '+(h%24)+'h';}
    return h?('em '+h+'h '+String(m).padStart(2,'0')+'min'):('em '+m+'min '+String(x).padStart(2,'0')+'s');}
  function tique(){var agora=Date.now();
    document.querySelectorAll('.barra[data-proxima]').forEach(function(b){var p=Date.parse(b.dataset.proxima),u=b.dataset.ultima?Date.parse(b.dataset.ultima):null;
      var pct=u&&p>u?Math.min(100,Math.max(0,(agora-u)/(p-u)*100)):0;b.firstElementChild.style.width=pct.toFixed(1)+'%';
      var f=b.nextElementSibling&&b.nextElementSibling.querySelector('.falta');if(f)f.textContent=falta(p-agora);});
    var g=document.querySelector('[data-gerado]');if(g&&agora-Date.parse(g.dataset.gerado)>15*60000)document.querySelector('.velho').style.display='inline';}
  tique();setInterval(tique,1000);
  document.querySelectorAll('button[data-q]').forEach(function(btn){btn.addEventListener('click',function(){
    var c=btn.closest('.cartao'),q=document.getElementById(btn.dataset.q),msg=btn.nextElementSibling,t=q.value.trim();
    msg.classList.remove('erro');
    if(!t){msg.textContent='Escreva a pergunta primeiro';msg.classList.add('erro');q.focus();return;}
    var texto='Painel dos robôs · '+c.dataset.robo+' · '+c.dataset.estado+' (última rodada '+c.dataset.ultimaTxt+')\\n'+(c.dataset.contexto?c.dataset.contexto+'\\n':'')+(c.dataset.fontes?c.dataset.fontes+'\\n':'')+'Pergunta: '+t;
    function ok(){msg.textContent='Copiado. Cole numa conversa do Claude Code.';}
    function reserva(){var a=document.createElement('textarea');a.value=texto;document.body.appendChild(a);a.select();var r=false;try{r=document.execCommand('copy');}catch(e){}a.remove();
      if(r)ok();else{msg.textContent='Não consegui copiar. Selecione o texto e copie à mão.';msg.classList.add('erro');q.value=texto;q.select();}}
    if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(texto).then(ok,reserva);else reserva();
  });});
  document.querySelectorAll('.pergunta textarea').forEach(function(q){q.addEventListener('input',function(){var m=q.parentElement.querySelector('.msg');if(m){m.textContent='';m.classList.remove('erro');}});});
})();
</script>
</body></html>
`;
}
