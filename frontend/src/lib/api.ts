import { tokenAtual } from './twitch';

const BASE = import.meta.env.VITE_EBS ?? 'http://localhost:3000';

export class ErroApi extends Error {
	constructor(
		readonly code: string,
		readonly status: number,
		mensagem: string,
		readonly dados: Record<string, unknown> = {}
	) {
		super(mensagem);
	}
}

/**
 * Mensagens do lado do usuário, não do sistema: o que aconteceu e o que fazer.
 * Código sem entrada aqui cai na mensagem do servidor, que já vem em português.
 */
const MENSAGENS: Record<string, string> = {
	GUILD_FULL: 'Esta guilda está cheia. Tente outra ou peça vaga ao líder.',
	ALREADY_IN_GUILD: 'Você já está em uma guilda neste canal. Saia dela para entrar em outra.',
	NAME_TAKEN: 'Já existe uma guilda com esse nome neste canal.',
	TAG_TAKEN: 'Essa TAG já está em uso neste canal.',
	VALIDATION_ERROR: 'Confira os campos destacados.',
	IDENTITY_REQUIRED: 'Compartilhe sua identidade com a extensão para continuar.',
	RESERVATION_EXPIRED: 'A reserva do nome expirou. Comece a criação de novo.',
	PAYMENT_ALREADY_USED: 'Este pagamento já criou uma guilda.',
	CURSOR_EXPIRED: 'A lista foi atualizada. Voltando ao início.',
	GUILD_NOT_FOUND: 'Guilda não encontrada.',
	SEASON_NOT_FOUND: 'Este canal ainda não tem temporada.',
	FORBIDDEN: 'Seu cargo não permite esta ação.',
	UNAUTHORIZED: 'Sessão expirada. Recarregue o painel.',
	REDE: 'Sem conexão com o servidor. Verifique e tente de novo.'
};

export const mensagemDe = (code: string, cru?: string) =>
	MENSAGENS[code] ?? cru ?? 'Algo deu errado. Tente de novo.';

type Opcoes = { metodo?: string; corpo?: unknown; sinal?: AbortSignal };

export async function chamar<T>(rota: string, { metodo = 'GET', corpo, sinal }: Opcoes = {}) {
	const token = tokenAtual();
	if (!token) throw new ErroApi('UNAUTHORIZED', 401, mensagemDe('UNAUTHORIZED'));

	let res: Response;
	try {
		res = await fetch(`${BASE}/api/v1${rota}`, {
			method: metodo,
			signal: sinal,
			headers: {
				Authorization: `Bearer ${token}`,
				...(corpo ? { 'Content-Type': 'application/json' } : {})
			},
			body: corpo ? JSON.stringify(corpo) : undefined
		});
	} catch (e) {
		// Falha de rede e bloqueio de CSP chegam aqui iguais. Se `connect-src` não
		// declarar o domínio do EBS, é isto que o viewer vê.
		if ((e as Error).name === 'AbortError') throw e;
		throw new ErroApi('REDE', 0, mensagemDe('REDE'));
	}

	if (res.status === 204) return undefined as T;

	const texto = await res.text();
	const json = texto ? JSON.parse(texto) : null;

	if (!res.ok) {
		const { code = 'DESCONHECIDO', message, ...dados } = json?.error ?? {};
		throw new ErroApi(code, res.status, mensagemDe(code, message), dados);
	}
	return json as T;
}

export const get = <T>(rota: string, sinal?: AbortSignal) => chamar<T>(rota, { sinal });
export const post = <T>(rota: string, corpo?: unknown) => chamar<T>(rota, { metodo: 'POST', corpo });
export const patch = <T>(rota: string, corpo?: unknown) =>
	chamar<T>(rota, { metodo: 'PATCH', corpo });

// ------------------------------------------------------------------- domínio

export type Guilda = {
	id: number;
	name: string;
	tag: string;
	status: 'awaiting' | 'pending' | 'active' | 'overflow' | 'suspended' | 'banned';
	level: number;
	xp: number;
	prestige: number;
	member_count: number;
	member_limit: number;
	description?: string | null;
	motto?: string | null;
	emblem_preset?: string | null;
	reject_reason?: string | null;
};

