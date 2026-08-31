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
	my_role: 'leader',
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
	},
	{
		nome: '10-editor',
		titulo: 'Editor de Brasão',
		nota: 'Interface de customização (Fase 06)',
		corpo: BASE,
		clicar: '.secundario'
	},
	{
		nome: '11-trocar-nome',
		titulo: 'Trocar Nome/TAG',
		nota: 'Fluxo de Bits para identidade',
		corpo: BASE,
		clicar: '.secundario',
		clicarDepois: 'button:has-text("Nome")'
	},
	{
		nome: '12-moderacao',
		titulo: 'Painel de Moderação',
		nota: 'O que o streamer/mod vê na live',
		rota: '/live/',
		corpoFila: {
			items: [
				{
					id: 101,
					name: 'Crimson Order',
					tag: 'CRIM',
					creator_user_id: 'viewer123',
					created_at: new Date().toISOString(),
					description: 'Guilda focada em eventos noturnos.'
				}
			]
		}
	},
	{
		nome: '13-configuracao',
		titulo: 'Configuração do Canal',
		nota: 'Instalação e ajustes do bot',
		rota: '/config/',
		corpoConfig: {
			enabled: true,
			webhook_url: 'https://bot.foyth.tv/guildas',
			hourly_cap: 12,
			events: []
		}
	},
	{
		nome: '14-overlay',
		titulo: 'Overlay de Guerra',
		nota: 'Placar ao vivo sobre o vídeo',
		rota: '/overlay/',
		corpoGuerras: {
			items: [
				{
					id: 50,
					challenger: { tag: 'VOID', score: 1450 },
					defender: { tag: 'ECLIPSE', score: 1320 }
				}
			]
		}
	},
	{
		nome: '15-ranking',
		titulo: 'Aba Ranking',
		nota: 'Lista competitiva',
		corpo: BASE,
		clicar: 'button:has-text("Ranking")',
		corpoRanking: {
			items: [
				{ position: 1, name: 'Void Walkers', tag: 'VOID', prestige: 15420, level: 18 },
				{ position: 2, name: 'Eclipse', tag: 'ECL', prestige: 13850, level: 16 },
				{ position: 3, name: 'Crimson', tag: 'CRM', prestige: 12700, level: 14 }
			]
		}
	},
	{
		nome: '16-lista-guildas',
		titulo: 'Aba Guildas',
		nota: 'Procurando guilda para entrar',
		corpo: null, // sem guilda cai na lista
		corpoGuildas: {
			items: [
				{ id: 2, name: 'Eclipse', tag: 'ECL', member_count: 8, member_limit: 15 },
				{ id: 3, name: 'Crimson', tag: 'CRM', member_count: 14, member_limit: 15 }
			]
		}
	},
	{
		nome: '17-criar',
		titulo: 'Aba Criar',
		nota: 'Formulário de nova guilda',
		corpo: null,
		clicar: 'button:has-text("Criar")'
	},
	{
		nome: '18-mobile',
		titulo: 'Mobile',
		nota: 'Mesmo painel, alvos de 44pt',
		rota: '/mobile/',
		corpo: BASE
	},
	{
		nome: '19-painel-guerra-vazio',
		titulo: 'Aba Guerra (Vazio)',
		nota: 'Sem guerras ativas',
		corpo: BASE,
		clicar: 'button:has-text("Guerra")'
	},
	{
		nome: '20-painel-guerra-ativa',
		titulo: 'Aba Guerra (Ativa)',
		nota: 'Combate em curso com placar',
		corpo: BASE,
		clicar: 'button:has-text("Guerra")',
		corpoGuerras: {
			items: [
				{
					id: 50,
					format: 'skirmish',
					status: 'active',
					challenger_guild_id: 1,
					defender_guild_id: 2,
					score_challenger: 1450,
					score_defender: 1320,
					ends_at: new Date(Date.now() + 3600000).toISOString(),
					challenger: { guild_id: 1, tag: 'OCR', score: 1450 },
					defender: { guild_id: 2, tag: 'ECL', score: 1320 }
				}
			]
		}
	},
	{
		nome: '21-escalacao-roster',
		titulo: 'Escalação de Time',
		nota: 'Líder escolhendo membros ativos',
		corpo: BASE,
		clicar: 'button:has-text("Guerra")',
		clicarDepois: '.ajuste-roster',
		corpoGuerras: {
			items: [
				{
					id: 50,
					format: 'skirmish',
					status: 'pending',
					challenger_guild_id: 1,
					defender_guild_id: 2,
					roster_size: 3,
					challenge_expires_at: new Date(Date.now() + 7200000).toISOString(),
					challenger: { guild_id: 1, tag: 'OCR', score: 0 },
					defender: { guild_id: 2, tag: 'ECL', score: 0 }
				}
			]
		},
		corpoElegibilidade: {
			items: [
				{ user_id: 'foyth', role: 'leader', events: 15, is_eligible: true },
				{ user_id: 'viewer_ativo', role: 'officer', events: 10, is_eligible: true },
				{ user_id: 'viewer_novo', role: 'member', events: 5, is_eligible: true },
				{ user_id: 'inativo_123', role: 'recruit', events: 0, is_eligible: false }
			],
			active_count: 3
		}
	},
	{
		nome: '22-mapa-mundi',
		titulo: 'Mapa de Dominação',
		nota: 'Visualização estratégica de territórios',
		corpo: BASE,
		clicar: 'button:has-text("Mapa")',
		corpoTerritorios: {
			items: [
				{
					id: 1,
					name: 'Floresta Sombria',
					map_x: 200,
					map_y: 300,
					prestige_per_day: 15,
					owner_guild_id: 1,
					owner_tag: 'OCR',
					owner_name: 'Ordem Carmesim',
					enabled: true,
					protected_until: new Date(Date.now() + 86400000).toISOString()
				},
				{
					id: 2,
					name: 'Pico do Dragão',
					map_x: 700,
					map_y: 150,
					prestige_per_day: 25,
					owner_guild_id: null,
					enabled: true,
					active_dispute_id: 10,
					dispute_closes_at: new Date(Date.now() + 43200000).toISOString()
				}
			]
		}
	},
	{
		nome: '23-config-territorios',
		titulo: 'Gerenciar Territórios',
		nota: 'Painel do streamer para criar o mundo',
		rota: '/config/',
		corpoTerritorios: {
			items: [
				{ id: 1, name: 'Floresta Sombria', map_x: 200, map_y: 300, prestige_per_day: 15, enabled: true }
			]
		}
	},
	{
		nome: '24-conquistas',
		titulo: 'Galeria de Conquistas',
		nota: 'Medalhas desbloqueadas e progresso',
		corpo: BASE,
		clicar: '.conquistas-resumo',
		corpoConquistas: {
			unlocked: [
				{ code: 'first_blood', name: 'Primeiro Sangue', description: 'Venceu o primeiro evento da temporada.', scope: 'seasonal', season_number: 1, rarity: 'epic' },
				{ code: 'army', name: 'Exército', description: 'Alcançou 20 membros.', scope: 'permanent', rarity: 'rare' }
			],
			progress: [
				{ code: 'Dominadores', current: 42, target: 100 }
			]
		}
	},
	{
		nome: '25-historico',
		titulo: 'Hall da Fama',
		nota: 'Pódios de temporadas passadas',
		corpo: BASE,
		clicar: 'nav button:has-text("Ranking")',
		clicarDepois: '[data-testid="botao-historico"]',
		corpoRanking: {
			items: [
				{ position: 1, name: 'Void Walkers', tag: 'VOID', prestige: 15420, level: 18 }
			]
		},
		corpoTemporadas: {
			items: [
				{ id: 1, name: 'Temporada 1', status: 'closed', ends_at: '2026-08-01' }
			]
		},
		corpoPodio: {
			awards: [
				{ position: 1, tag: 'VOID', prestige_final: 15420 },
				{ position: 2, tag: 'ECL', prestige_final: 13850 },
				{ position: 3, tag: 'CRM', prestige_final: 12700 }
			]
		}
	}
];

