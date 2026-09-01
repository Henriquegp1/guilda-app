<script lang="ts">
	let { children, fluido = false } = $props();
</script>

<div class="estandarte" class:fluido>
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

	.estandarte.fluido {
		width: 100%;
		height: 100%;
	}

	.pano {
		flex: 1;
		display: flex;
		flex-direction: column;
		background: linear-gradient(180deg, var(--sable-2) 0%, var(--sable) 42%);
		border-left: 2px solid var(--or);
		padding: 14px var(--px) calc(var(--cauda) + 6px);
		/* A cauda come ~22px da base. O espaço perdido era margem. */
		clip-path: polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - var(--cauda)), 0 100%);
	}

	.fluido .pano {
		clip-path: none;
		padding-bottom: 14px;
		border-right: 2px solid var(--or);
	}
</style>
