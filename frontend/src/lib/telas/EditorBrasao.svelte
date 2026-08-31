<script lang="ts">
	import { catalog, assetsByLayer } from '$lib/catalog';
	import Brasao from '$lib/ui/Brasao.svelte';
	import { carregarPosses, type EmblemLayers, type Asset, type Guilda } from '$lib/api';
	import { onMount } from 'svelte';

	let { guilda, aoSalvar }: { guilda: Guilda; aoSalvar: () => void } = $props();

	let abaAtiva = $state<keyof typeof $assetsByLayer>('shape');
	let rascunho = $state<Partial<EmblemLayers>>({ ...guilda.emblem_preset ? JSON.parse(guilda.emblem_preset) : {} });
	let posses = $state<Set<string>>(new Set());
	let nivelGuilda = $state(guilda.level);
	let ocupado = $state(false);

	async function carregarDados() {
		try {
			const res = await carregarPosses(guilda.id);
			posses = new Set(res.assets);
			nivelGuilda = res.level;
		} catch (e) {
			console.error('Erro ao carregar posses:', e);
		}
	}

	onMount(carregarDados);

	const categorias: { id: keyof typeof $assetsByLayer; rotulo: string }[] = [
		{ id: 'shape', rotulo: 'Escudo' },
		{ id: 'background', rotulo: 'Fundo' },
		{ id: 'palette', rotulo: 'Cores' },
		{ id: 'border', rotulo: 'Borda' },
		{ id: 'symbol', rotulo: 'Símbolo' },
		{ id: 'effect', rotulo: 'Efeito' }
	];

	function selecionar(asset: Asset) {
		rascunho[asset.layer] = asset.id;
	}

	function estaBloqueado(asset: Asset) {
		if (asset.tier === 'free') return false;
		if (asset.tier === 'level') return nivelGuilda < (asset.unlock_level || 0);
		if (asset.tier === 'paid') return !posses.has(asset.id);
		return false;
	}
</script>

<div class="editor">
	<div class="preview">
		<Brasao layers={rascunho} tag={guilda.tag} tamanho={160} />
		<div class="info">
			<h3>{guilda.name}</h3>
			<p>Personalize a identidade da sua guilda</p>
		</div>
	</div>

	<nav class="abas">
		{#each categorias as cat}
			<button class:ativa={abaAtiva === cat.id} onclick={() => (abaAtiva = cat.id)}>
				{cat.rotulo}
			</button>
		{/each}
	</nav>

	<div class="grade">
		{#each $assetsByLayer[abaAtiva] as asset}
			{@const bloqueado = estaBloqueado(asset)}
			<button
				class="asset"
				class:selecionado={rascunho[abaAtiva] === asset.id}
				class:bloqueado
				onclick={() => !bloqueado && selecionar(asset)}
			>
				<div class="visual">
					<!-- Aqui poderíamos ter um mini-preview do asset individual -->
					<span class="id">{asset.id.split('.')[1]}</span>
				</div>
				{#if bloqueado}
					<div class="trava">
						{#if asset.tier === 'level'}
							<span class="nv">Nv {asset.unlock_level}</span>
						{:else if asset.tier === 'paid'}
							<span class="preco">{asset.price_bits} Bits</span>
						{/if}
					</div>
				{/if}
			</button>
		{/each}
	</div>

	<div class="acoes">
		<button class="salvar" disabled={ocupado} onclick={aoSalvar}> Salvar Alterações </button>
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--sable);
	}

	.preview {
		display: flex;
		align-items: center;
		padding: 20px;
		gap: 20px;
		background: linear-gradient(to bottom, var(--sable-2), var(--sable));
		border-bottom: 1px solid var(--borda);
	}

	.info h3 {
		margin: 0;
		font-family: var(--display);
		color: var(--or);
	}

	.info p {
		margin: 4px 0 0;
		font-size: 12px;
		color: var(--argent-fraco);
	}

	.abas {
		display: flex;
		overflow-x: auto;
		background: var(--sable-2);
		border-bottom: 1px solid var(--borda);
	}

	.abas button {
		flex: 1;
		padding: 12px 8px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border: none;
		border-bottom: 2px solid transparent;
		background: none;
		color: var(--argent-fraco);
	}

	.abas button.ativa {
		color: var(--or);
		border-bottom-color: var(--or);
		background: rgba(212, 175, 55, 0.05);
	}

	.grade {
		flex: 1;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		padding: 12px;
		overflow-y: auto;
	}

	.asset {
		aspect-ratio: 1;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4px;
		cursor: pointer;
	}

	.asset.selecionado {
		border-color: var(--or);
		background: rgba(212, 175, 55, 0.1);
	}

	.asset.bloqueado {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.visual .id {
		font-size: 10px;
		text-transform: capitalize;
		color: var(--argent);
	}

	.trava {
		position: absolute;
		bottom: 4px;
		right: 4px;
		background: rgba(0, 0, 0, 0.8);
		padding: 2px 4px;
		border-radius: 2px;
		font-size: 9px;
	}

	.nv {
		color: var(--or);
	}

	.preco {
		color: var(--vert);
	}

	.acoes {
		padding: 16px;
		border-top: 1px solid var(--borda);
	}

	.salvar {
		width: 100%;
		padding: 12px;
		background: var(--or);
		color: var(--sable);
		font-weight: bold;
		border: none;
		border-radius: 2px;
	}

	.salvar:disabled {
		opacity: 0.5;
	}
</style>
