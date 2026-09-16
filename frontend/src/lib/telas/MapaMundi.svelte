<script lang="ts">
	import { listarTerritorios, entrarDisputa, obterMapConfig, buscarDisputa, type Territory, type DisputeEntry } from '$lib/api';
	import { onMount } from 'svelte';
	import Brasao from '$lib/ui/Brasao.svelte';
	import { entrarBloco } from '$lib/motion';

	let territories = $state<Territory[]>([]);
	let mapBgUrl = $state<string | null>(null);
	let loading = $state(true);
	let erroCarregar = $state('');
	let selectedId = $state<number | null>(null);
	let ocupado = $state(false);
	let mensagem = $state('');
	let disputaEntries = $state<DisputeEntry[]>([]);
	let disputaCarregando = $state(false);
	let disputaErro = $state('');

	async function load() {
		erroCarregar = '';
		try {
			const [res, cfg] = await Promise.all([
				listarTerritorios(),
				obterMapConfig().catch(() => ({ background_url: null }))
			]);
			territories = res.items.filter((t) => t.enabled);
			mapBgUrl = cfg.background_url;
		} catch (e) {
			erroCarregar = 'Não foi possível carregar os territórios do mapa.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	const selected = $derived(territories.find((t) => t.id === selectedId) || null);

	// A disputa é uma corrida de pontos entre guildas (territory_dispute_entry),
	// mas até aqui a tela só mostrava "tem disputa, entrar?" sem dizer quem já
	// está nela nem quem está na frente. GET /disputes/:id já devolve isso
	// pronto (ordenado por pontos), só nunca era chamado.
	async function carregarDisputa(disputeId: number) {
		disputaCarregando = true;
		disputaErro = '';
		try {
			const r = await buscarDisputa(disputeId);
			disputaEntries = r.entries;
		} catch (e: any) {
			disputaEntries = [];
			disputaErro = e.message || 'Não foi possível carregar os participantes da disputa.';
		} finally {
			disputaCarregando = false;
		}
	}

	$effect(() => {
		const id = selected?.active_dispute_id;
		if (id) {
			carregarDisputa(id);
		} else {
			disputaEntries = [];
			disputaErro = '';
		}
	});

	async function participarDisputa(id: number) {
		ocupado = true;
		mensagem = '';
		try {
			await entrarDisputa(id);
			mensagem = 'Inscrito na disputa com sucesso!';
			await Promise.all([load(), carregarDisputa(id)]);
		} catch (e: any) {
			mensagem = e.message || 'Falha ao entrar na disputa.';
		} finally {
			ocupado = false;
		}
	}

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
	{:else if erroCarregar}
		<div class="centro erro-mapa">
			<p>{erroCarregar}</p>
			<button class="tentar-novo" onclick={load}>Tentar de novo</button>
		</div>
	{:else}
		<div class="viewport">
			<svg viewBox="0 0 1000 1000" class="mapa-svg">
				<defs>
					<radialGradient id="grad-mapa" cx="50%" cy="50%" r="50%">
						<stop offset="0%" stop-color="#1a1422" />
						<stop offset="100%" stop-color="#0e0b13" />
					</radialGradient>
				</defs>
				<!-- Fundo do Mapa com gradiente radial -->
				<rect width="1000" height="1000" fill="url(#grad-mapa)" />

				{#if mapBgUrl}
					<!-- Imagem de Fundo Personalizada pelo Streamer -->
					<image
						href={mapBgUrl}
						x="0"
						y="0"
						width="1000"
						height="1000"
						preserveAspectRatio="xMidYMid slice"
						opacity="0.85"
					/>
				{/if}

				<pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
					<path d="M 100 0 L 0 0 0 100" fill="none" stroke="var(--or)" stroke-width="0.5" opacity="0.1" />
				</pattern>
				<rect width="1000" height="1000" fill="url(#grid)" />

				{#each territories as t (t.id)}
					{@const protegido = !!formatarProtecao(t.protected_until)}
					{@const emDisputa = !!t.active_dispute_id}
					<g
						class="ponto"
						class:selecionado={selectedId === t.id}
						class:disputa={emDisputa}
						onclick={() => (selectedId = t.id)}
						transform="translate({t.map_x}, {t.map_y})"
					>
						<g class="ponto-corpo">
							<!-- Hit Area Invisível para Touch/Mouse -->
							<circle r="60" fill="transparent" />

							<!-- Aura de Proteção -->
							{#if protegido}
								<circle r="45" fill="none" stroke="var(--vert)" stroke-width="3" stroke-dasharray="6 6" opacity="0.8">
									<animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="10s" repeatCount="indefinite" />
								</circle>
							{/if}

							<!-- Ícone de Disputa (Espadas) -->
							{#if emDisputa}
								<text y="-35" text-anchor="middle" font-size="28">⚔️</text>
							{/if}

							<!-- Base do ponto -->
							<circle class="circulo-ponto" r="28" fill={t.owner_guild_id ? 'var(--or)' : 'var(--argent-fraco)'} opacity="0.9" />

							<!-- Símbolo do Dono -->
							{#if t.owner_tag}
								<text y="7" text-anchor="middle" class="tag-mapa">{t.owner_tag}</text>
							{/if}

							<text y="60" text-anchor="middle" class="nome-mapa">{t.name}</text>
						</g>
					</g>
				{/each}
			</svg>
		</div>

		{#if selected}
			<div class="detalhes" in:entrarBloco>
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
					{:else if selected.active_dispute_id}
						<div class="stat">
							<span>Disputa Aberta</span>
							<b class="ouro">Fecha em {formatarProtecao(selected.dispute_closes_at)}</b>
						</div>
					{/if}
				</div>

				{#if selected.active_dispute_id}
					<button
						class="disputar"
						disabled={ocupado}
						onclick={() => participarDisputa(selected.active_dispute_id!)}
					>
						{ocupado ? 'Processando...' : 'Entrar na Disputa'}
					</button>

					<div class="disputa-participantes">
						{#if disputaCarregando}
							<p class="disputa-status">Carregando participantes...</p>
						{:else if disputaErro}
							<p class="disputa-status erro">{disputaErro}</p>
						{:else if disputaEntries.length > 0}
							<strong>Guildas na disputa</strong>
							{#each disputaEntries as d, i (d.guild_id)}
								<div class="disputa-linha" class:lider={i === 0}>
									<span class="disputa-pos">{i + 1}º</span>
									<span class="disputa-nome">{d.name} <small>[{d.tag}]</small></span>
									<span class="disputa-pontos num">{d.points.toLocaleString('pt-BR')}</span>
								</div>
							{/each}
						{:else}
							<p class="disputa-status">Ninguém entrou na disputa ainda.</p>
						{/if}
					</div>
				{/if}

				{#if mensagem}<p class="aviso-mapa" class:sucesso={mensagem.includes('sucesso')}>{mensagem}</p>{/if}
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
	}

	.ponto {
		cursor: pointer;
	}

	.ponto-corpo {
		transition: transform 0.2s ease-out;
		transform-origin: 0px 0px;
	}

	.ponto:hover .ponto-corpo {
		transform: scale(1.18);
	}

	.tag-mapa {
		fill: var(--sable);
		font-size: 16px;
		font-weight: bold;
		font-family: var(--display);
		pointer-events: none;
	}

	.nome-mapa {
		fill: var(--argent);
		font-size: 24px;
		font-weight: bold;
		font-family: var(--display);
		text-shadow: 0 2px 6px #000;
		pointer-events: none;
	}

	.selecionado .circulo-ponto {
		stroke: var(--or);
		stroke-width: 5px;
		filter: drop-shadow(0 0 8px var(--or));
	}

	.ponto.disputa .circulo-ponto {
		stroke: var(--gules);
		stroke-width: 3px;
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

	.aviso-mapa {
		margin-top: 10px;
		font-size: 11px;
		text-align: center;
		color: var(--gules);
	}

	.aviso-mapa.sucesso {
		color: var(--vert);
	}

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

	.disputa-participantes {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--borda);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.disputa-participantes strong {
		font-size: 10px;
		text-transform: uppercase;
		color: var(--argent-fraco);
		letter-spacing: 0.05em;
	}

	.disputa-status { margin: 0; font-size: 11px; color: var(--argent-fraco); font-style: italic; }
	.disputa-status.erro { color: var(--gules); font-style: normal; }

	.disputa-linha {
		display: grid;
		grid-template-columns: 24px 1fr auto;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		color: var(--argent);
	}

	.disputa-linha.lider { color: var(--or); font-weight: bold; }
	.disputa-linha small { color: var(--argent-fraco); font-weight: normal; }
	.disputa-pos { color: var(--argent-fraco); }
	.disputa-pontos { color: var(--or); }

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

	.erro-mapa {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}

	.erro-mapa p {
		color: var(--gules);
		margin: 0;
	}

	.tentar-novo {
		background: none;
		border: 1px solid var(--or);
		color: var(--or);
		padding: 6px 16px;
		font-size: 11px;
		text-transform: uppercase;
		border-radius: 2px;
		cursor: pointer;
	}
</style>