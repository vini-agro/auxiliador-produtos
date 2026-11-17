// Logica pura do robo de materiais (16/nov/2026): le a pasta Share
// (B2B|B2C/<curso>/<dd.mm.aa[ - sufixo]>/arquivo), descobre a data de cada
// material e casa com as aulas do Teamup (titulo "SIGLA | aula | professor").
// Sem I/O aqui: o script scripts/simular-materiais.mjs faz Teamup/LW/pasta.

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// Pasta do curso -> como ela aparece na cabeca do titulo do Teamup.
// Sem entrada aqui, vale o proprio nome da pasta (PFV, GPA, Sanjo...).
export const APELIDOS_DE_PASTA = {
  MBAS: ['LGE', 'GTC', 'MEA', 'MBAS'], // aula conjunta dos MBAs: "LGE, GTC, MEA | ..."
  PSS: ['PSS', 'PFS'], // pasta PSS guarda a aula conjunta PFS/PSS
  'BAYER MILHO': ['BAYER'], // turmas uab-* aparecem so' como "Bayer"
};

export function normalizar(texto) {
  return (texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** "17.11.2026", "16.11.26 - Bayer HF", "171126_Sistema imune.pdf", "091126" -> "2026-11-17" */
export function dataDoNome(nome) {
  const m = (nome || '').match(/^(\d{2})[.\-]?(\d{2})[.\-]?(\d{4}|\d{2})(?!\d)/);
  if (!m) return null;
  const dia = +m[1];
  const mes = +m[2];
  const ano = m[3].length === 2 ? 2000 + +m[3] : +m[3];
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** "2026-11-17" -> "17/nov/2026" */
export function dataBr(iso) {
  const [a, m, d] = iso.split('-');
  return `${d}/${MESES[+m - 1]}/${a}`;
}

/**
 * Caminho relativo a Share -> material. Aceita "B2C/PFV/17.11.2026/arq.pdf",
 * "B2B/Bayer/16.11.26 - Bayer HF/arq.docx", "PNV/16.11.26/arq.pdf" e arquivo
 * solto no curso com data no nome ("B2C/GPA/191026_Aula.pdf").
 */
export function lerCaminho(caminho) {
  const partes = caminho.split('/').filter(Boolean);
  let grupo = null;
  if (partes[0] === 'B2B' || partes[0] === 'B2C') grupo = partes.shift();
  if (partes.length < 2) return null;
  const curso = partes[0];
  const arquivo = partes[partes.length - 1];
  const subpasta = partes.length >= 3 ? partes[1] : null;
  let data = null;
  let sufixo = null;
  if (subpasta) {
    data = dataDoNome(subpasta);
    const s = subpasta.match(/^[\d.\-]+\s*-\s*(.+)$/);
    if (s) sufixo = s[1].trim();
  }
  if (!data) data = dataDoNome(arquivo);
  return { caminho, grupo, curso, subpasta, sufixo, arquivo, data };
}

/** O que sobe para o aluno. Regra combinada: so' PDF. */
export function classificarArquivo(arquivo, irmaos = []) {
  const ext = (arquivo.split('.').pop() || '').toLowerCase();
  if (ext === 'pdf') return { sobe: true };
  const base = arquivo.replace(/\.[^.]+$/, '');
  if (ext === 'pptx' || ext === 'ppt') {
    const temPdf = irmaos.some((i) => i.toLowerCase().endsWith('.pdf') && normalizar(i.replace(/\.[^.]+$/, '')).replace(/[^A-Z0-9]/g, '') === normalizar(base).replace(/[^A-Z0-9]/g, ''));
    return { sobe: false, motivo: temPdf ? 'slides: vai o PDF' : 'slides SEM PDF correspondente' };
  }
  if (['docx', 'doc', 'xlsx', 'xls'].includes(ext)) return { sobe: false, motivo: `${ext}: fora da regra (decidir)` };
  if (['mp4', 'mov', 'jpg', 'jpeg', 'png'].includes(ext)) return { sobe: false, motivo: `${ext}: video/imagem nao vai` };
  return { sobe: false, motivo: `${ext || 'sem extensao'}: fora da regra` };
}

/** "LGE, GTC, MEA | Segmentacao | Adelino" -> ["LGE","GTC","MEA"] */
export function cabecaDoEvento(titulo) {
  return (titulo || '')
    .split('|')[0]
    .split(/[,/+]/)
    .map(normalizar)
    .filter(Boolean);
}

export function chaveDaPasta(material) {
  return normalizar(material.sufixo || material.curso);
}

export function pastaCasaComEvento(chave, tituloEvento, apelidos = APELIDOS_DE_PASTA) {
  const cabeca = cabecaDoEvento(tituloEvento);
  const candidatos = apelidos[chave] || [chave];
  return candidatos.some((c) => cabeca.includes(c));
}

/** Agrupa materiais de uma data por pasta (curso + sufixo). */
export function pastasDoDia(materiais, dataIso) {
  const grupos = new Map();
  for (const m of materiais) {
    if (!m || m.data !== dataIso) continue;
    const chave = chaveDaPasta(m);
    if (!grupos.has(chave)) grupos.set(chave, { chave, rotulo: [m.grupo, m.curso, m.subpasta].filter(Boolean).join('/'), arquivos: [] });
    grupos.get(chave).arquivos.push(m.arquivo);
  }
  return [...grupos.values()];
}

function chaveDeTexto(texto) {
  return normalizar(texto).replace(/[^A-Z0-9]/g, '');
}

/** Nome da aula no titulo: "[Ao vivo] 17/11/2026 | Sistema imune | Prof" ou "PFV | Sistema imune | Prof" -> "SISTEMAIMUNE" */
export function nomeDaAula(titulo) {
  const partes = (titulo || '').split('|');
  return chaveDeTexto(partes.length >= 2 ? partes[1] : partes[0]);
}

/**
 * Atividade(s) da LW que devem receber o material de uma aula. Depois da aula a
 * atividade do Zoom e' apagada e entra a gravacao como atividade NOVA (outro id,
 * mesmo titulo), entao o link do Teamup nao serve: acha pela data + nome da aula.
 * Se ja' existe atividade que nao e' Zoom (gravacao/VMIX), so' ela conta.
 * units: Map(id -> {titulo, tipo, anexos})
 */
export function escolherAtividades(units, tituloEvento, dataIso, unitDoLink = null) {
  const [a, m, d] = dataIso.split('-');
  const dataNoTitulo = `${d}/${m}/${a}`;
  const alvo = nomeDaAula(tituloEvento);
  const achadas = [];
  for (const [id, u] of units) {
    if (!(u.titulo || '').includes(dataNoTitulo) || u.tipo === 'assessmentV2') continue;
    const nome = nomeDaAula(u.titulo);
    if (alvo && nome && (nome === alvo || nome.startsWith(alvo) || alvo.startsWith(nome))) achadas.push({ id, ...u });
  }
  const semZoom = achadas.filter((u) => u.tipo !== 'zoomMeeting' && u.tipo !== 'teamsMeeting');
  if (semZoom.length) return { atividades: semZoom, como: 'titulo' };
  if (achadas.length) return { atividades: achadas, como: 'titulo' };
  if (unitDoLink && units.has(unitDoLink)) return { atividades: [{ id: unitDoLink, ...units.get(unitDoLink) }], como: 'link do Teamup (titulo diferente)' };
  return { atividades: [], como: null };
}

/**
 * Plano do dia: cada pasta com material casada com o(s) evento(s) do Teamup.
 * eventos: [{ titulo, data, turmas: [{ courseid, unit }] }]
 */
export function montarPlano(materiais, eventos, dataIso, apelidos = APELIDOS_DE_PASTA) {
  const pastas = pastasDoDia(materiais, dataIso);
  const doDia = eventos.filter((e) => e.data === dataIso);
  const usados = new Set();
  const itens = [];
  for (const pasta of pastas) {
    const casados = doDia.filter((e) => pastaCasaComEvento(pasta.chave, e.titulo, apelidos));
    casados.forEach((e) => usados.add(e));
    const arquivos = pasta.arquivos.map((a) => ({ arquivo: a, ...classificarArquivo(a, pasta.arquivos) }));
    itens.push({ pasta, eventos: casados, arquivos });
  }
  const eventosSemPasta = doDia.filter((e) => !usados.has(e));
  return { data: dataIso, itens, eventosSemPasta };
}
