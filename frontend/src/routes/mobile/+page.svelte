<script lang="ts">
	import Painel from '../panel/+page.svelte';
</script>

<div class="fluido-mobile">
	<Painel fluido={true} />
</div>

<style>
	.fluido-mobile {
		width: 100%;
		height: 100dvh;
		background: var(--sable);
	}

	:global(body) {
		background: var(--sable);
	}

	/* Ajustes de toque para mobile */
	.fluido-mobile :global(button) {
		min-height: 48px;
	}

	.fluido-mobile :global(input),
	.fluido-mobile :global(select),
	.fluido-mobile :global(textarea) {
		font-size: 16px !important; /* Evita zoom automático no iOS */
	}
</style>
