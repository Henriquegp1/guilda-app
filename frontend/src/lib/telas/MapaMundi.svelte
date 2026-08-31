<script lang="ts">
	import { listarTerritorios, type Territory } from '$lib/api';
	import { onMount } from 'svelte';
	import Brasao from '$lib/ui/Brasao.svelte';

	let territories = $state<Territory[]>([]);
	let loading = $state(true);
	let selectedId = $state<number | null>(null);

	async function load() {
		try {
			const res = await listarTerritorios();
			territories = res.items.filter((t) => t.enabled);
		} catch (e) {
			console.error('Erro ao carregar mapa:', e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const selected = $derived(territories.find((t) => t.id === selectedId) || null);

	function formatarProtecao(iso: string | null) {
		if (!iso) return null;
		const resto = +new Date(iso) - Date.now();
		if (resto <= 0) return null;
		const hrs = Math.floor(resto / 3600000);
		const mins = Math.floor((resto % 3600000) / 60000);
		return `${hrs}h ${mins}m`;
	}
</script>

<div class="mapa-container">
	{#if loading}
		<p class="centro">Carregando Mapa...</p>
	{:else}
		<div class="viewport">
			<svg viewBox="0 0 1000 1000" class="mapa-svg">
				<!-- Fundo do Mapa (pode ser uma imagem ou padrão) -->
				<rect width="1000" height="1000" fill="var(--sable-2)" />
				<pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
					<path d="M 100 0 L 0 0 0 100" fill="none" stroke="rgba(255,255,255,0.03)" stroke-width="1" />
				</pattern>
				<rect width="1000" height="1000" fill="url(#grid)" />

				{#each territories as t (t.id)}
					{@const protegido = !!formatarProtecao(t.protected_until)}
					<g
						class="ponto"
						class:selecionado={selectedId === t.id}
						onclick={() => (selectedId = t.id)}
						transform="translate({t.map_x}, {t.map_y})"
					>
						<!-- Aura de Proteção -->
						{#if protegido}
							<circle r="40" fill="none" stroke="var(--vert)" stroke-width="2" stroke-dasharray="4 4" opacity="0.6">
								<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="10s" repeatCount="indefinite" />
							</circle>
						{/if}

						<!-- Base do ponto -->
						<circle r="15" fill={t.owner_guild_id ? 'var(--or)' : 'var(--argent-fraco)'} opacity="0.8" />

						<!-- Símbolo do Dono -->
						{#if t.owner_tag}
							<text y="5" text-anchor="middle" class="tag-mapa">{t.owner_tag}</text>
						{/if}

						<text y="35" text-anchor="middle" class="nome-mapa">{t.name}</text>
					</g>
				{/each}
			</svg>
		</div>

		{#if selected}
			<div class="detalhes">
				<header>
					<div class="brasao-mini">
						<Brasao tag={selected.owner_tag || ''} tamanho={48} />
					</div>
					<div class="meta">
						<h4>{selected.name}</h4>
						<p class="status">
							{#if selected.owner_guild_id}
								Dominado por <b>{selected.owner_name}</b>
							{:else}
								Território Neutro
							{/if}
						</p>
					</div>
				</header>

				<div class="stats">
					<div class="stat">
						<span>Rendimento</span>
						<b class="ouro">+{selected.prestige_per_day} Prestígio / dia</b>
					</div>
					{#if formatarProtecao(selected.protected_until)}
						<div class="stat">
							<span>Proteção</span>
							<b class="verde">{formatarProtecao(selected.protected_until)}</b>
						</div>
					{/if}
				</div>

				{#if !selected.owner_guild_id}
					<button class="disputar">Entrar na Disputa</button>
				{/if}
			</div>
		{:else}
			<div class="ajuda-mapa">
				<p>Selecione um território no mapa para ver detalhes e rendimentos.</p>
			</div>
		{/if}
	{/if}
</div>

<style>
	.mapa-container {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--sable);
	}

	.viewport {
		flex: 1;
		background: #000;
		position: relative;
		overflow: hidden;
		border-bottom: 1px solid var(--borda);
	}

	.mapa-svg {
		width: 100%;
		height: 100%;
		cursor: grab;
	}

	.ponto {
		cursor: pointer;
		transition: transform 0.2s;
	}

	.ponto:hover {
		transform: scale(1.1) translate(var(--tw-translate-x), var(--tw-translate-y));
	}

	.tag-mapa {
		fill: var(--sable);
		font-size: 10px;
		font-weight: bold;
		font-family: var(--display);
	}

	.nome-mapa {
		fill: var(--argent);
		font-size: 14px;
		font-family: var(--display);
		text-shadow: 0 2px 4px #000;
	}

	.selecionado circle {
		stroke: var(--or);
		stroke-width: 4px;
	}

	.detalhes {
		padding: 16px;
		background: var(--sable-2);
		border-top: 1px solid var(--borda);
	}

	header {
		display: flex;
		gap: 12px;
		align-items: center;
		margin-bottom: 12px;
	}

	h4 { margin: 0; font-family: var(--display); color: var(--or); }
	.status { margin: 0; font-size: 12px; color: var(--argent-fraco); }

	.stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
		margin-bottom: 16px;
	}

	.stat span { display: block; font-size: 10px; text-transform: uppercase; color: var(--argent-fraco); }
	.stat b { font-size: 13px; }

	.ouro { color: var(--or); }
	.verde { color: var(--vert); }

	.disputar {
		width: 100%;
		padding: 10px;
		background: var(--or);
		color: var(--sable);
		border: none;
		font-weight: bold;
		border-radius: 2px;
		cursor: pointer;
	}

	.ajuda-mapa {
		padding: 24px;
		text-align: center;
		color: var(--argent-fraco);
		font-size: 12px;
		font-style: italic;
	}

	.centro {
		padding: 40px;
		text-align: center;
		color: var(--argent-fraco);
	}
</style>
