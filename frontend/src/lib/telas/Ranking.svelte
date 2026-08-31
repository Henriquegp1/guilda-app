<script lang="ts">
	import Estado from '$lib/ui/Estado.svelte';
	import { reordenar, entrarBloco } from '$lib/motion';
	import HistoricoTemporadas from './HistoricoTemporadas.svelte';
	import {
		ranking,
		temporadaAtual,
		posicaoDa,
		ErroApi,
		type LinhaRanking,
		type Temporada
	} from '$lib/api';

	let { minhaGuildaId = null }: { minhaGuildaId?: number | null } = $props();

	let estado = $state<'carregando' | 'pronto' | 'vazio' | 'erro'>('carregando');
	let linhas = $state<LinhaRanking[]>([]);
	let temporada = $state<Temporada | null>(null);
	let meuRank = $state<{ position: number | null; prestige: number; delta_position: number | null } | null>(null);
	let erro = $state('');
	let lista = $state<HTMLOListElement>();
	let vendoHistorico = $state(false);

	async function carregar(cursor?: string) {
		try {
			const [r, t, m] = await Promise.all([
				ranking(cursor),
				temporada ? Promise.resolve(temporada) : temporadaAtual().catch(() => null),
				minhaGuildaId ? posicaoDa(minhaGuildaId).catch(() => null) : Promise.resolve(null)
			]);
			temporada = t;
			meuRank = m;

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

	const estaNaLista = $derived(linhas.some((l) => l.guild_id === minhaGuildaId));
</script>

<div class="ranking-wrapper" in:entrarBloco>
	<header class="ranking-header">
		{#if temporada}
			<div class="meta-temporada">
				<p class="temporada">
					{temporada.name}
					{#if diasRestantes !== null}
						<span class="restam">· {diasRestantes} {diasRestantes === 1 ? 'dia' : 'dias'}</span>
					{/if}
					{#if temporada.status === 'freezing'}
						<span class="freezing">· Apuração em andamento</span>
					{/if}
				</p>
			</div>
		{/if}
		<button
			class="btn-hist"
			data-testid="botao-historico"
			onclick={() => (vendoHistorico = true)}>📜 Histórico</button
		>
	</header>

	{#if vendoHistorico}
		<HistoricoTemporadas aoVoltar={() => (vendoHistorico = false)} />
	{:else if estado === 'carregando'}
		<div class="centro-ranking"><Estado estado="carregando" /></div>
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={() => carregar()} />
	{:else if estado === 'vazio'}
		<p class="vazio-msg">
			Nenhuma guilda pontuou nesta temporada ainda. A primeira vitória abre o ranking.
		</p>
	{:else}
		<ol bind:this={lista}>
			{#each linhas as l (l.guild_id)}
				<li class:minha={l.guild_id === minhaGuildaId} class:podio={l.position <= 3}>
					<span class="pos num">
						{#if l.position === 1}🥇{:else if l.position === 2}🥈{:else if l.position === 3}🥉{:else}{l.position}{/if}
					</span>
					<span class="nome">
						<b>{l.name}</b>
						<small>[{l.tag}] · Nv.{l.level}</small>
						{#if l.delta_position}
							<small class="delta" class:sobe={l.delta_position > 0}>
								{l.delta_position > 0 ? '▲' : '▼'} {Math.abs(l.delta_position)}
							</small>
						{/if}
					</span>
					<span class="pontos num">{l.prestige.toLocaleString('pt-BR')}</span>
				</li>
			{/each}
		</ol>

		{#if minhaGuildaId && meuRank && !estaNaLista}
			<div class="meu-card-fixo" in:entrarBloco>
				<span class="pos num">{meuRank.position}º</span>
				<span class="nome">
					<b>Sua Guilda</b>
					{#if meuRank.delta_position}
						<small class="delta" class:sobe={meuRank.delta_position > 0}>
							{meuRank.delta_position > 0 ? '▲' : '▼'} {Math.abs(meuRank.delta_position)}
						</small>
					{/if}
				</span>
				<span class="pontos num">{meuRank.prestige.toLocaleString('pt-BR')}</span>
			</div>
		{/if}
	{/if}
</div>

<style>
	.temporada {
		margin: 0 0 8px;
		font-family: var(--display);
		font-size: 12px;
		color: var(--or);
	}

	.ranking-wrapper {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.centro-ranking {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.vazio-msg {
		flex: 1;
		padding: 40px 20px;
		text-align: center;
		color: var(--argent-fraco);
		font-size: 13px;
	}

	.ranking-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 8px;
	}

	.btn-hist {
		background: none;
		border: 1px solid var(--borda);
		color: var(--or);
		font-size: 10px;
		padding: 4px 8px;
		text-transform: uppercase;
		cursor: pointer;
		white-space: nowrap;
	}

	.temporada {
		margin: 0;
		font-family: var(--display);
		font-size: 12px;
		color: var(--or);
	}

	.freezing {
		color: var(--or);
		font-weight: bold;
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
		min-width: 24px;
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

	.meu-card-fixo {
		margin-top: auto;
		padding: 12px;
		background: var(--sable-2);
		border-top: 2px solid var(--or);
		display: grid;
		grid-template-columns: 32px 1fr auto;
		align-items: center;
		gap: 8px;
		box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.5);
	}

	.delta {
		margin-left: 6px;
		font-weight: bold;
		font-family: var(--texto);
		font-size: 10px;
	}
	.delta.sobe {
		color: var(--vert);
	}
	.delta:not(.sobe) {
		color: var(--gules);
	}
</style>
