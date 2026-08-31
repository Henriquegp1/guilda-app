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
		// Sincroniza rascunho apenas após montar
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
			if (confirm(`Comprar por ${asset.price_bits} Bits?`)) comprar(asset);
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

	const estaBloqueado = (asset: Asset) => {
		if (asset.tier === 'level') return nivelGuilda < (asset.unlock_level || 0);
		if (asset.tier === 'paid') return !posses.has(asset.id);
		return false;
	};
</script>

<div class="editor">
	<div class="preview">
		<Brasao layers={rascunho} customUrl={abaAtiva === 'custom' ? customUrlInput : null} tamanho={120} />
		<div class="info">
			<h3>{guilda.name}</h3>
			<p>Nível {nivelGuilda}</p>
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
			{#each ($assetsByLayer as any)[abaAtiva] || [] as asset}
			{@const bloqueado = estaBloqueado(asset)}
			<button
				class="asset"
				class:selecionado={rascunho[abaAtiva] === asset.id}
				class:bloqueado
				class:pago={asset.tier === 'paid' && !posses.has(asset.id)}
				onclick={() => !bloqueado && selecionar(asset)}
			>
				<div class="visual"><span class="id">{asset.id.split('.')[1]}</span></div>
				{#if bloqueado}
					<div class="trava">
						<span class={asset.tier === 'level' ? 'nv' : 'preco'}>
							{asset.tier === 'level' ? `Nv ${asset.unlock_level}` : `${asset.price_bits} B`}
						</span>
					</div>
				{/if}
			</button>
			{/each}
		{/if}
	</div>

	<div class="acoes">
		{#if erro}<p class="erro">{erro}</p>{/if}
		<button class="salvar" disabled={ocupado} onclick={salvar}>
			{ocupado ? 'Salvando...' : 'Salvar Alterações'}
		</button>
	</div>

	<div class="secao-creditos"><Creditos /></div>
</div>

<style>
	.editor { display: flex; flex-direction: column; height: 100%; background: var(--sable); }
	.preview { display: flex; align-items: center; padding: 20px; gap: 20px; background: linear-gradient(to bottom, var(--sable-2), var(--sable)); border-bottom: 1px solid var(--borda); }
	.info h3 { margin: 0; font-family: var(--display); color: var(--or); }
	.info p { margin: 4px 0 0; font-size: 12px; color: var(--argent-fraco); }
	.abas { display: flex; overflow-x: auto; background: var(--sable-2); border-bottom: 1px solid var(--borda); }
	.abas button { flex: 1; padding: 12px 8px; font-size: 11px; text-transform: uppercase; border: none; border-bottom: 2px solid transparent; background: none; color: var(--argent-fraco); cursor: pointer; }
	.abas button.ativa { color: var(--or); border-bottom-color: var(--or); background: rgba(212, 175, 55, 0.05); }
	.grade { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; padding: 12px; overflow-y: auto; }
	.asset { aspect-ratio: 1; background: var(--sable-2); border: 1px solid var(--borda); position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer; }
	.asset.selecionado { border-color: var(--or); background: rgba(212, 175, 55, 0.1); }
	.asset.bloqueado { opacity: 0.5; cursor: not-allowed; }
	.visual .id { font-size: 10px; color: var(--argent); }
	.trava { position: absolute; bottom: 4px; right: 4px; background: rgba(0, 0, 0, 0.8); padding: 2px 4px; font-size: 9px; }
	.nv { color: var(--or); }
	.preco { color: var(--vert); }
	.acoes { padding: 16px; border-top: 1px solid var(--borda); }
	.secao-nome, .secao-custom { grid-column: 1 / -1; }
	.secao-custom { display: flex; flex-direction: column; gap: 8px; }
	.btn-preview { background: var(--sable-2); border: 1px solid var(--or); color: var(--or); padding: 6px; cursor: pointer; }
	.salvar { width: 100%; padding: 12px; background: var(--or); color: var(--sable); font-weight: bold; border: none; }
	.erro { color: var(--gules); font-size: 12px; }
	.secao-creditos { padding: 20px; border-top: 1px dashed var(--borda); }
</style>
