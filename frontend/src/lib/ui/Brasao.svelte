<script lang="ts">
	/**
	 * Placeholder até a fase 06, que substitui isto pelas 6 camadas do catálogo
	 * (`shape` + `background` + `palette` + `border` + `symbol` + `effect`).
	 * O formato aqui já é o `shape.heater` do catálogo, então a troca é de
	 * conteúdo, não de layout.
	 */
	let { tag = '', tamanho = 96 }: { tag?: string; tamanho?: number } = $props();

	// Heater: ombros retos, flancos retos até dois terços, ponta em ogiva.
	const ESCUDO = 'M4 4 H92 V44 C92 74 72 90 48 100 C24 90 4 74 4 44 Z';
</script>

<svg
	class="brasao"
	viewBox="0 0 96 104"
	width={tamanho}
	height={tamanho * (104 / 96)}
	role="img"
	class:vago={!tag}
	aria-label={tag ? `Brasão da guilda ${tag}` : 'Escudo sem guilda'}
>
	<defs>
		<linearGradient id="campo" x1="0" y1="0" x2="0" y2="1">
			<stop offset="0%" stop-color="#2b2136" />
			<stop offset="100%" stop-color="#1a1422" />
		</linearGradient>
	</defs>

	<path d={ESCUDO} fill="url(#campo)" stroke="var(--or)" stroke-width="2" />
	<!-- Chefe: a faixa superior, onde a carga principal vai na fase 06. -->
	<path d="M4 30 H92" stroke="var(--or)" stroke-width="1" opacity="0.45" />

	{#if tag}
		<text x="48" y="66" text-anchor="middle" class="tag">{tag}</text>
	{/if}
</svg>

<style>
	.brasao {
		display: block;
	}

	/* Escudo vago: mesma forma, sem carga e sem peso. */
	.brasao.vago {
		opacity: 0.32;
	}

	.tag {
		font-family: var(--display);
		font-size: 26px;
		font-weight: 600;
		fill: var(--or);
		letter-spacing: 0.04em;
	}
</style>
