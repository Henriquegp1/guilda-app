/** Folha de contato de todas as views, com dados de mentira. */
import { chromium } from 'playwright';
import { writeFile, mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { serve } from './csp-serve.js';

const G = { id: 1, name: 'Ordem Carmesim', tag: 'OCR', status: 'active', level: 12, xp: 34500,
  prestige: 9850, member_count: 12, member_limit: 15, my_role: 'member',
  motto: 'Do carmim nasce a aurora' };

const RANK = { snapshot_id: 1, season_id: 1, taken_at: new Date().toISOString(), is_final: false,
  items: [['VOID','Void Walkers',15420,18],['OCR','Ordem Carmesim',9850,12],['ECL','Eclipse',13850,16],
          ['CRM','Crimson',12700,14],['NGF','Nightfall',10300,11],['ARC','Arcadia',9850,10]]
    .sort((a,b)=>b[2]-a[2]).map(([tag,name,prestige,level],i)=>({position:i+1,guild_id:i+1,tag,name,prestige,level})),
  next_cursor: null };

const ROTAS = {
  '/me/guild': G,
  '/guilds/1/progression': { level:12, xp:34500, xp_no_nivel:2100, xp_do_nivel:6500, member_limit:15 },
  '/guilds/1/rank': { position: 4, prestige: 9850 },
  '/ranking': RANK,
  '/seasons/current': { id:1, number:1, name:'Temporada 1 — Guerra dos Monarcas', status:'active',
    starts_at:'2026-07-01', ends_at:'2026-09-29' },
  '/guilds': { items: RANK.items.map(r=>({ id:r.guild_id, name:r.name, tag:r.tag, level:r.level,
    member_count: 8, member_limit: 15, status:'active' })), next_cursor:null },
  '/me/invites': { invites: [{ invite_id:1, code:'abc', expires_at:'2026-09-01',
    guild:{ tag:'ECL', name:'Eclipse' } }] },
  '/wars/active': { items: [{ id:1, format:'skirmish', status:'running', ends_at:null,
    challenger:{ guild_id:1, tag:'VOID', name:'Void', score:1450 },
    defender:{ guild_id:2, tag:'ECLIPSE', name:'Eclipse', score:1320 } }] },
  '/mod/guilds': { items: [
    { id:9, name:'Crimson Order', tag:'CRIM', status:'pending', creator_user_id:'viewer123',
      created_at:new Date().toISOString(), level:1, xp:0, prestige:0, member_count:1, member_limit:10,
      description:'Guilda focada em eventos noturnos.' },
    { id:10, name:'Aurora Boreal', tag:'AUR', status:'pending', creator_user_id:'viewer77',
      created_at:new Date().toISOString(), level:1, xp:0, prestige:0, member_count:1, member_limit:10 }] },
  '/mod/audit-log': { items: [
    { id:1, actor_user_id:'foyth', action:'guild.approve', target:'guild:8', created_at:new Date().toISOString() },
    { id:2, actor_user_id:'mod_ana', action:'guild.reject', target:'guild:7', created_at:new Date().toISOString() }] },
  '/announce/config': { enabled:true, webhook_url:'https://bot.foyth.tv/guildas', max_per_hour:12 },
  '/territories': { items:[{id:1,name:'Floresta Sombria',guild_id:1,guild_tag:'VOID'},
    {id:2,name:'Fortaleza Carmesim',guild_id:2,guild_tag:'ECL'},{id:3,name:'Ruínas Antigas',guild_id:null}] }
};

const CENAS = [
  { nome:'painel-minha', view:'panel', w:318, h:496, titulo:'Painel — minha guilda', nota:'XP, posição e prestígio' },
  { nome:'painel-ranking', view:'panel', w:318, h:496, titulo:'Painel — ranking', nota:'Flip anima a reordenação', aba:'Ranking' },
  { nome:'painel-guildas', view:'panel', w:318, h:496, titulo:'Painel — guildas', nota:'Sem guilda: entrar ou aceitar convite', semGuilda:true },
  { nome:'painel-criar', view:'panel', w:318, h:496, titulo:'Painel — criar', nota:'Validação espelha o servidor', semGuilda:true, aba:'Criar' },
  { nome:'overlay', view:'overlay', w:520, h:150, titulo:'Overlay — guerra', nota:'Placar ao vivo por PubSub' },
  { nome:'live', view:'live', w:880, h:640, titulo:'Live — moderação', nota:'Fila de aprovação e auditoria' },
  { nome:'config', view:'config', w:660, h:700, titulo:'Config — instalação', nota:'Anúncios, temporada, territórios' },
  { nome:'mobile', view:'mobile', w:390, h:600, titulo:'Mobile', nota:'Mesmo painel, alvos de 44pt' }
];

const server = await serve({ port: 4220, ebs: 'http://localhost:3000' });
const browser = await chromium.launch();
await mkdir('.telas', { recursive: true });

for (const c of CENAS) {
  const page = await browser.newPage({ viewport: { width: c.w, height: c.h } });
  await page.route('**/api/v1/**', (r) => {
    const p = new URL(r.request().url()).pathname.replace('/api/v1', '');
    const corpo = c.semGuilda && p === '/me/guild' ? null : (ROTAS[p] ?? null);
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpo) });
  });
  await page.goto(`http://localhost:4220/${c.view}/`, { waitUntil: 'networkidle' });
  if (c.aba) await page.getByRole('button', { name: c.aba }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `.telas/${c.nome}.png` });
  await page.close();
  console.log('  ' + c.nome);
}

const cartoes = CENAS.map(c => `<figure><img src="${c.nome}.png" width="${c.w}" height="${c.h}">
  <figcaption><b>${c.titulo}</b><span>${c.nota}</span></figcaption></figure>`).join('');
await writeFile('.telas/folha.html', `<meta charset="utf-8"><style>
  body{margin:0;padding:26px;background:#0e0b13;font:13px/1.4 system-ui;color:#e6e1ee}
  .g{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
  figure{margin:0}img{display:block;background:#16121c;border:1px solid #322942}
  figcaption{margin-top:8px}figcaption b{display:block}figcaption span{color:#9a93a8}
</style><div class="g">${cartoes}</div>`, 'utf8');

const f = await browser.newPage({ viewport: { width: 1500, height: 900 } });
await f.goto(pathToFileURL(resolve('.telas/folha.html')).href, { waitUntil: 'load' });
await f.screenshot({ path: '.telas/folha.png', fullPage: true });
await browser.close(); server.close();
console.log('\n.telas/folha.png');
