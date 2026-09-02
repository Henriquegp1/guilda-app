<script lang="ts">
	import { catalog, assetsByLayer } from '$lib/catalog';
	import Brasao from '$lib/ui/Brasao.svelte';
	import TrocarNome from './TrocarNome.svelte';
	import { gastarBits } from '$lib/twitch';
	import {
		carregarPosses,
		type EmblemLayers,
		type Asset,
		type Guilda,
		comprarAsset,
		salvarEmblema,
		salvarImagemCustomizada
	} from '$lib/api';
	import { onMount } from 'svelte';
	import Creditos from '$lib/ui/Creditos.svelte';

	let { guilda, aoSalvar }: { guilda: Guilda; aoSalvar: () => void } = $props();

	// Fallbacks locais para inicialização imediata (Fase Estabilidade)
	const PADRAO: EmblemLayers = {
		v: 1,
		catalog_version: 3,
		shape: 'shape.heater',
		background: 'bg.solid',
		palette: 'palette.slate',
		border: 'border.none',
		symbol: 'symbol.blank',
		effect: 'effect.none'
	};

	let abaAtiva = $state<'shape' | 'background' | 'palette' | 'border' | 'symbol' | 'effect' | 'name' | 'tag' | 'custom'>('shape');
	let rascunho = $state<EmblemLayers>({ ...PADRAO });
	let customUrlInput = $state('');
	let posses = $state<Set<string>>(new Set());
	let nivelGuilda = $state(0);
	let ocupado = $state(false);
	let erro = $state('');

	async function carregarDados() {
		if (!guilda?.id) return;
		try {
			const res = await carregarPosses(guilda.id);
			posses = new Set(res.assets);
			nivelGuilda = res.level;
		} catch (e) {
			console.error('Erro ao carregar posses:', e);
		}
	}

	onMount(async () => {
		if (!guilda) return;
		if (guilda.emblem_preset) {
			try {
				const salvo = JSON.parse(guilda.emblem_preset);
				rascunho = { ...rascunho, ...salvo };
			} catch(e) {}
		}
		await carregarDados();
	});

	async function salvar() {
		ocupado = true;
		erro = '';
		try {
			if (abaAtiva === 'custom') {
				if (!customUrlInput) throw new Error('URL necessária');
				await salvarImagemCustomizada(guilda.id, 1, customUrlInput);
			} else {
				await salvarEmblema(guilda.id, 1, rascunho);
			}
			aoSalvar();
		} catch (e) {
			erro = e instanceof Error ? e.message : 'Falha ao salvar';
		} finally {
			ocupado = false;
		}
	}

	const categorias: { id: typeof abaAtiva; rotulo: string }[] = [
		{ id: 'shape', rotulo: 'Escudo' },
		{ id: 'background', rotulo: 'Fundo' },
		{ id: 'palette', rotulo: 'Cores' },
		{ id: 'border', rotulo: 'Borda' },
		{ id: 'symbol', rotulo: 'Símbolo' },
		{ id: 'effect', rotulo: 'Efeito' },
		{ id: 'custom', rotulo: 'Custom' },
		{ id: 'name', rotulo: 'Nome' },
		{ id: 'tag', rotulo: 'TAG' }
	];

	function selecionar(asset: Asset) {
		if (asset.tier === 'paid' && !posses.has(asset.id)) {
			comprar(asset);
			return;
		}
		rascunho[asset.layer] = (rascunho[asset.layer] as string) === asset.id ? '' : asset.id;
	}

	async function comprar(asset: Asset) {
		ocupado = true;
		try {
			const receipt = await gastarBits(`asset.${asset.id}`);
			await comprarAsset(guilda.id, { asset_id: asset.id, transaction_receipt: receipt });
			await carregarDados();
			rascunho[asset.layer] = asset.id;
		} catch (e) {
			erro = 'Falha na compra';
		} finally {
			ocupado = false;
		}
	}

	const SHAPE_PATHS: Record<string, string> = {
		'shape.heater': 'M8 6 H88 V44 C88 74 68 88 48 98 C28 88 8 74 8 44 Z',
		'shape.round': 'M48 6 C24 6 8 26 8 52 C8 78 24 98 48 98 C72 98 88 78 88 52 C88 26 72 6 48 6 Z',
		'shape.square': 'M8 6 H88 V90 H8 Z',
		'shape.pointed': 'M8 6 H88 V60 L48 98 L8 60 Z',
		'shape.kite': 'M48 6 L88 44 L48 98 L8 44 Z',
		'shape.lozenge': 'M48 8 L88 52 L48 96 L8 52 Z',
		'shape.banner': 'M8 6 H88 V82 L48 98 L8 82 Z'
	};

	const estaBloqueado = (asset: Asset) => {
		if (asset.tier === 'level') return nivelGuilda < (asset.unlock_level || 0);
		if (asset.tier === 'paid') return !posses.has(asset.id);
		return false;
	};

	const getVisualKey = (asset: Asset) => {
		if (asset.layer !== 'symbol') return asset.id;
		const slug = asset.id.split('.')[1] || '';
		const mapping: Record<string, string> = {
			'sword': 'sword-hilt', 'dagger': 'sword-hilt', 'spear': 'sword-hilt',
			'hammer': 'battle-axe', 'mace': 'spiked-mace', 'staff': 'spiked-mace',
			'wand': 'potion-ball', 'torch': 'fireball', 'lantern': 'crystal-ball',
			'scroll': 'scroll-unfurled', 'potion': 'potion-ball', 'gem': 'gem-pendant',
			'key': 'skeleton-key', 'flag': 'shield', 'eagle': 'angel-wings',
			'falcon': 'angel-wings', 'seraph': 'angel-wings', 'wolf': 'skull-mask',
			'bear': 'skull-mask', 'boar': 'skull-mask', 'cerberus': 'skull-mask',
			'chimera': 'skull-mask', 'basilisk': 'skull-mask', 'minotaur': 'skull-mask',
			'dragon': 'dragon-head', 'wyrm': 'dragon-head', 'griffin': 'griffin-symbol',
			'kraken': 'kraken-tentacle', 'reaper': 'reaper-scythe', 'colossus': 'mailed-fist',
			'titan': 'mailed-fist'
		};
		return mapping[slug] || slug;
	};

	const assetsFiltrados = $derived.by(() => {
		const todos = ($assetsByLayer as any)[abaAtiva] || [];
		if (abaAtiva !== 'symbol') return todos;

		const vistos = new Set<string>();
		return todos.filter((a: Asset) => {
			const key = getVisualKey(a);
			if (vistos.has(key)) return false;
			vistos.add(key);
			return true;
		});
	});

	import { PALETAS, FALLBACK_PALETTE } from '../ui/paletas';
