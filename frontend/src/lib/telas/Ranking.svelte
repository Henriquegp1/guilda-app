<script lang="ts">
	import Estado from '$lib/ui/Estado.svelte';
	import { ranking, temporadaAtual, ErroApi, type LinhaRanking, type Temporada } from '$lib/api';
	import { reordenar } from '$lib/motion';

	let { minhaGuildaId = null }: { minhaGuildaId?: number | null } = $props();

	let estado = $state<'carregando' | 'pronto' | 'vazio' | 'erro'>('carregando');
	let linhas = $state<LinhaRanking[]>([]);
	let temporada = $state<Temporada | null>(null);
	let erro = $state('');
	let lista: HTMLOListElement;

	async function carregar(cursor?: string) {
		try {
			const [r, t] = await Promise.all([
				ranking(cursor),
				temporada ? Promise.resolve(temporada) : temporadaAtual().catch(() => null)
			]);
			temporada = t;

			// Flip anima a reordenação: entre dois snapshots as guildas trocam de
			// posição, e sem isso a lista pisca (docs/MOVIMENTO.md).
			if (linhas.length && lista) {
				reordenar([...lista.children], () => {
					linhas = r.items;
				});
			} else {
				linhas = r.items;
			}
			estado = r.items.length ? 'pronto' : 'vazio';
		} catch (e) {
			// Cursor expirado não é culpa do viewer: recomeça sozinho.
			if (e instanceof ErroApi && e.code === 'CURSOR_EXPIRED') return carregar();
			erro = e instanceof ErroApi ? e.message : 'Não foi possível carregar o ranking.';
			estado = 'erro';
		}
	}

	$effect(() => {
		carregar();
	});

	const diasRestantes = $derived(
		temporada
			? Math.max(0, Math.ceil((+new Date(temporada.ends_at) - Date.now()) / 86_400_000))
			: null
	);
</script>

{#if estado === 'carregando'}
	<Estado estado="carregando" />
{:else if estado === 'erro'}
	<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={() => carregar()} />
{:else if estado === 'vazio'}
	<Estado
		estado="vazio"
		mensagem="Nenhuma guilda pontuou nesta temporada ainda. A primeira vitória abre o ranking."
	/>
{:else}
	{#if temporada}
		<p class="temporada">
			{temporada.name}
			{#if diasRestantes !== null}
				<span class="restam">· {diasRestantes} {diasRestantes === 1 ? 'dia' : 'dias'}</span>
			{/if}
		</p>
	{/if}

	<ol bind:this={lista}>
		{#each linhas as l (l.guild_id)}
			<li class:minha={l.guild_id === minhaGuildaId} class:podio={l.position <= 3}>
				<span class="pos num">{l.position}</span>
				<span class="nome">
					<b>{l.name}</b>
					<small>[{l.tag}] · Nv.{l.level}</small>
				</span>
				<span class="pontos num">{l.prestige.toLocaleString('pt-BR')}</span>
			</li>
		{/each}
	</ol>
{/if}

<style>
	.temporada {
		margin: 0 0 8px;
		font-family: var(--display);
		font-size: 12px;
		color: var(--or);
	}

	.restam {
		color: var(--argent-fraco);
		font-family: var(--texto);
	}

	ol {
		list-style: none;
		margin: 0;
		padding: 0;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: 6px;
		/* Diz "tem mais abaixo" em vez de parecer corte. */
		mask-image: linear-gradient(180deg, #000 calc(100% - 20px), transparent);
	}

	li {
		display: grid;
		grid-template-columns: 22px 1fr auto;
		align-items: center;
		gap: 8px;
		padding: 7px 6px 7px 0;
		border-bottom: 1px solid var(--borda);
	}

	.pos {
		color: var(--argent-fraco);
		font-size: 12px;
		text-align: right;
	}

	.podio .pos {
		color: var(--or);
		font-weight: 600;
	}

	.nome {
		min-width: 0;
	}

	.nome b {
		display: block;
		font-family: var(--display);
		font-size: 14px;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nome small {
		color: var(--argent-fraco);
		font-size: 10px;
	}

	.pontos {
		font-size: 14px;
		color: var(--or);
	}

	.minha {
		background: linear-gradient(90deg, rgba(200, 160, 46, 0.1), transparent);
		box-shadow: inset 2px 0 0 var(--or);
		padding-left: 6px;
	}
</style>
