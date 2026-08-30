/**
 * Wrapper do `window.Twitch.ext`. Fora da Twitch (dev local) cai num modo falso
 * para dar para trabalhar sem subir versão a cada mudança.
 *
 * O token é reemitido periodicamente e `onAuthorized` dispara de novo. Nada
 * neste arquivo guarda cópia do token: quem precisa dele chama `tokenAtual()`
 * na hora do request.
 */
export type Auth = {
	token: string;
	channelId: string;
	/** Só existe se o viewer concedeu identidade. Opaco caso contrário. */
	userId: string | null;
	opaqueUserId: string;
};

type BitsProduct = { sku: string; cost: { amount: string; type: string }; displayName: string };

let auth: Auth | null = null;
const ouvintes = new Set<(a: Auth) => void>();

export const ext = () => (globalThis as any).Twitch?.ext ?? null;
export const naTwitch = () => !!ext();

export function tokenAtual(): string | null {
	return auth?.token ?? null;
}

export function authAtual(): Auth | null {
	return auth;
}

/**
 * Registra um ouvinte de autorização. Dispara imediatamente se já autorizado,
 * porque o componente pode montar depois do primeiro `onAuthorized`.
 */
export function onAuth(fn: (a: Auth) => void): () => void {
	ouvintes.add(fn);
	if (auth) fn(auth);
	return () => ouvintes.delete(fn);
}

function definir(a: Auth) {
	auth = a;
	for (const fn of ouvintes) fn(a);
}

export function iniciar() {
	const t = ext();
	if (!t) {
		// Dev local: o EBS aceita qualquer JWT assinado com o segredo de teste.
		definir({
			token: import.meta.env.VITE_DEV_TOKEN ?? '',
			channelId: import.meta.env.VITE_DEV_CHANNEL ?? '0',
			userId: import.meta.env.VITE_DEV_USER ?? 'dev-user',
			opaqueUserId: 'Udev'
		});
		return;
	}
	t.onAuthorized((a: any) => {
		definir({
			token: a.token,
			channelId: a.channelId,
			// A Twitch manda "U..." quando não há identidade concedida.
			userId: a.userId ?? null,
			opaqueUserId: a.userId ?? a.opaqueUserId
		});
	});
}

/** `IDENTITY_REQUIRED` do EBS é fluxo, não erro: leva o viewer a este pedido. */
export function pedirIdentidade() {
	ext()?.actions?.requestIdShare();
}

export function ouvirBroadcast<T>(fn: (m: T) => void): () => void {
	const t = ext();
	if (!t) return () => {};
	const handler = (_alvo: string, _tipo: string, corpo: string) => {
		try {
			fn(JSON.parse(corpo) as T);
		} catch {
			/* mensagem malformada não derruba o painel */
		}
	};
	t.listen('broadcast', handler);
	return () => t.unlisten('broadcast', handler);
}

/**
 * Bits em extensão só existem em canal Affiliate ou Partner. Sem isso a compra
 * falha depois que o viewer já preencheu tudo.
 *
 * `undefined` significa "a Twitch ainda não disse" — nesse caso deixa passar e
 * quem barra é o próprio `useBits`.
 */
export function bitsHabilitado(): boolean {
	return ext()?.features?.isBitsEnabled !== false;
}

/** A Twitch pode habilitar Bits no meio da sessão. */
export function aoMudarRecursos(fn: () => void): () => void {
	const t = ext();
	t?.features?.onChanged?.(fn);
	return () => {};
}

export async function produtosBits(): Promise<BitsProduct[]> {
	return (await ext()?.bits?.getProducts()) ?? [];
}

/**
 * Gasta Bits e resolve com o recibo (JWT) que o EBS valida. Rejeita se o viewer
 * cancelar. O chamador precisa tratar o caso de a aba fechar entre pagar e
 * confirmar — o backend reconcilia, a UI mostra "em confirmação".
 */
export function gastarBits(sku: string): Promise<string> {
	const t = ext();
	if (!t?.bits) return Promise.reject(new Error('BITS_INDISPONIVEL'));
	return new Promise((ok, falha) => {
		t.bits.onTransactionComplete((tx: any) => ok(tx.transactionReceipt));
		t.bits.onTransactionCancelled(() => falha(new Error('BITS_CANCELADO')));
		t.bits.useBits(sku);
	});
}
