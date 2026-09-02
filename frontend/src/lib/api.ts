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

	let res: Response;
	try {
		res = await fetch(`${BASE}/api/v1${rota}`, {
			method: metodo,
			signal: sinal,
			headers: {
				...(token ? { Authorization: `Bearer ${token}` } : {}),
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
	custom_emblem_url?: string | null;
	reject_reason?: string | null;
};

export type LinhaRanking = {
	position: number;
	guild_id: number;
	prestige: number;
	name: string;
	tag: string;
	level: number;
	delta_position?: number | null;
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

export type WarFormat = 'skirmish' | 'campaign' | 'special';
export type WarStatus =
	| 'pending'
	| 'accepted'
	| 'active'
	| 'ended'
	| 'settled'
	| 'no_contest'
	| 'cancelled'
	| 'declined'
	| 'expired';

export type Guerra = {
	id: number;
	war_id?: number; // vindo do board PubSub
	format: WarFormat;
	status: WarStatus;
	challenger_guild_id: number;
	defender_guild_id: number;
	stake_territory_id: number | null;
	roster_size: number;
	min_points: number;
	score_challenger: number;
	score_defender: number;
	score_seq: number;
	score_updated_at: string | null;
	declared_by: string;
	responded_by: string | null;
	challenge_expires_at: string;
	starts_at: string | null;
	ends_at: string | null;
	ended_at: string | null;
	closed_at: string | null;
	settled_at: string | null;
	winner_guild_id: number | null;
	cancel_reason: string | null;
	prestige_multiplier: number;
	prestige_awarded: Record<number, number> | null;
	season_id: number | null;
	// Campos estendidos para conveniência da UI
	challenger: { guild_id: number; tag: string; name?: string; score: number };
	defender: { guild_id: number; tag: string; name?: string; score: number };
};

export type WarScore = {
	seq: number;
	challenger: { guild_id: number; score: number };
	defender: { guild_id: number; score: number };
	status: WarStatus;
	updated_at: string;
};

export type WarRosterItem = {
	guild_id: number;
	user_id: string;
	locked_at: string | null;
};

export type WarDetails = {
	war: Guerra;
	roster: WarRosterItem[];
};

export type MemberEligibility = {
	user_id: string;
	role: Cargo;
	events: number;
	is_eligible: boolean;
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

export type Achievement = {
	code: string;
	name: string;
	description: string;
	scope: 'permanent' | 'seasonal';
	unlocked_at: string | null;
	season_number?: number | null;
	rarity: 'common' | 'rare' | 'epic' | 'legendary';
};

export type AchievementProgress = {
	code: string;
	name: string;
	description: string;
	current: number;
	target: number;
};

export type AssetTier = 'free' | 'level' | 'paid';
export type AssetLayer = 'shape' | 'background' | 'palette' | 'border' | 'symbol' | 'effect';

export type Asset = {
	id: string;
	layer: AssetLayer;
	tier: AssetTier;
	status: 'active' | 'deprecated' | 'revoked';
	price_bits: number | null;
	unlock_level: number | null;
	svg_symbol_id: string;
	is_layer_fallback: boolean;
	author?: string;
};

export type Catalog = {
	version: number;
	assets: Asset[];
	sprite_url: string;
	denied_combos_hash: string;
	bundle: { sku: string; price_bits: number; pick: number; from: string[] };
	prices: Record<string, number>;
};

export type EmblemLayers = {
	v: number;
	catalog_version: number;
	shape: string;
	background: string;
	palette: string;
	border: string;
	symbol: string;
	effect: string;
};

export type Emblem = {
	id: number;
	slot_index: number;
	layers: EmblemLayers;
	layers_hash: string;
	catalog_version: number;
	status: 'published' | 'pending_review' | 'reverted';
	render_url: string;
	is_active: boolean;
	created_at: string;
	custom_local_path?: string | null;
};

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

// ---- identidade e brasão
export const fetchCatalog = () => get<Catalog>('/emblem/catalog');
export const carregarEmblema = (gid: number) =>
	get<{ active: Emblem | null; slots: Emblem[] }>(`/guilds/${gid}/emblem`);
export const carregarPosses = (gid: number) =>
	get<{ assets: string[]; slots_owned: number; credit_bits: number; level: number }>(
		`/guilds/${gid}/emblem/entitlements`
	);
export const previewEmblema = (gid: number, layers: Partial<EmblemLayers>) =>
	post<{
		valid: boolean;
		violations: { code: string; layer?: string; id?: string; assets?: string[] }[];
		render_url: string | null;
	}>(`/guilds/${gid}/emblem/preview`, { layers });
export const salvarEmblema = (gid: number, slot: number, layers: Partial<EmblemLayers>) =>
	chamar<{
		emblem_id: number;
		status: string;
		render_url: string;
		layers_hash: string;
	}>(`/guilds/${gid}/emblem/slots/${slot}`, { metodo: 'PUT', corpo: { layers } });
export const salvarImagemCustomizada = (gid: number, slot: number, source_url: string) =>
	post<{ emblem_id: number; status: string }>(`/guilds/${gid}/identity/custom-image`, {
		source_url,
		slot
	});
export const ativarSlot = (gid: number, slot: number) =>
	post<{ active_slot: number }>(`/guilds/${gid}/emblem/active`, { slot });
export const comprarSlot = (gid: number, receipt?: string, use_credit = false) =>
	post<{ slot: number; purchase_id: number; credit_remaining: number }>(`/guilds/${gid}/emblem/slots`, {
		transaction_receipt: receipt,
		use_credit
	});
export const comprarAsset = (
	gid: number,
	corpo: {
		asset_id?: string;
		asset_ids?: string[];
		transaction_receipt?: string;
		use_credit?: boolean;
	}
) =>
	post<{ entitlement: string[]; purchase_id: number; credit_remaining: number }>(
		`/guilds/${gid}/store/assets`,
		corpo
	);
export const reportarEmblema = (gid: number, reason: string) =>
	post<{ reported: boolean; state?: string }>(`/guilds/${gid}/emblem/report`, { reason });

// ---- progressão e competição
export const progressao = (gid: number) => get<Progressao>(`/guilds/${gid}/progression`);
export const ranking = (cursor?: string) =>
	get<Ranking>(`/ranking${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`);
export const temporadaAtual = () => get<Temporada | null>('/seasons/current');
export const listarTemporadas = () => get<{ items: Temporada[] }>('/seasons');
export const buscarPodio = (sid: number) =>
	get<{ season: Temporada; awards: { position: number; guild_id: number; tag: string; name: string; prestige_final: number }[] }>(
		`/seasons/${sid}/podium`
	);
export const posicaoDa = (gid: number) =>
	get<{
		season_id: number;
		position: number | null;
		prestige: number;
		delta_position: number | null;
		live: boolean;
	}>(`/guilds/${gid}/rank`);
export const carregarConquistas = (gid: number) =>
	get<{ unlocked: Achievement[]; progress: AchievementProgress[] }>(`/guilds/${gid}/achievements`);

// ---- guerra
export const warsPointsTable = () => get<{ cap_daily: number; rules: any[] }>('/wars/points-table');
export const declararGuerra = (corpo: {
	defender_tag: string;
	format?: WarFormat;
	stake_territory_id?: number;
	opens_at?: string;
	closes_at?: string;
}) => post<Guerra>('/wars', corpo);
export const aceitarGuerra = (id: number) => post<Guerra>(`/wars/${id}/accept`);
export const recusarGuerra = (id: number, reason?: string) =>
	post<Guerra>(`/wars/${id}/decline`, { reason });
export const editarRoster = (id: number, user_ids: string[]) =>
	chamar<{ roster: WarRosterItem[] }>(`/wars/${id}/roster`, { metodo: 'PUT', corpo: { user_ids } });
export const guerrasAtivas = () => get<{ wars: Guerra[] }>('/wars/active');
export const warScore = (id: number) => get<WarScore>(`/wars/${id}/score`);
export const warDetails = (id: number) => get<WarDetails>(`/wars/${id}`);
export const listarGuerras = (filtros: { guild_id?: number; status?: WarStatus; cursor?: string }) => {
	const params = new URLSearchParams();
	if (filtros.guild_id) params.set('guild_id', String(filtros.guild_id));
	if (filtros.status) params.set('status', filtros.status);
	if (filtros.cursor) params.set('cursor', filtros.cursor);
	return get<{ items: Guerra[]; next_cursor: string | null }>(`/wars?${params.toString()}`);
};
export const cancelarGuerraMod = (id: number, reason: string) =>
	post<Guerra>(`/wars/${id}/cancel`, { reason });
export const memberEligibility = (gid: number) =>
	get<{ items: MemberEligibility[]; active_count: number }>(`/guilds/${gid}/members/eligibility`);

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
export type IdentityRequest = {
	request_id: string;
	type: 'name' | 'tag' | 'emblem' | 'emblem_custom';
	guild_id: number;
	guild_name: string;
	requested_by: string;
	old_value?: string;
	new_value?: string;
	layers?: EmblemLayers;
	png_url?: string;
	created_at: string;
};

export const filaModeracao = (status: string = 'pending', cursor?: string) => {
	const params = new URLSearchParams({ status });
	if (cursor) params.set('cursor', cursor);
	return get<{ items: (Guilda & { creator_user_id: string; created_at: string })[]; total: number; next_cursor: string | null }>(
		`/mod/guilds?${params.toString()}`
	);
};
export const filaIdentidade = () => get<{ items: IdentityRequest[] }>('/mod/identity/queue');
export const aprovarIdentidade = (id: string) => post<unknown>(`/mod/identity/${id}/approve`);
export const rejeitarIdentidade = (id: string, reason: string) =>
	post<{ state: string; credit_issued_bits: number }>(`/mod/identity/${id}/reject`, { reason });

export const aprovarGuilda = (id: number) => post<unknown>(`/mod/guilds/${id}/approve`);
export const rejeitarGuilda = (id: number, reason: string, fields: string[] = ['name']) =>
	post<unknown>(`/mod/guilds/${id}/reject`, { reason, fields });

export const suspenderGuilda = (id: number, reason: string) =>
	post<unknown>(`/mod/guilds/${id}/suspend`, { reason });
export const reativarGuilda = (id: number) => post<unknown>(`/mod/guilds/${id}/unsuspend`);
export const banirGuilda = (id: number, reason: string) => post<unknown>(`/mod/guilds/${id}/ban`, { reason });
export const transferirLiderancaMod = (id: number, userId: string, reason: string) =>
	post<unknown>(`/mod/guilds/${id}/transfer-leader`, { user_id: userId, reason });

export const auditoria = (filtros: { target?: string; actor?: string; cursor?: string } = {}) => {
	const params = new URLSearchParams();
	if (filtros.target) params.set('target', filtros.target);
	if (filtros.actor) params.set('actor', filtros.actor);
	if (filtros.cursor) params.set('cursor', filtros.cursor);
	return get<{ items: AuditLogItem[]; next_cursor: string | null }>(`/mod/audit-log?${params.toString()}`);
};

export type AuditLogItem = {
	id: number;
	actor_user_id: string;
	actor_role: string | null;
	action: string;
	target: string;
	before: any;
	after: any;
	created_at: string;
};

export type Territory = {
	id: number;
	slug: string;
	name: string;
	map_x: number;
	map_y: number;
	art_key: string | null;
	prestige_per_day: number;
	enabled: boolean;
	owner_guild_id: number | null;
	owner_name?: string | null;
	owner_tag?: string | null;
	acquired_at?: string | null;
	protected_until?: string | null;
	active_dispute_id?: number | null;
	dispute_closes_at?: string | null;
};

// ---- config.html
export type DeliveryLog = {
	id: string;
	event_type: string;
	status: string;
	http_status: number | null;
	latency_ms: number | null;
	suppress_reason: string | null;
	message: string | null;
	dedup_key: string;
	created_at: string;
};

export const configAnuncio = () =>
	get<{
		enabled: boolean;
		webhook_url: string | null;
		hourly_cap: number;
		quiet_from: string | null;
		quiet_to: string | null;
		timezone: string;
		muted_until: string | null;
		fail_streak: number;
		events: {
			event_type: string;
			enabled: boolean;
			template: string | null;
			template_agg: string | null;
			cooldown_s: number;
			priority: string;
			default_template: string;
			default_template_agg: string | null;
		}[];
	}>('/announce/config');

export const salvarConfigAnuncio = (corpo: {
	enabled?: boolean;
	webhook_url?: string | null;
	hourly_cap?: number;
	quiet_from?: string | null;
	quiet_to?: string | null;
	timezone?: string;
}) => chamar<unknown>('/announce/config', { metodo: 'PUT', corpo });

export const salvarEventoAnuncio = (
	type: string,
	corpo: {
		enabled?: boolean;
		template?: string | null;
		template_agg?: string | null;
		cooldown_s?: number;
	}
) => chamar<unknown>(`/announce/events/${type}`, { metodo: 'PUT', corpo });

export const rotacionarSegredoAnuncio = () =>
	post<{ secret: string; retires_at: string }>('/announce/secret/rotate');

export const mutarAnuncios = (minutos: number, motivo: string) =>
	post<void>('/announce/mute', { minutes: minutos, reason: motivo });

export const desmutarAnuncios = () => chamar<void>('/announce/mute', { metodo: 'DELETE' });

export const testarEventoAnuncio = (type: string) =>
	post<{ delivery_id: string }>('/announce/test', { event_type: type });

export const listarEntregasAnuncio = (cursor?: string) =>
	get<{ items: DeliveryLog[]; next_cursor: string | null }>(
		`/announce/deliveries${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`
	);

export const listarTerritorios = () => get<{ items: Territory[] }>('/territories');
export const criarTerritorio = (corpo: Partial<Territory>) => post<Territory>('/territories', corpo);
export const atualizarTerritorio = (id: number, corpo: Partial<Territory>) =>
	patch<Territory>(`/territories/${id}`, corpo);
export const excluirTerritorio = (id: number) =>
	chamar<void>(`/territories/${id}`, { metodo: 'DELETE' });
export const entrarDisputa = (dispute_id: number) => post<unknown>(`/disputes/${dispute_id}/join`);
export const gerenciarHolding = (id: number, guild_id: number | null, reason: string) =>
	post<unknown>(`/territories/${id}/holdings`, { guild_id, reason });
