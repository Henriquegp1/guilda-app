<script lang="ts">
	import EditorBrasao from '$lib/telas/EditorBrasao.svelte';
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
			symbol: 'symbol.sword',
			effect: 'effect.none'
		})
	};

	onMount(() => {
		catalog.load();
	});
</script>

<div class="container-teste">
	<header>
		<h1>Ambiente de Teste de Identidade</h1>
		<p>Use esta página para validar o Editor, os Créditos e o Suporte a PNG.</p>
	</header>

	{#if $catalog}
		<EditorBrasao guilda={guildaMock} aoSalvar={() => alert('Salvamento Simulado!')} />
	{:else}
		<p>Carregando catálogo...</p>
	{/if}
</div>

<style>
	.container-teste {
		background: #0f111a;
		min-height: 100vh;
		padding: 2rem;
		color: white;
	}
	header {
		margin-bottom: 2rem;
		border-bottom: 1px solid #2d324d;
		padding-bottom: 1rem;
	}
	h1 { color: #d4af37; margin: 0; }
	p { color: #888; font-size: 0.9rem; }
</style>
