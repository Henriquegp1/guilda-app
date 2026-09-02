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
		viewerStore.set({ role, isLoaded: true, token });
	};

	if (!t) {
		definir('broadcaster', 'dev-token');
		return;
	}

	t.onAuthorized((auth: any) => {
		const role = t.viewer?.role ?? 'viewer';
		definir(role, auth.token);
	});
}

/**
 * Atalho para reagir à autorização da Twitch.
 */
export function onAuth(fn: (auth: any) => void) {
	return viewerStore.subscribe(($v) => {
		if ($v.isLoaded) fn($v);
	});
}

/**
 * Atalho para a lista de produtos (Fase 01).
 */
export function produtosBits(): Promise<any[]> {
	return new Promise((resolve) => {
		const t = (window as any).Twitch?.ext;
		if (!t) {
			resolve([{ sku: 'guild_creation', cost: { amount: 500, type: 'bits' } }]);
			return;
		}
		t.bits.getProducts().then(resolve);
	});
}

export function bitsHabilitado(): boolean {
	const t = (window as any).Twitch?.ext;
	// No modo local (sem t), consideramos habilitado para testes.
	// No modo Twitch, usamos a flag isBitsEnabled, mas com segurança se features não existir.
	return !t || !!t.features?.isBitsEnabled;
}

export function aoMudarRecursos(fn: () => void): () => void {
	const t = (window as any).Twitch?.ext;
	if (!t) return () => {};
	t.onContext((_ctx: any, mudou: string[]) => {
		if (mudou.includes('isBitsEnabled') || mudou.includes('features')) fn();
	});
	return () => {};
}

/**
 * Força o modo de loopback (simulação) para testes de Bits.
 */
export function setLoopback(ativo: boolean) {
	const t = (window as any).Twitch?.ext;
	if (t?.bits?.setUseLoopback) {
		t.bits.setUseLoopback(ativo);
	}
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
		t.bits.onTransactionCancelled(() => reject(new Error('BITS_CANCELADO')));
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
