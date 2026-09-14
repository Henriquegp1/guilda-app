<script lang="ts">
	import { entrarBloco } from '$lib/motion';

	let {
		url,
		nivel = 1,
		unlocks = [],
		corPri = '#3f4652',
		corSec = '#697386'
	}: {
		url?: string | null;
		nivel?: number;
		unlocks?: string[];
		corPri?: string;
		corSec?: string;
	} = $props();

	const tem = (key: string) => unlocks.includes(key);

	const temFrame = $derived(tem('banner_frame') || nivel >= 30);
	const temGlow = $derived(tem('banner_glow') || nivel >= 40);
	const temSelo = $derived(tem('banner_signed') || nivel >= 50);

	// =========================================================
	// CORES DO BANNER
	// =========================================================

	const corPrimaria = $derived(
		corPri?.trim() || '#3f4652'
	);

	const corSecundaria = $derived(
		corSec?.trim() || '#697386'
	);
</script>

<div
	class="banner-container"
	class:com-frame={temFrame}
	class:com-glow={temGlow}
	style:--banner-pri={corPrimaria}
	style:--banner-sec={corSecundaria}
	in:entrarBloco
>
	{#if url}

		<!-- =====================================================
		     BANNER PERSONALIZADO
		====================================================== -->

		<div
			class="imagem-fundo"
			style:background-image="url({url})"
		></div>

	{:else}

		<!-- =====================================================
		     BANNER HERÁLDICO BASE
		====================================================== -->

		<div class="padrao-fundo"></div>

		<div class="trama-heraldica"></div>

		<div class="textura-tecido"></div>

	{/if}

	<!-- =======================================================
	     OVERLAY
	======================================================== -->

	<div class="overlay-gradiente"></div>

	{#if temSelo}
		<div
			class="selo-lendario"
			title="Guilda Lendária"
		>
			⚜️
		</div>
	{/if}
</div>

<style>
	.banner-container {
		position: relative;
		width: 100%;
		height: 120px;

		/*
		 * Fallback visual caso alguma coisa não carregue.
		 */
		background:
			linear-gradient(
				135deg,
				var(--banner-pri),
				var(--banner-sec)
			);

		overflow: hidden;
		border-radius: 4px;
		border: 1px solid var(--borda);
	}

	/* =========================================================
	   FRAME
	========================================================= */

	.com-frame {
		border: 2px solid var(--or);

		box-shadow:
			inset 0 0 15px rgba(200, 160, 46, 0.3);
	}

	/* =========================================================
	   GLOW
	========================================================= */

	.com-glow {
		animation: glow-pulsar 3s infinite ease-in-out;
	}

	@keyframes glow-pulsar {
		0%,
		100% {
			box-shadow:
				0 0 5px var(--or);
		}

		50% {
			box-shadow:
				0 0 15px var(--or);
		}
	}

	/* =========================================================
	   IMAGEM PERSONALIZADA
	========================================================= */

	.imagem-fundo {
		position: absolute;
		inset: 0;

		background-size: cover;
		background-position: center;

		opacity: 0.6;
	}

	/* =========================================================
	   FUNDO HERÁLDICO BASE
	========================================================= */

	.padrao-fundo {
		position: absolute;
		inset: 0;

		background:
			linear-gradient(
				135deg,
				var(--banner-pri) 0%,
				var(--banner-pri) 42%,
				var(--banner-sec) 100%
			);

		opacity: 1;
	}

	/* =========================================================
	   TRAMA HERÁLDICA
	   
	   Listras diagonais sutis usando a cor secundária.
	========================================================= */

	.trama-heraldica {
		position: absolute;
		inset: -40%;

		background:
			repeating-linear-gradient(
				-45deg,
				transparent 0px,
				transparent 18px,
				color-mix(
					in srgb,
					var(--banner-sec) 22%,
					transparent
				) 18px,
				color-mix(
					in srgb,
					var(--banner-sec) 22%,
					transparent
				) 21px
			);

		transform: rotate(0deg) scale(1.2);

		opacity: 0.65;
		pointer-events: none;
	}

	/* =========================================================
	   TEXTURA DE TECIDO
	========================================================= */

	.textura-tecido {
		position: absolute;
		inset: 0;

		background-image:
			repeating-linear-gradient(
				90deg,
				rgba(255, 255, 255, 0.035) 0px,
				rgba(255, 255, 255, 0.035) 1px,
				transparent 1px,
				transparent 4px
			),
			repeating-linear-gradient(
				0deg,
				rgba(0, 0, 0, 0.035) 0px,
				rgba(0, 0, 0, 0.035) 1px,
				transparent 1px,
				transparent 4px
			);

		opacity: 0.7;
		mix-blend-mode: overlay;
		pointer-events: none;
	}

	/* =========================================================
	   OVERLAY
	========================================================= */

	.overlay-gradiente {
		position: absolute;
		inset: 0;

		background:
			linear-gradient(
				to bottom,
				transparent 25%,
				rgba(0, 0, 0, 0.35) 100%
			);

		pointer-events: none;
	}

	/* =========================================================
	   SELO
	========================================================= */

	.selo-lendario {
		position: absolute;

		top: 8px;
		right: 8px;

		font-size: 20px;

		filter:
			drop-shadow(
				0 0 5px var(--or)
			);

		z-index: 5;
	}
</style>