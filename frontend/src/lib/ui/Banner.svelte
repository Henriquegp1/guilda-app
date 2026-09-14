<script lang="ts">
	import { entrarBloco } from '$lib/motion';

	let {
		url,
		nivel = 1,
		unlocks = []
	}: {
		url?: string | null;
		nivel?: number;
		unlocks?: string[];
	} = $props();

	const tem = (key: string) => unlocks.includes(key);

	const temFrame = $derived(tem('banner_frame') || nivel >= 30);
	const temGlow = $derived(tem('banner_glow') || nivel >= 40);
	const temSelo = $derived(tem('banner_signed') || nivel >= 50);
</script>

<div
	class="banner-container"
	class:com-frame={temFrame}
	class:com-glow={temGlow}
	in:entrarBloco
>
	{#if url}
		<div class="imagem-fundo" style:background-image="url({url})"></div>
	{:else}
		<div class="padrao-fundo"></div>
	{/if}

	{#if temSelo}
		<div class="selo-lendario" title="Guilda Lendária">⚜️</div>
	{/if}

	<div class="overlay-gradiente"></div>
</div>

<style>
	.banner-container {
		position: relative;
		width: 100%;
		height: 120px;
		background: var(--sable-2);
		overflow: hidden;
		border-radius: 4px;
		border: 1px solid var(--borda);
	}

	.com-frame {
		border: 2px solid var(--or);
		box-shadow: inset 0 0 15px rgba(200, 160, 46, 0.3);
	}

	.com-glow {
		animation: glow-pulsar 3s infinite ease-in-out;
	}

	@keyframes glow-pulsar {
		0%, 100% { box-shadow: 0 0 5px var(--or); }
		50% { box-shadow: 0 0 15px var(--or); }
	}

	.imagem-fundo {
		position: absolute;
		inset: 0;
		background-size: cover;
		background-position: center;
		opacity: 0.6;
	}

	.padrao-fundo {
		position: absolute;
		inset: 0;
		background-image: radial-gradient(circle at 2px 2px, var(--borda) 1px, transparent 0);
		background-size: 20px 20px;
		opacity: 0.3;
	}

	.overlay-gradiente {
		position: absolute;
		inset: 0;
		background: linear-gradient(to bottom, transparent, var(--sable));
	}

	.selo-lendario {
		position: absolute;
		top: 8px;
		right: 8px;
		font-size: 20px;
		filter: drop-shadow(0 0 5px var(--or));
		z-index: 5;
	}
</style>
