<script lang="ts">
	import { iniciar, viewerStore } from '$lib/twitch';
	import PainelModeracao from '$lib/telas/PainelModeracao.svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import { onMount } from 'svelte';

	onMount(() => {
		iniciar();
	});

	// Usamos o prefixo $ para ler a store (compatível com Svelte 5)
	const isMod = $derived($viewerStore.isLoaded && ($viewerStore.role === 'broadcaster' || $viewerStore.role === 'moderator'));
</script>

<svelte:head>
	<title>Moderação de Identidade | Twitch Guilds</title>
</svelte:head>

<main>
	<h1>Tribunal do Streamer</h1>
	<p class="subtitle">Aprove ou rejeite as mudanças de nome, TAG e brasões customizados da sua live.</p>

	{#if !$viewerStore.isLoaded}
		<Estado estado="carregando" />
	{:else if !isMod}
		<Estado
			estado="erro"
			mensagem="Acesso negado. Esta página é exclusiva para o Broadcaster e Moderadores."
		/>
	{:else}
		<PainelModeracao />
	{/if}
</main>

<style>
	main {
		max-width: 1200px;
		margin: 0 auto;
		padding: 32px 20px;
		min-height: 100vh;
	}

	h1 {
		font-family: var(--display);
		font-size: 32px;
		margin: 0;
		color: var(--or);
	}

	.subtitle {
		color: var(--argent-fraco);
		margin: 8px 0 32px;
		font-size: 14px;
	}
</style>