</script>

<div class="editor">
	<div class="preview">
		<Brasao layers={rascunho} customUrl={abaAtiva === 'custom' ? customUrlInput : null} tamanho={72} tag={guilda.tag} />
		<div class="info">
			<h3>{guilda.name}</h3>
			<p>Nível {nivelGuilda}</p>
		</div>
	</div>

	<div class="corpo-rolavel">
		<nav class="abas">
			{#each categorias as cat}
				<button class:ativa={abaAtiva === cat.id} onclick={() => (abaAtiva = cat.id)}>
					{cat.rotulo}
				</button>
			{/each}
		</nav>

		<div class="grade">
			{#if abaAtiva === 'name' || abaAtiva === 'tag'}
				<div class="secao-nome">
					<TrocarNome {guilda} tipo={abaAtiva} aoSucesso={aoSalvar} />
				</div>
			{:else if abaAtiva === 'custom'}
				<div class="secao-custom">
					<p class="instrucao">Cole a URL de um PNG transparente.</p>
					<input type="url" placeholder="https://..." bind:value={customUrlInput} />
					<button class="btn-preview" onclick={() => (customUrlInput = customUrlInput.trim())}>Simular Preview</button>
				</div>
			{:else}
				{#each assetsFiltrados as asset}
				{@const bloqueado = estaBloqueado(asset)}
				<button
					class="asset"
					class:selecionado={rascunho[abaAtiva] === asset.id}
					class:bloqueado
					class:pago={asset.tier === 'paid' && !posses.has(asset.id)}
					onclick={() => !bloqueado && selecionar(asset)}
				>
					<div class="visual">
						{#if abaAtiva === 'palette'}
							{@const c = PALETAS[asset.id] || FALLBACK_PALETTE}
							<div class="amostra" style:background={c.primária}>
								<div class="det" style:background={c.detalhe}></div>
							</div>
						{:else if ['shape', 'symbol', 'background', 'border'].includes(abaAtiva)}
							<div class="mini-item">
								<Brasao layers={{...rascunho, [abaAtiva]: asset.id}} tamanho={32} />
							</div>
						{:else}
							<span class="id">{asset.id.split('.')[1]}</span>
						{/if}
					</div>
					{#if bloqueado}
						<div class="trava-status">
							{asset.tier === 'level' ? `Nv ${asset.unlock_level}` : `${asset.price_bits} B`}
						</div>
					{/if}
				</button>
				{/each}
			{/if}
		</div>

		<div class="rodape">
			{#if erro}<p class="erro">{erro}</p>{/if}
			<div class="salvar-container">
				<button class="salvar" disabled={ocupado} onclick={salvar}>
					{ocupado ? 'Salvando...' : 'Salvar Alterações'}
				</button>

				<details class="creditos-footer">
					<summary>ℹ️ Créditos</summary>
					<div class="creditos-content"><Creditos /></div>
				</details>
			</div>
		</div>
	</div>
</div>

<style>
	.editor {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--sable);
		overflow: hidden;
	}

	.preview {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		padding: 10px 16px;
		gap: 14px;
		background: var(--sable-2);
		border-bottom: 1px solid var(--borda);
		z-index: 10;
	}

	.info h3 {
		margin: 0;
		font-family: var(--display);
		color: var(--or);
		font-size: 15px;
	}

	.info p {
		margin: 2px 0 0;
		font-size: 11px;
		color: var(--argent-fraco);
	}

	.corpo-rolavel {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		display: flex;
		flex-direction: column;
		scrollbar-width: thin;
		scrollbar-color: var(--or) transparent;
	}

	.corpo-rolavel::-webkit-scrollbar {
		width: 4px;
	}

	.corpo-rolavel::-webkit-scrollbar-thumb {
		background: var(--or);
		border-radius: 4px;
	}

	.abas {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		background: var(--borda);
		gap: 1px;
		flex-shrink: 0;
	}

	.abas button {
		padding: 8px 4px;
		font-size: 9px;
		text-transform: uppercase;
		border: none;
		background: var(--sable-2);
		color: var(--argent-fraco);
		cursor: pointer;
		font-weight: 600;
	}

	.abas button.ativa {
		color: var(--or);
		background: var(--sable);
		box-shadow: inset 0 -2px 0 var(--or);
	}

	.grade {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		padding: 14px 16px;
		align-content: start;
	}

	.asset {
		width: 100%;
		min-height: 76px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		position: relative;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		border-radius: 4px;
		padding: 6px;
	}

	.asset.selecionado {
		border-color: var(--or);
		background: rgba(212, 175, 55, 0.08);
	}

	.asset.bloqueado {
		opacity: 0.6;
	}

	.visual {
		flex: 1;
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		overflow: hidden;
		pointer-events: none;
	}

	.visual .id {
		font-size: 10px;
		color: var(--argent);
		text-align: center;
		word-break: break-all;
	}

	.mini-item {
		filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.3));
	}

	.amostra {
		width: 36px;
		height: 36px;
		border-radius: 50%;
		position: relative;
		border: 2px solid rgba(255, 255, 255, 0.1);
		overflow: hidden;
	}

	.amostra .det {
		position: absolute;
		top: 0;
		right: 0;
		width: 50%;
		height: 100%;
	}

	.trava-status {
		font-size: 9px;
		color: var(--or);
		font-weight: bold;
		background: rgba(0, 0, 0, 0.6);
		width: 100%;
		text-align: center;
		padding: 2px 0;
		border-radius: 0 0 4px 4px;
		margin-top: 4px;
	}

	.rodape {
		margin-top: auto;
		padding: 16px;
		border-top: 1px solid var(--borda);
		background: var(--sable-2);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.salvar-container {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}

	.salvar {
		flex: 1;
		padding: 12px;
		background: var(--or);
		color: var(--sable);
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		font-size: 13px;
	}

	.erro {
		color: var(--gules);
		font-size: 11px;
		margin: 0;
		text-align: center;
	}

	.creditos-footer {
		flex-shrink: 0;
	}

	summary {
		font-size: 9px;
		color: var(--argent-fraco);
		cursor: pointer;
		list-style: none;
		opacity: 0.6;
		padding: 4px 8px;
		border: 1px solid var(--borda);
		border-radius: 2px;
	}

	summary:hover {
		opacity: 1;
		color: var(--or);
	}

	.creditos-content {
		position: absolute;
		bottom: 50px;
		right: 16px;
		width: 240px;
		max-height: 180px;
		overflow-y: auto;
		font-size: 10px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		padding: 12px;
		border-radius: 4px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.8);
		z-index: 50;
	}
</style>
