<script lang="ts">
	let { children } = $props();
</script>

<div class="estandarte">
	<div class="pano">
		{@render children()}
	</div>
</div>

<style>
	.estandarte {
		width: 318px;
		height: 496px;
		display: flex;
		overflow: hidden;
	}

	.pano {
		flex: 1;
		display: flex;
		flex-direction: column;
		background: linear-gradient(180deg, var(--sable-2) 0%, var(--sable) 42%);
		border-left: 2px solid var(--or);
		padding: 14px var(--px) calc(var(--cauda) + 6px);
		/* A cauda come ~22px da base. O espaço perdido era margem. */
		clip-path: polygon(
			0 0,
			100% 0,
			100% 100%,
			50% calc(100% - var(--cauda)),
			0 100%
		);
	}
</style>
