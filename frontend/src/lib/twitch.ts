import { writable } from 'svelte/store';

/**
 * Store global de identidade (Versão estável para Svelte 5).
 */
export type Auth = {
	token: string;
	channelId: string;
	userId: string | null;
	opaqueUserId: string;
	role: 'broadcaster' | 'moderator' | 'viewer';
};

// Usamos writable para compatibilidade total entre módulos
export const viewerStore = writable<{
	role: 'broadcaster' | 'moderator' | 'viewer';
	isLoaded: boolean;
	token: string | null;
}>({
	role: 'viewer',
	isLoaded: false,
	token: null
});

let _token: string | null = null;
export const tokenAtual = () => _token;

export function iniciar() {
	if (typeof window === 'undefined') return;
	const t = (window as any).Twitch?.ext;

	const definir = (role: any, token: string) => {
		_token = token;
		const roleValida = role === 'broadcaster' || role === 'moderator' || role === 'viewer' ? role : 'broadcaster';
		viewerStore.set({ role: roleValida, isLoaded: true, token });
	};

	if (!t) {
		definir('broadcaster', 'dev-token');
		return;
	}

	const roleInicial = t.viewer?.role && ['broadcaster', 'moderator', 'viewer'].includes(t.viewer.role)
		? t.viewer.role
		: 'broadcaster';
	definir(roleInicial, 'dev-token');

	t.onAuthorized((auth: any) => {
		const role = auth?.role ?? t.viewer?.role ?? 'viewer';
		const token = auth?.token ?? 'dev-token';
		definir(role, token);
	});
}

/**
 * Atalho para reagir à autorização da Twitch.
 * Retorna a função de cancelamento da inscrição na store.
 */
export function onAuth(fn: (auth: any) => void) {
	return viewerStore.subscribe(($v) => {
		if ($v.isLoaded) fn($v);
	});
}

/**
 * Interface de Bits (Fase 01).
 */
export function gastarBits(sku: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const t = (window as any).Twitch?.ext;
		if (!t) {
			console.log('Simulando gasto de Bits:', sku);
			resolve('receipt-fake-123');
			return;
		}
		t.bits.useBits(sku);
		t.bits.onTransactionComplete((res: any) => resolve(res.transactionReceipt));
		t.bits.onTransactionCancelled(() => reject(new Error('Cancelado')));
	});
}

export function ouvirBroadcast<T>(fn: (m: T) => void): () => void {
	const t = (window as any).Twitch?.ext;
	if (!t) return () => {};
	const handler = (_alvo: string, _tipo: string, corpo: string) => {
		try { fn(JSON.parse(corpo) as T); } catch { }
	};
	t.listen('broadcast', handler);
	return () => t.unlisten('broadcast', handler);
}
