// automation/scripts/test-lw-robot.js
//
// Script manual de teste do Task 4: escreve um HTML de teste no campo de
// embed da unit "Aula Teste" do curso de teste, e então verifica que o
// conteúdo persistiu abrindo uma sessão de browser TOTALMENTE NOVA (novo
// login, nova navegação do zero) e lendo o valor atual do campo — em vez
// de só confiar que o clique no botão de salvar "funcionou".
import 'dotenv/config';
import { updateEmbedUnit, readEmbedUnit } from '../src/lwRobot.js';

// Marcador único por execução, pra deixar a verificação de persistência
// inequívoca (garante que o valor lido de volta é da ESTA execução, não de
// uma execução anterior do mesmo teste).
const runMarker = `<!-- lwRobot test run ${new Date().toISOString()} -->`;

const testHtml = `${runMarker}
<div style="height: 60px;"></div>
<div style="text-align: center; margin-bottom: 20px;">
  <a href="https://airtable.com/appdXh6tqtPxRpebn/pagbEYRl5TYR2FltN/form?prefill_EventoCursoID=TESTE_ROBO" target="_blank" style="background-color: #007BFF; color: white; padding: 14px 28px; text-decoration: none; font-size: 18px; border-radius: 6px; display: inline-block; font-family: sans-serif;">
    ➜ Avalie a aula de hoje!
  </a>
</div>
<div style="height: 720px; width: 1280px"><iframe src="https://vimeo.com/event/5786015/embed/067d183d30/interaction" allow="autoplay; fullscreen; picture-in-picture; encrypted-media; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen frameborder="0" style="width:100%;height:100%;"></iframe></div>`;

const opts = {
  adminUrl: process.env.LW_ADMIN_URL,
  email: process.env.LW_ADMIN_EMAIL,
  password: process.env.LW_ADMIN_PASSWORD,
  courseTitleId: 'teste-automacao-claude-apagar',
  unitName: 'Aula Teste',
};

console.log('[1/2] Escrevendo e salvando o embed via updateEmbedUnit()...');
const writeResult = await updateEmbedUnit({ ...opts, html: testHtml });
console.log('updateEmbedUnit ->', writeResult);

if (!writeResult.ok) {
  console.error('FALHOU na escrita. Não seguindo para a verificação de persistência.');
  process.exit(1);
}

console.log(
  '[2/2] Verificando persistência com readEmbedUnit() em uma sessão nova (login + navegação do zero)...'
);
const readResult = await readEmbedUnit(opts);
console.log('readEmbedUnit ->', { ok: readResult.ok, error: readResult.error });

if (!readResult.ok) {
  console.error('Não foi possível reabrir a unit para verificar persistência:', readResult.error);
  process.exit(1);
}

const persisted = readResult.html === testHtml;
console.log('Conteúdo persistiu exatamente igual ao que foi salvo:', persisted);

if (!persisted) {
  console.log('--- esperado ---\n' + testHtml);
  console.log('--- encontrado ---\n' + readResult.html);
  process.exit(1);
}

console.log('OK: embed escrito com updateEmbedUnit() e confirmado persistido com readEmbedUnit().');