export type LinhaRanking = {
	position: number;
	guild_id: number;
	prestige: number;
	name: string;
	tag: string;
	level: number;
};

export type Ranking = {
	snapshot_id: number;
	season_id: number;
	taken_at: string;
	is_final: boolean;
	items: LinhaRanking[];
	next_cursor: string | null;
};

export type Cargo = 'leader' | 'officer' | 'veteran' | 'member' | 'recruit';

export type Membro = { user_id: string; role: Cargo; joined_at: string };
export type Pedido = { request_id: number; user_id: string; created_at: string };
export type Convite = {
	invite_id: number;
	code: string;
	expires_at: string;
	guild: { tag: string; name: string };
};

export type Progressao = {
	level: number;
	xp: number;
	xp_no_nivel: number;
	xp_do_nivel: number;
	member_limit: number;
	unlocks?: { level: number; label: string }[];
};

export type Guerra = {
	id: number;
	format: string;
	status: string;
	ends_at: string | null;
	challenger: { guild_id: number; tag: string; name: string; score: number };
	defender: { guild_id: number; tag: string; name: string; score: number };
};

export type Temporada = {
	id: number;
	number: number;
	name: string;
	status: string;
	starts_at: string;
	ends_at: string;
};

export type GuildaPendente = Guilda & { creator_user_id: string; created_at: string };

// ---- viewer
export const minhaGuilda = () => get<(Guilda & { my_role: Cargo }) | null>('/me/guild');
export const listarGuildas = (cursor?: string) =>
	get<{ items: Guilda[]; next_cursor: string | null }>(
		`/guilds${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
	);
export const entrar = (gid: number) => post<unknown>(`/guilds/${gid}/join`);
export const sair = (gid: number) => chamar<void>(`/guilds/${gid}/members/me`, { metodo: 'DELETE' });
export const membros = (gid: number) => get<{ items: Membro[] }>(`/guilds/${gid}/members`);
export const pedidos = (gid: number) => get<{ items: Pedido[] }>(`/guilds/${gid}/requests`);
export const aprovarPedido = (gid: number, rid: number) =>
	post<unknown>(`/guilds/${gid}/requests/${rid}/approve`);
export const recusarPedido = (gid: number, rid: number) =>
	post<unknown>(`/guilds/${gid}/requests/${rid}/reject`);
export const meusConvites = () => get<{ invites: Convite[] }>('/me/invites');
export const aceitarConvite = (code: string) => post<unknown>(`/invites/${code}/accept`);

// ---- progressão e competição
export const progressao = (gid: number) => get<Progressao>(`/guilds/${gid}/progression`);
export const ranking = (cursor?: string) =>
	get<Ranking>(`/ranking${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const temporadaAtual = () => get<Temporada | null>('/seasons/current');
export const posicaoDa = (gid: number) =>
	get<{ position: number | null; prestige: number }>(`/guilds/${gid}/rank`);

// ---- guerra
export const guerrasAtivas = () => get<{ items: Guerra[] }>('/wars/active');

// ---- criação
export const criarRascunho = (corpo: {
	name: string;
	tag: string;
	description?: string;
	motto?: string;
}) => post<Guilda>('/guilds', corpo);
export const confirmarPagamento = (id: number, receipt: string) =>
	post<Guilda>(`/guilds/${id}/transaction`, { transaction_receipt: receipt });

// ---- moderação (live.html)
export const filaModeracao = () => get<{ items: GuildaPendente[] }>('/mod/guilds?status=pending');
export const aprovarGuilda = (id: number) => post<unknown>(`/mod/guilds/${id}/approve`);
export const rejeitarGuilda = (id: number, reason: string, fields: string[] = ['name']) =>
	post<unknown>(`/mod/guilds/${id}/reject`, { reason, fields });
export const auditoria = () =>
	get<{ items: { id: number; actor_user_id: string; action: string; target: string; created_at: string }[] }>(
		'/mod/audit-log'
	);

// ---- config.html
export const configAnuncio = () => get<Record<string, unknown>>('/announce/config');
export const salvarConfigAnuncio = (corpo: unknown) =>
	chamar<unknown>('/announce/config', { metodo: 'PUT', corpo });
export const territorios = () =>
	get<{ items: { id: number; name: string; guild_id: number | null; guild_tag?: string }[] }>(
		'/territories'
	);
