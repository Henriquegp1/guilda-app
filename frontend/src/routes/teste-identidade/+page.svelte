<script lang="ts">
	import EditorBrasao from '$lib/telas/EditorBrasao.svelte';
	import Brasao from '$lib/ui/Brasao.svelte';
	import { catalog } from '$lib/catalog';
	import { onMount } from 'svelte';

	// Mock de guilda para o teste
	const guildaMock: any = {
		id: 1,
		name: 'Guilda de Teste',
		tag: 'TEST',
		level: 10,
		emblem_preset: JSON.stringify({
			v: 1,
			shape: 'shape.heater',
			background: 'bg.solid',
			palette: 'palette.slate',
			border: 'border.none',
			symbol: 'symbol.sword-hilt',
			effect: 'effect.none'
		})
	};

	const frames = [
		{ id: 'frame_bronze', label: 'Bronze (Nv.10)' },
		{ id: 'frame_silver', label: 'Prata (Nv.15)' },
		{ id: 'frame_gold', label: 'Ouro (Nv.25)' },
		{ id: 'frame_platinum', label: 'Platina (Nv.35)' },
		{ id: 'frame_diamond', label: 'Diamante (Nv.45)' },
		{ id: 'frame_legendary', label: 'Lendário (Nv.50)' }
	];

	let formatoSelecionado = $state('shape.heater');
	const formatos = [
		{ id: 'shape.heater', label: 'Clássico' },
		{ id: 'shape.round', label: 'Redondo' },
		{ id: 'shape.square', label: 'Quadrado' },
		{ id: 'shape.pointed', label: 'Pontudo' },
		{ id: 'shape.kite', label: 'Pipa' },
		{ id: 'shape.lozenge', label: 'Losango' },
		{ id: 'shape.banner', label: 'Estandarte' }
	];

	onMount(async () => {
		try {
			await catalog.load();
		} catch (e) {
			// Injeta catálogo fake se o backend estiver offline
			catalog.load({
				version: 1,
				assets: [
					{ id: 'shape.heater', layer: 'shape', tier: 'free', status: 'active', price_bits: 0, unlock_level: 0, svg_symbol_id: 'shape--heater', is_layer_fallback: true },
					{ id: 'bg.solid', layer: 'background', tier: 'free', status: 'active', price_bits: 0, unlock_level: 0, svg_symbol_id: 'bg--solid', is_layer_fallback: true },
					{ id: 'palette.slate', layer: 'palette', tier: 'free', status: 'active', price_bits: 0, unlock_level: 0, svg_symbol_id: 'palette--slate', is_layer_fallback: true },
					{ id: 'border.none', layer: 'border', tier: 'free', status: 'active', price_bits: 0, unlock_level: 0, svg_symbol_id: 'border--none', is_layer_fallback: true },
					{ id: 'symbol.sword-hilt', layer: 'symbol', tier: 'free', status: 'active', price_bits: 0, unlock_level: 0, svg_symbol_id: 'symbol--sword-hilt', is_layer_fallback: true },
					{ id: 'effect.none', layer: 'effect', tier: 'free', status: 'active', price_bits: 0, unlock_level: 0, svg_symbol_id: 'effect--none', is_layer_fallback: true }
				],
				sprite_url: '',
				denied_combos_hash: '',
				bundle: { sku: '', price_bits: 0, pick: 0, from: [] },
				prices: {}
			} as any);
		}
	});
</script>

<div class="container-teste">
	<header>
		<h1>Ambiente de Teste de Identidade</h1>
		<p>Use esta página para validar o Editor, os Frames e o Suporte a PNG.</p>
	</header>

	<section class="galeria-frames">
		<header class="header-galeria">
			<h2>Galeria de Molduras (Nível)</h2>
			<div class="seletor-formato">
				<span>Trocar Formato:</span>
				<select bind:value={formatoSelecionado}>
					{#each formatos as f}
						<option value={f.id}>{f.label}</option>
					{/each}
				</select>
			</div>
		</header>
		<div class="grid-frames">
			{#each frames as f}
				<div class="item-frame">
					<Brasao
						tag="TEST"
						tamanho={100}
						layers={{...JSON.parse(guildaMock.emblem_preset), shape: formatoSelecionado}}
						progressionFrame={f.id}
					/>
					<span>{f.label}</span>
				</div>
			{/each}
		</div>
	</section>

	<section class="editor-sessao">
		<h2>Editor de Identidade</h2>
		{#if $catalog}
			<EditorBrasao guilda={guildaMock} aoSalvar={() => console.log('Salvamento Simulado!')} />
		{:else}
			<p>Carregando catálogo...</p>
		{/if}
	</section>
</div>

<style>
	.container-teste {
		background: #0f111a;
		min-height: 100vh;
		padding: 2rem;
		color: white;
		display: flex;
		flex-direction: column;
		gap: 3rem;
	}
	header {
		border-bottom: 1px solid #2d324d;
		padding-bottom: 1rem;
	}
	h1 { color: #d4af37; margin: 0; }
	h2 { color: #c8a02e; font-size: 1.2rem; margin: 0; text-transform: uppercase; letter-spacing: 0.1em; }

	.header-galeria {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.5rem;
	}

	.seletor-formato {
		display: flex;
		align-items: center;
		gap: 1rem;
		font-size: 0.9rem;
		color: #9a93a8;
	}

	.seletor-formato select {
		background: #16121c;
		color: #d4af37;
		border: 1px solid #322942;
		padding: 0.4rem;
		border-radius: 4px;
		outline: none;
	}
	p { color: #888; font-size: 0.9rem; }

	.grid-frames {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
		gap: 2rem;
		background: #16121c;
		padding: 2rem;
		border-radius: 8px;
		border: 1px solid #322942;
	}

	.item-frame {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}

	.item-frame span {
		font-size: 0.8rem;
		color: #9a93a8;
		font-weight: bold;
	}

	.editor-sessao {
		max-width: 400px;
		height: 600px;
		border: 1px solid #322942;
		border-radius: 8px;
		overflow: hidden;
		background: #16121c;
		padding: 1rem;
	}
</style>
