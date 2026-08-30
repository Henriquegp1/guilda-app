/**
 * Screenshot de cada estado do painel, mais uma folha de contato com todos
 * lado a lado. Serve para crítica visual — o que não se olha, não se corrige.
 *
 *   node scripts/olhar.js
 */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { serve } from './csp-serve.js';

const EBS = process.env.VITE_EBS ?? 'http://localhost:3000';
const PORTA = 4200;
const SAIDA = '.olhar';

const BASE = {
	id: 1,
	name: 'Ordem Carmesim',
	tag: 'OCR',
	status: 'active',
	level: 12,
	xp: 34500,
	prestige: 9850,
	member_count: 15,
	member_limit: 15,
	motto: 'Do carmim nasce a aurora',
	description:
		'Guilda de veteranos do canal. Entramos em todo evento, disputamos território e não deixamos ninguém para trás.'
};

/** Cada cena descreve o que a API responde e como. */
const CENAS = [
	{
		nome: '01-carregando',
		titulo: 'Carregando',
		nota: 'Losango heráldico, não spinner',
		corpo: BASE,
		atrasoMs: 100_000 // nunca resolve dentro da captura
	},
	{
		nome: '02-vazio',
		titulo: 'Sem guilda',
		nota: 'Primeira tela de todo viewer novo',
		corpo: null
	},
	{
		nome: '03-ativa',
		titulo: 'Guilda ativa',
		nota: 'O caso comum',
		corpo: BASE
	},
	{
		nome: '04-pendente',
		titulo: 'Aguardando aprovação',
		nota: 'Criada e paga, esperando o streamer',
		corpo: {
			...BASE,
			status: 'pending',
			level: 1,
			prestige: 0,
			member_count: 1,
			member_limit: 10,
			description: null
		}
	},
	{
		nome: '05-overflow',
		titulo: 'Acima do limite',
		nota: 'Queda de nível reduziu vagas; ninguém foi expulso',
		corpo: { ...BASE, status: 'overflow', member_count: 17, member_limit: 15 }
	},
	{
		nome: '06-rejeitada',
		titulo: 'Rejeitada',
		nota: 'Motivo da moderação, com crédito de Bits na fase 06',
		corpo: {
			...BASE,
			status: 'suspended',
			reject_reason: 'O nome infringe as regras do canal. Corrija e reenvie sem pagar de novo.'
		}
	},
	{
		nome: '07-nome-longo',
		titulo: 'Nome longo',
		nota: 'Caso de borda: 318px não perdoa',
		corpo: {
			...BASE,
			name: 'Irmandade dos Guardiões do Crepúsculo Eterno',
			tag: 'IGCE',
			motto: 'Enquanto houver noite, haverá vigília sobre as muralhas'
		}
	},
	{
		nome: '08-erro-rede',
		titulo: 'EBS fora do ar',
		nota: 'O estado mais provável na vida real',
		abortar: true
	},
	{
		nome: '09-sessao',
		titulo: 'Sessão expirada',
		nota: 'Token da Twitch venceu',
		status: 401,
		corpo: { error: { code: 'UNAUTHORIZED', message: 'token expired' } }
	}
];

const server = await serve({ port: PORTA, ebs: EBS });
const browser = await chromium.launch();
await mkdir(SAIDA, { recursive: true });

for (const cena of CENAS) {
	const page = await browser.newPage({ viewport: { width: 318, height: 496 } });

	await page.route('**/api/v1/**', async (rota) => {
		if (cena.abortar) return rota.abort();
		if (cena.atrasoMs) return new Promise(() => {}); // pendura de propósito
		return rota.fulfill({
			status: cena.status ?? 200,
			contentType: 'application/json',
			body: JSON.stringify(cena.corpo ?? null)
		});
	});

	await page.goto(`http://localhost:${PORTA}/panel/`, { waitUntil: 'load' });
	await page.waitForTimeout(400); // deixa a fonte do Google carregar
	await page.screenshot({ path: `${SAIDA}/${cena.nome}.png` });
	await page.close();
	console.log(`  ${cena.nome}  ${cena.titulo}`);
}

// Folha de contato: um PNG com tudo, que é o que se olha para comparar.
const cartoes = CENAS.map(
	(c) => `<figure>
    <img src="${c.nome}.png" width="318" height="496" alt="${c.titulo}">
    <figcaption><b>${c.titulo}</b><span>${c.nota}</span></figcaption>
  </figure>`
).join('');

await writeFile(
	`${SAIDA}/folha.html`,
	`<meta charset="utf-8"><style>
    body{margin:0;padding:28px;background:#0e0b13;font:13px/1.4 system-ui;color:#e6e1ee}
    .grade{display:flex;flex-wrap:wrap;gap:22px}
    figure{margin:0}
    img{display:block;background:#16121c;border:1px solid #322942}
    figcaption{margin-top:8px;width:318px}
    figcaption b{display:block}
    figcaption span{color:#9a93a8}
  </style><div class="grade">${cartoes}</div>`,
	'utf8'
);

const folha = await browser.newPage({ viewport: { width: 1080, height: 800 } });
await folha.goto(`http://localhost:${PORTA}/../${SAIDA}/folha.html`.replace('/../', '/'), {
	waitUntil: 'load'
});
await folha.close();
await browser.close();
server.close();

console.log(`\n${CENAS.length} estados em ${SAIDA}/`);
