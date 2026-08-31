import { writable, derived } from 'svelte/store';
import { guerrasAtivas, type Guerra } from '$lib/api';
import { ouvirBroadcast } from '$lib/twitch';

function createWarStore() {
	const { subscribe, set, update } = writable<Guerra[]>([]);
	let timer: ReturnType<typeof setInterval> | null = null;

	const load = async () => {
		try {
			const res = await guerrasAtivas();
			set(res.items.map(normalizarGuerra));
		} catch (e) {
			console.error('Falha ao carregar guerras:', e);
		}
	};

	function normalizarGuerra(w: any): Guerra {
		return {
			...w,
			id: w.id ?? w.war_id,
			score_challenger: w.score_challenger ?? w.challenger?.score ?? 0,
			score_defender: w.score_defender ?? w.defender?.score ?? 0,
			challenger: w.challenger ?? {
				guild_id: w.challenger_guild_id,
				tag: w.challenger_tag ?? '???'
			},
			defender: w.defender ?? {
				guild_id: w.defender_guild_id,
				tag: w.defender_tag ?? '???'
			}
		};
	}

	return {
		subscribe,
		iniciar() {
			load();
			// Fallback Polling (10s)
			if (!timer) timer = setInterval(load, 10000);

			// Integração PubSub (se houver broadcast de atualização)
			const unsubscribePubSub = ouvirBroadcast<{ type: string; wars?: Guerra[] }>((m) => {
				if (m.type === 'war.board' && Array.isArray(m.wars)) {
					set(m.wars.map(normalizarGuerra));
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
