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

	const corPrimaria = $derived(corPri?.trim() || '#3f4652');
	const corSecundaria = $derived(corSec?.trim() || '#697386');
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
		<div
			class="imagem-fundo"
			style:background-image="url({url})"
		></div>
	{:else}
		<div class="fortaleza-pixel">
			<svg
				class="fortaleza-svg"
				viewBox="0 0 160 48"
				preserveAspectRatio="none"
				shape-rendering="crispEdges"
				aria-hidden="true"
			>
				<!--
					====================================================
					FUNDO
					====================================================
				-->

				<!-- Céu -->
				<rect
					x="0"
					y="0"
					width="160"
					height="48"
					fill="var(--banner-pri)"
				/>

				<!-- Faixa secundária do céu -->
				<rect
					x="0"
					y="0"
					width="160"
					height="12"
					fill="var(--banner-sec)"
					opacity="0.45"
				/>

				<!-- Pixels decorativos do céu -->
				<g fill="#d6d0c2" opacity="0.18">
					<rect x="8" y="7" width="2" height="2" />
					<rect x="12" y="4" width="1" height="1" />
					<rect x="22" y="9" width="2" height="1" />

					<rect x="139" y="6" width="2" height="2" />
					<rect x="145" y="10" width="1" height="1" />
					<rect x="130" y="4" width="2" height="1" />

					<rect x="53" y="6" width="1" height="1" />
					<rect x="106" y="8" width="2" height="1" />
				</g>

				<!-- Lua / luz pixelada -->
				<g fill="#d6d0c2" opacity="0.22">
					<rect x="72" y="5" width="8" height="2" />
					<rect x="70" y="7" width="12" height="4" />
					<rect x="72" y="11" width="8" height="2" />
				</g>

				<!--
					====================================================
					CHÃO
					====================================================
				-->

				<rect
					x="0"
					y="39"
					width="160"
					height="9"
					fill="#242321"
				/>

				<rect
					x="0"
					y="39"
					width="160"
					height="2"
					fill="#5b5954"
				/>

				<!-- Pedras do chão -->
				<g fill="#45433f">
					<rect x="4" y="43" width="10" height="2" />
					<rect x="17" y="46" width="7" height="2" />
					<rect x="28" y="42" width="12" height="2" />
					<rect x="45" y="45" width="9" height="3" />
					<rect x="59" y="42" width="8" height="2" />
					<rect x="72" y="45" width="11" height="3" />
					<rect x="89" y="42" width="13" height="2" />
					<rect x="106" y="45" width="8" height="3" />
					<rect x="119" y="42" width="12" height="2" />
					<rect x="137" y="45" width="10" height="3" />
					<rect x="151" y="42" width="6" height="2" />
				</g>

				<!--
					====================================================
					TORRE ESQUERDA
					====================================================
				-->

				<!-- Sombra externa -->
				<g fill="#181817">
					<rect x="13" y="16" width="24" height="24" />
					<rect x="10" y="18" width="30" height="21" />
				</g>

				<!-- Corpo da torre -->
				<g fill="#85827c">
					<rect x="12" y="17" width="25" height="23" />

					<!-- Topo -->
					<rect x="10" y="14" width="29" height="5" />

					<!-- Ameias -->
					<rect x="11" y="11" width="5" height="5" />
					<rect x="20" y="13" width="5" height="3" />
					<rect x="29" y="11" width="5" height="5" />
					<rect x="37" y="13" width="3" height="3" />
				</g>

				<!-- Luz da torre -->
				<g fill="#d6d0c2">
					<rect x="13" y="17" width="22" height="2" />
					<rect x="13" y="20" width="3" height="17" />
				</g>

				<!-- Sombra da torre -->
				<g fill="#45433f">
					<rect x="31" y="17" width="6" height="23" />
					<rect x="34" y="14" width="5" height="4" />
				</g>

				<!-- Blocos da torre -->
				<g fill="#5b5954">
					<rect x="13" y="24" width="8" height="2" />
					<rect x="25" y="21" width="9" height="2" />
					<rect x="15" y="30" width="7" height="2" />
					<rect x="27" y="34" width="8" height="2" />
				</g>

				<!-- Janela -->
				<rect
					x="20"
					y="23"
					width="8"
					height="9"
					fill="#181817"
				/>

				<rect
					x="22"
					y="23"
					width="4"
					height="9"
					fill="#242321"
				/>

				<!-- Luz da janela -->
				<rect
					x="22"
					y="25"
					width="2"
					height="4"
					fill="#8a6a32"
				/>

				<!-- Detalhe ocre -->
				<rect
					x="12"
					y="36"
					width="25"
					height="2"
					fill="#80632e"
				/>

				<!--
					====================================================
					TORRE DIREITA
					====================================================
				-->

				<!-- Sombra externa -->
				<g fill="#181817">
					<rect x="123" y="16" width="24" height="24" />
					<rect x="120" y="18" width="30" height="21" />
				</g>

				<!-- Corpo -->
				<g fill="#85827c">
					<rect x="123" y="17" width="25" height="23" />

					<!-- Topo -->
					<rect x="121" y="14" width="29" height="5" />

					<!-- Ameias -->
					<rect x="121" y="11" width="5" height="5" />
					<rect x="130" y="13" width="5" height="3" />
					<rect x="139" y="11" width="5" height="5" />
					<rect x="147" y="13" width="3" height="3" />
				</g>

				<!-- Luz -->
				<g fill="#d6d0c2">
					<rect x="124" y="17" width="22" height="2" />
					<rect x="124" y="20" width="3" height="17" />
				</g>

				<!-- Sombra -->
				<g fill="#45433f">
					<rect x="142" y="17" width="6" height="23" />
					<rect x="145" y="14" width="5" height="4" />
				</g>

				<!-- Blocos -->
				<g fill="#5b5954">
					<rect x="124" y="24" width="8" height="2" />
					<rect x="136" y="21" width="9" height="2" />
					<rect x="126" y="30" width="7" height="2" />
					<rect x="138" y="34" width="8" height="2" />
				</g>

				<!-- Janela -->
				<rect
					x="131"
					y="23"
					width="8"
					height="9"
					fill="#181817"
				/>

				<rect
					x="133"
					y="23"
					width="4"
					height="9"
					fill="#242321"
				/>

				<rect
					x="133"
					y="25"
					width="2"
					height="4"
					fill="#8a6a32"
				/>

				<!-- Detalhe ocre -->
				<rect
					x="123"
					y="36"
					width="25"
					height="2"
					fill="#80632e"
				/>

				<!--
					====================================================
					MURALHA CENTRAL
					====================================================
				-->

				<!-- Sombra traseira -->
				<path
					d="
						M34 40
						V21
						H39 V18
						H44 V21
						H49 V18
						H54 V21
						H59 V18
						H64 V21
						H69 V18
						H74 V21
						H79 V18
						H84 V21
						H89 V18
						H94 V21
						H99 V18
						H104 V21
						H109 V18
						H114 V21
						H119 V40
						Z
					"
					fill="#181817"
				/>

				<!-- Corpo principal -->
				<path
					d="
						M35 39
						V20
						H40 V17
						H45 V20
						H50 V17
						H55 V20
						H60 V17
						H65 V20
						H70 V17
						H75 V20
						H80 V17
						H85 V20
						H90 V17
						H95 V20
						H100 V17
						H105 V20
						H110 V17
						H115 V20
						H120 V39
						Z
					"
					fill="#68655f"
				/>

				<!-- Faixa superior iluminada -->
				<rect
					x="35"
					y="20"
					width="85"
					height="3"
					fill="#b7b2a8"
				/>

				<!-- Blocos claros -->
				<g fill="#85827c">
					<rect x="37" y="24" width="8" height="4" />
					<rect x="48" y="23" width="9" height="4" />
					<rect x="61" y="25" width="8" height="4" />
					<rect x="72" y="23" width="9" height="4" />
					<rect x="85" y="25" width="8" height="4" />
					<rect x="97" y="23" width="9" height="4" />
					<rect x="109" y="25" width="8" height="4" />
				</g>

				<!-- Blocos escuros -->
				<g fill="#45433f">
					<rect x="39" y="30" width="10" height="3" />
					<rect x="54" y="33" width="8" height="3" />
					<rect x="67" y="30" width="10" height="3" />
					<rect x="82" y="34" width="8" height="3" />
					<rect x="95" y="30" width="10" height="3" />
					<rect x="109" y="34" width="8" height="3" />
				</g>

				<!-- Linha de metal/ocre -->
				<rect
					x="35"
					y="37"
					width="85"
					height="2"
					fill="#80632e"
				/>

				<!--
					====================================================
					PORTÃO
					====================================================
				-->

				<!-- Arco externo -->
				<path
					d="
						M66 39
						V29
						H68 V26
						H71 V24
						H76 V23
						H84 V24
						H89 V26
						H92 V29
						H94 V39
						Z
					"
					fill="#242321"
				/>

				<!-- Arco interno -->
				<path
					d="
						M70 39
						V29
						H72 V27
						H76 V25
						H84 V27
						H88 V29
						H90 V39
						Z
					"
					fill="#181817"
				/>

				<!-- Madeira do portão -->
				<g fill="#45433f">
					<rect x="72" y="29" width="4" height="10" />
					<rect x="78" y="27" width="4" height="12" />
					<rect x="84" y="29" width="4" height="10" />
				</g>

				<!-- Travessas do portão -->
				<g fill="#8a6a32">
					<rect x="71" y="31" width="18" height="1" />
					<rect x="71" y="36" width="18" height="1" />
				</g>

				<!--
					====================================================
					JANELAS DA MURALHA
					====================================================
				-->

				<g fill="#181817">
					<rect x="48" y="27" width="4" height="5" />
					<rect x="58" y="27" width="4" height="5" />

					<rect x="98" y="27" width="4" height="5" />
					<rect x="108" y="27" width="4" height="5" />
				</g>

				<!-- Luz das janelas -->
				<g fill="#8a6a32">
					<rect x="49" y="28" width="1" height="3" />
					<rect x="59" y="28" width="1" height="3" />

					<rect x="99" y="28" width="1" height="3" />
					<rect x="109" y="28" width="1" height="3" />
				</g>

				<!--
					====================================================
					BANDEIRAS
					====================================================
				-->

				<!-- Mastro esquerdo -->
				<rect
					x="43"
					y="7"
					width="1"
					height="12"
					fill="#242321"
				/>

				<!-- Bandeira esquerda -->
				<path
					d="
						M44 8
						H53
						V10
						H56
						V13
						H53
						V15
						H44
						Z
					"
					fill="#80632e"
				/>

				<!-- Pixel claro da bandeira -->
				<rect
					x="45"
					y="9"
					width="5"
					height="1"
					fill="#b7a16e"
				/>

				<!-- Mastro direito -->
				<rect
					x="116"
					y="7"
					width="1"
					height="12"
					fill="#242321"
				/>

				<!-- Bandeira direita -->
				<path
					d="
						M116 8
						H107
						V10
						H104
						V13
						H107
						V15
						H116
						Z
					"
					fill="#80632e"
				/>

				<rect
					x="109"
					y="9"
					width="5"
					height="1"
					fill="#b7a16e"
				/>

				<!--
					====================================================
					PEDRAS EXTRAS
					====================================================
				-->

				<g fill="#b7b2a8" opacity="0.45">
					<rect x="2" y="37" width="4" height="2" />
					<rect x="6" y="34" width="3" height="2" />

					<rect x="151" y="37" width="4" height="2" />
					<rect x="147" y="34" width="3" height="2" />
				</g>

				<!-- Borda inferior ocre -->
				<rect
					x="0"
					y="39"
					width="160"
					height="1"
					fill="#8a6a32"
				/>
			</svg>
		</div>
	{/if}

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

	.com-frame {
		border: 2px solid var(--or);
		box-shadow:
			inset 0 0 15px rgba(200, 160, 46, 0.3);
	}

	.com-glow {
		animation: glow-pulsar 3s infinite ease-in-out;
	}

	@keyframes glow-pulsar {
		0%,
		100% {
			box-shadow: 0 0 5px var(--or);
		}

		50% {
			box-shadow: 0 0 15px var(--or);
		}
	}

	.imagem-fundo {
		position: absolute;
		inset: 0;
		background-size: cover;
		background-position: center;
		image-rendering: pixelated;
		opacity: 0.6;
	}

	.fortaleza-pixel {
		position: absolute;
		inset: 0;
		overflow: hidden;
		background:
			linear-gradient(
				135deg,
				var(--banner-pri),
				var(--banner-sec)
			);
	}

	.fortaleza-svg {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
		image-rendering: pixelated;
		image-rendering: crisp-edges;
	}

	.overlay-gradiente {
		position: absolute;
		inset: 0;
		background:
			linear-gradient(
				to bottom,
				transparent 45%,
				rgba(0, 0, 0, 0.18) 75%,
				rgba(0, 0, 0, 0.38) 100%
			);
		pointer-events: none;
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