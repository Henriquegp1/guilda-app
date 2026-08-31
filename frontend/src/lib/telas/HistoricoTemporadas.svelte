<script lang="ts">
	import { listarTemporadas, buscarPodio, type Temporada } from '$lib/api';
	import { onMount } from 'svelte';
	import { entrarBloco } from '$lib/motion';

	let { aoVoltar }: { aoVoltar: () => void } = $props();

	let temporadas = $state<Temporada[]>([]);
	let selecionada = $state<number | null>(null);
	let podio = $state<{ position: number; tag: string; name: string; prestige_final: number }[]>([]);
	let loading = $state(true);

	async function carregar() {
		try {
			const res = await listarTemporadas();
			temporadas = res.items.filter((s) => s.status === 'closed' || s.status === 'archived');
			if (temporadas.length > 0) verPodio(temporadas[0].id);
		} catch (e) {
			console.error(e);
		} finally {
			loading = false;
		}
	}

	async function verPodio(id: number) {
		selecionada = id;
		try {
			const res = await buscarPodio(id);
			podio = res.awards;
		} catch (e) {
			console.error(e);
		}
	}

	onMount(carregar);
</script>

<div class="historico" in:entrarBloco>
	<header>
		<button class="voltar" onclick={aoVoltar}>← Voltar</button>
		<h2>Hall da Fama</h2>
	</header>

	{#if loading}
		<p class="centro">Consultando pergaminhos...</p>
	{:else if temporadas.length === 0}
		<p class="centro">Nenhuma temporada encerrada ainda.</p>
	{:else}
		<div class="seletor">
			{#each temporadas as s}
				<button class:ativo={selecionada === s.id} onclick={() => verPodio(s.id)}>
					{s.name}
				</button>
			{/each}
		</div>

		<div class="podio-view">
			{#if podio.length > 0}
				<div class="lista-podio">
					{#each podio as a}
						<div class="linha-vencedor pos-{a.position}">
							<span class="coroa">{a.position === 1 ? '👑' : a.position === 2 ? '🥈' : '🥉'}</span>
							<div class="identidade-vencedor">
								<b class="tag">[{a.tag}]</b>
								<span class="nome-v">{a.name}</span>
							</div>
							<span class="pontos num">{a.prestige_final.toLocaleString('pt-BR')} <small>Poder</small></span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="centro">Apuração não concluída ou nenhum pódio registrado.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	.historico {
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

	.seletor {
		display: flex;
		overflow-x: auto;
		gap: 8px;
		padding: 12px;
		background: var(--sable-2);
	}

	.seletor button {
		white-space: nowrap;
		background: none;
		border: 1px solid var(--borda);
		color: var(--argent-fraco);
		padding: 6px 12px;
		font-size: 11px;
		border-radius: 20px;
	}

	.seletor button.ativo {
		border-color: var(--or);
		color: var(--or);
		background: rgba(212, 175, 55, 0.1);
	}

	.podio-view {
		flex: 1;
		padding: 20px;
	}

	.lista-podio {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.linha-vencedor {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 4px;
	}

	.pos-1 { border-color: var(--or); background: linear-gradient(135deg, rgba(212, 175, 55, 0.1), transparent); }
	.pos-2 { border-color: #bdc3c7; }
	.pos-3 { border-color: #cd7f32; }

	.coroa { font-size: 24px; }
	.identidade-vencedor { display: flex; flex-direction: column; }
	.tag { font-family: var(--display); font-size: 16px; color: var(--or); line-height: 1; }
	.nome-v { font-size: 11px; color: var(--argent-fraco); text-transform: uppercase; letter-spacing: 0.05em; }
	.pontos { margin-left: auto; color: var(--argent); font-size: 14px; text-align: right; }
	.pontos small { display: block; font-size: 9px; text-transform: uppercase; color: var(--argent-fraco); }

	.centro { padding: 40px; text-align: center; color: var(--argent-fraco); font-size: 12px; }
</style>
