import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { chamar, ErroApi, mensagemDe } from './api';
import { iniciar, viewerStore } from './twitch';
import * as twitch from './twitch';

beforeEach(() => vi.spyOn(twitch, 'tokenAtual').mockReturnValue('jwt-de-teste'));
afterEach(() => vi.restoreAllMocks());

const resposta = (status: number, corpo: unknown) =>
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(JSON.stringify(corpo), { status }))
	);

describe('tradução de erro', () => {
	it('troca o código por uma mensagem que diz o que fazer', () => {
		expect(mensagemDe('GUILD_FULL')).toContain('peça vaga ao líder');
	});

	it('código desconhecido cai na mensagem do servidor', () => {
		expect(mensagemDe('ALGO_NOVO', 'mensagem crua do EBS')).toBe('mensagem crua do EBS');
	});

	it('sem código nem mensagem, ainda diz algo acionável', () => {
		expect(mensagemDe('ALGO_NOVO')).toBe('Algo deu errado. Tente de novo.');
	});
});

describe('iniciar', () => {
	it('faz fallback para broadcaster quando a Twitch não entregou uma role válida em localhost', () => {
		const originalWindow = (globalThis as any).window;
		(globalThis as any).window = {
			Twitch: {
				ext: {
					viewer: { role: null },
					onAuthorized: vi.fn()
				}
			}
		};

		viewerStore.set({ role: 'viewer', isLoaded: false, token: null });
		iniciar();

		let atual: any;
		const unsub = viewerStore.subscribe((v) => (atual = v));
		unsub();
		expect(atual).toMatchObject({ role: 'broadcaster', isLoaded: true, token: 'dev-token' });

		(globalThis as any).window = originalWindow;
	});
});

describe('chamar', () => {
	it('manda o token corrente, não uma cópia guardada', async () => {
		const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);

		vi.mocked(twitch.tokenAtual).mockReturnValue('primeiro');
		await chamar('/x');
		vi.mocked(twitch.tokenAtual).mockReturnValue('renovado');
		await chamar('/x');

		const usados = fetchMock.mock.calls.map(
			([, init]: any) => init.headers.Authorization
		);
		expect(usados).toEqual(['Bearer primeiro', 'Bearer renovado']);
	});

	it('preserva os dados extras do envelope de erro', async () => {
		resposta(409, { error: { code: 'IDENTITY_COOLDOWN', message: 'espere', retry_after: 42 } });
		await expect(chamar('/x')).rejects.toMatchObject({
			code: 'IDENTITY_COOLDOWN',
			status: 409,
			dados: { retry_after: 42 }
		});
	});

	it('204 não tenta parsear corpo vazio', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 204 })));
		await expect(chamar('/x')).resolves.toBeUndefined();
	});

	it('falha de rede vira REDE, que é também o que a CSP bloqueada produz', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				throw new TypeError('Failed to fetch');
			})
		);
		await expect(chamar('/x')).rejects.toMatchObject({ code: 'REDE', status: 0 });
	});

	it('sem token não chega a chamar a rede em rota autenticada', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		vi.mocked(twitch.tokenAtual).mockReturnValue(null);
		await expect(chamar('/x')).rejects.toBeInstanceOf(ErroApi);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('rota pública continua funcionando sem token', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		vi.mocked(twitch.tokenAtual).mockReturnValue(null);
		await expect(chamar('/x', { requerAuth: false })).resolves.toEqual({ ok: true });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('abort não é confundido com queda de rede', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => {
				const e = new Error('abortado');
				e.name = 'AbortError';
				throw e;
			})
		);
		await expect(chamar('/x')).rejects.toHaveProperty('name', 'AbortError');
	});
});
