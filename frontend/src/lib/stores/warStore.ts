import { writable, derived } from 'svelte/store';
import { guerrasAtivas, type Guerra } from '$lib/api';
import { ouvirBroadcast } from '$lib/twitch';

function createWarStore() {
	const { subscribe, set, update } = writable<Guerra[]>([]);
	let timer: ReturnType<typeof setInterval> | null = null;

	const load = async () => {
		try {
			const res = await guerrasAtivas();
			set(res.items);
		} catch (e) {
			console.error('Falha ao carregar guerras:', e);
		}
	};

	return {
		subscribe,
		iniciar() {
			load();
			// Fallback Polling (10s)
			if (!timer) timer = setInterval(load, 10000);

			// Integração PubSub (se houver broadcast de atualização)
			const unsubscribePubSub = ouvirBroadcast<{ type: string; wars?: Guerra[] }>((m) => {
				if (m.type === 'war.board' && Array.isArray(m.wars)) {
					set(m.wars);
				}
			});

			return () => {
				if (timer) clearInterval(timer);
				timer = null;
				unsubscribePubSub();
			};
		},
		atualizar: load
	};
}

export const wars = createWarStore();

/** Guerra específica para a guilda atual (se houver). */
export const minhaGuerra = (guildId: number | null) =>
	derived(wars, ($wars) => {
		if (!guildId) return null;
		return (
			$wars.find((w) => w.challenger_guild_id === guildId || w.defender_guild_id === guildId) ?? null
		);
	});
