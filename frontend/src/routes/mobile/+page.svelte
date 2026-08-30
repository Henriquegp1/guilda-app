<script lang="ts">
	import Painel from '../panel/+page.svelte';
</script>

<div class="fluido">
	<Painel />
</div>

<style>
	.fluido :global(.estandarte) {
		width: 100%;
		max-width: 520px;
		height: 100dvh;
		margin: 0 auto;
	}

	.fluido :global(button) {
		min-height: 44px;
	}
</style>
