<script lang="ts">
	import LaboratorioBrasao from '$lib/telas/LaboratorioBrasao.svelte';
	import { catalog } from '$lib/catalog';
	import { onMount } from 'svelte';

	onMount(() => {
		catalog.load();
	});
</script>

<svelte:head>
	<title>Laboratório de Brasões — Guildas</title>
</svelte:head>

{#if $catalog}
	<LaboratorioBrasao />
{:else}
	<div class="carregando">
		<p>Conectando ao Grande Catálogo...</p>
	</div>
{/if}

<style>
	.carregando {
		display: flex;
		height: 100vh;
		align-items: center;
		justify-content: center;
		background: #0f111a;
		color: #d4af37;
		font-family: serif;
		font-size: 1.5rem;
	}
</style>