const MOCK_CATALOGO = {
	version: 3,
	assets: [
		{ id: 'shape.heater', layer: 'shape', tier: 'free', svg_symbol_id: 'shape--heater' },
		{ id: 'bg.solid', layer: 'background', tier: 'free', svg_symbol_id: 'bg--solid' },
		{ id: 'symbol.sword', layer: 'symbol', tier: 'free', svg_symbol_id: 'symbol--sword' },
		{ id: 'symbol.dragon', layer: 'symbol', tier: 'paid', price_bits: 300, svg_symbol_id: 'symbol--dragon' },
		{ id: 'palette.ember', layer: 'palette', tier: 'free', svg_symbol_id: 'palette--ember' }
	],
	sprite_url: '',
	prices: { 'guild.rename': 500, 'guild.tag': 300 }
};

const server = await serve({ port: PORTA, ebs: EBS });
const browser = await chromium.launch();
await mkdir(SAIDA, { recursive: true });

for (const cena of CENAS) {
	const context = await browser.newContext({ viewport: { width: 318, height: 496 } });
	const page = await context.newPage();
	await page.emulateMedia({ reducedMotion: 'reduce' });

	try {
		await page.route('**/api/v1/**', async (rota) => {
			if (cena.abortar) return rota.abort();
			if (cena.atrasoMs) return new Promise(() => {});

			const url = rota.request().url();
			if (url.includes('/emblem/catalog')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(MOCK_CATALOGO)
				});
			}
			if (url.includes('/entitlements')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ assets: ['shape.heater'], slots_owned: 1, credit_bits: 0, level: 12 })
				});
			}
			if (url.includes('/mod/guilds')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoFila ?? { items: [] })
				});
			}
			if (url.includes('/announce/config')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoConfig ?? {})
				});
			}
			if (url.includes('/territories')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoTerritorios ?? { items: [] })
				});
			}
			if (url.includes('/rank')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						season_id: 1,
						position: 5,
						prestige: 9850,
						delta_position: 2,
						live: true
					})
				});
			}
			if (url.includes('/achievements')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoConquistas ?? { unlocked: [], progress: [] })
				});
			}
			if (url.includes('/seasons/current')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						id: 1,
						name: 'Temporada 1',
						status: 'active',
						ends_at: new Date(Date.now() + 86400000).toISOString()
					})
				});
			}
			if (url.includes('/seasons') && !url.includes('/current')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoTemporadas ?? { items: [] })
				});
			}
			if (url.includes('/podium')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoPodio ?? { awards: [] })
				});
			}
			if (url.includes('/wars/active')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoGuerras ?? { items: [] })
				});
			}
			if (url.includes('/ranking')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoRanking ?? { items: [] })
				});
			}
			if (url.includes('/guilds') && !url.includes('/emblem')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoGuildas ?? { items: [] })
				});
			}
			if (url.includes('/members/eligibility')) {
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify(cena.corpoElegibilidade ?? { items: [] })
				});
			}
			if (url.includes('/wars/') && !url.includes('/score') && !url.includes('/active')) {
				const w = (cena.corpoGuerras?.items ?? [])[0] ?? {};
				return rota.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ war: w, roster: [] })
				});
			}

			return rota.fulfill({
				status: cena.status ?? 200,
				contentType: 'application/json',
				body: JSON.stringify(cena.corpo ?? null)
			});
		});

		// Injeta o mock da Twitch antes de navegar para evitar o estado infinito de carregamento.
		await page.addInitScript(() => {
			window.Twitch = {
				ext: {
					onAuthorized: (fn) => {
						// Simula autorização imediata com dados de teste
						fn({
							token: 'mock-token',
							channelId: '123456',
							userId: 'dev-user',
							opaqueUserId: 'Udev'
						});
					},
					actions: { requestIdShare: () => {} },
					listen: () => {},
					unlisten: () => {}
				}
			};
		});

		const rota = cena.rota ?? '/panel/';
		await page.goto(`http://localhost:${PORTA}${rota}`, { waitUntil: 'load' });
		await page.waitForTimeout(600);

		if (cena.clicar) {
			await page.waitForSelector(cena.clicar, { state: 'visible', timeout: 5000 });
			await page.click(cena.clicar);
			await page.waitForTimeout(1000);
		}
		if (cena.clicarDepois) {
			await page.waitForSelector(cena.clicarDepois, { state: 'visible', timeout: 5000 });
			await page.click(cena.clicarDepois);
			await page.waitForTimeout(800);
		}

		await page.screenshot({ path: `${SAIDA}/${cena.nome}.png` });
		console.log(`  [OK] ${cena.nome}  ${cena.titulo}`);
	} catch (e) {
		console.error(`  [ERRO] ${cena.nome} ${cena.titulo}:`, e.message);
		await page.screenshot({ path: `${SAIDA}/${cena.nome}-ERRO.png` }).catch(() => {});
	} finally {
		await page.close();
		await context.close();
	}
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
