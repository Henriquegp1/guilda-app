<script lang="ts">
	import { carregarConquistas, type Achievement, type AchievementProgress } from '$lib/api';
	import { onMount } from 'svelte';
	import { entrarBloco } from '$lib/motion';

	let { guildaId, aoVoltar }: { guildaId: number; aoVoltar: () => void } = $props();

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let conquistas = $state<Achievement[]>([]);
	let progresso = $state<AchievementProgress[]>([]);
	let filtro = $state<'todas' | 'permanente' | 'seasonal'>('todas');

	async function carregar() {
		try {
			const res = await carregarConquistas(guildaId);
			conquistas = res.unlocked;
			progresso = res.progress;
			estado = 'pronto';
		} catch (e) {
			console.error(e);
			estado = 'erro';
		}
	}

	onMount(carregar);

	const filtradas = $derived(
		conquistas.filter((a) => filtro === 'todas' || a.scope === filtro)
	);

	const raras = (rarity: string) => {
		const cores: Record<string, string> = {
			common: 'var(--argent-fraco)',
			rare: '#3498db',
			epic: '#9b59b6',
			legendary: 'var(--or)'
		};
		return cores[rarity] || cores.common;
	};
</script>

<div class="conquistas-tela" in:entrarBloco>
	<header>
		<button class="voltar" onclick={aoVoltar}>← Voltar</button>
		<h2>Galeria de Glória</h2>
	</header>

	<nav class="filtros">
		<button class:ativo={filtro === 'todas'} onclick={() => (filtro = 'todas')}>Todas</button>
		<button class:ativo={filtro === 'permanente'} onclick={() => (filtro = 'permanente')}>Permanentes</button>
		<button class:ativo={filtro === 'seasonal'} onclick={() => (filtro = 'seasonal')}>Sazonais</button>
	</nav>

	{#if estado === 'carregando'}
		<p class="centro">Carregando medalhas...</p>
	{:else if estado === 'erro'}
		<p class="centro erro">Falha ao carregar conquistas.</p>
	{:else}
		<section class="secao">
			<h3>Desbloqueadas <span class="num">{filtradas.length}</span></h3>
			<div class="grade">
				{#each filtradas as a}
					<div class="achievement" style:--cor-raridade={raras(a.rarity)}>
						<div class="medalha">
							<span class="ícone">🏅</span>
						</div>
						<div class="meta">
							<b>{a.name}</b>
							<small>{a.description}</small>
							{#if a.season_number}
								<span class="temporada-selo">T{a.season_number}</span>
							{/if}
						</div>
					</div>
				{/each}
			</div>
		</section>

		{#if progresso.length > 0 && filtro === 'todas'}
			<section class="secao">
				<h3>Em Andamento</h3>
				<div class="lista-progresso">
					{#each progresso as p}
						<div class="item-progresso">
							<div class="topo-prog">
								<span>{p.code}</span>
								<span class="num">{p.current} / {p.target}</span>
							</div>
							<div class="barra-trilho">
								<div class="barra-preenche" style:width="{(p.current / p.target) * 100}%"></div>
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.conquistas-tela {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--sable);
	}

	header {
		display: flex;
		align-items: center;
		padding: 12px;
		background: var(--sable-2);
		border-bottom: 1px solid var(--borda);
	}

	.voltar { background: none; border: none; color: var(--or); cursor: pointer; }
	h2 { margin: 0; flex: 1; text-align: center; font-size: 14px; text-transform: uppercase; letter-spacing: 0.1em; padding-right: 40px; }

	.filtros {
		display: flex;
		gap: 4px;
		padding: 8px;
		background: var(--sable-2);
	}

	.filtros button {
		flex: 1;
		background: none;
		border: 1px solid var(--borda);
		color: var(--argent-fraco);
		padding: 6px;
		font-size: 10px;
		text-transform: uppercase;
	}

	.filtros button.ativo {
		border-color: var(--or);
		color: var(--or);
		background: rgba(212, 175, 55, 0.05);
	}

	.secao {
		padding: 16px;
	}

	h3 {
		font-size: 12px;
		text-transform: uppercase;
		color: var(--argent-fraco);
		margin: 0 0 12px;
	}

	.num { color: var(--or); }

	.grade {
		display: grid;
		grid-template-columns: 1fr;
		gap: 12px;
	}

	.achievement {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 10px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-left: 3px solid var(--cor-raridade);
		border-radius: 2px;
	}

	.medalha {
		width: 40px;
		height: 40px;
		background: rgba(255, 255, 255, 0.05);
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 20px;
	}

	.meta { flex: 1; display: flex; flex-direction: column; }
	.meta b { font-size: 14px; color: var(--argent); }
	.meta small { font-size: 11px; color: var(--argent-fraco); }

	.temporada-selo {
		position: absolute;
		top: 4px;
		right: 4px;
		font-size: 9px;
		background: var(--or);
		color: var(--sable);
		padding: 1px 3px;
		font-weight: bold;
		border-radius: 2px;
	}

	.lista-progresso {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.item-progresso {
		background: var(--sable-2);
		padding: 10px;
		border: 1px solid var(--borda);
	}

	.topo-prog {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		margin-bottom: 6px;
		text-transform: uppercase;
	}

	.barra-trilho {
		height: 4px;
		background: var(--sable);
		border-radius: 2px;
		overflow: hidden;
	}

	.barra-preenche {
		height: 100%;
		background: var(--or);
	}

	.centro { padding: 40px; text-align: center; color: var(--argent-fraco); }
	.erro { color: var(--gules); }
</style>
