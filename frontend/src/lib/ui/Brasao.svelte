<script lang="ts">
	import { catalog, assetsById } from '$lib/catalog';
	import { PALETAS, FALLBACK_PALETTE } from './paletas';
	import type { EmblemLayers } from '$lib/api';

	let {
		tag = '',
		tamanho = 96,
		layers,
		customUrl
	}: { tag?: string; tamanho?: number; layers?: Partial<EmblemLayers>; customUrl?: string | null } = $props();

	// Fallbacks padrão do catálogo (devem bater com o Back-end)
	const FALLBACKS: Record<string, string> = {
		shape: 'shape.heater',
		background: 'bg.solid',
		palette: 'palette.slate',
		border: 'border.none',
		symbol: 'symbol.blank',
		effect: 'effect.none'
	};

	const getLayer = (l: keyof typeof FALLBACKS) => {
		const id = (layers as any)?.[l];
		if (!id) return FALLBACKS[l];
		if ($assetsById.size > 0 && !$assetsById.has(id)) return FALLBACKS[l];
		return id;
	};

	const paletaId = $derived(getLayer('palette'));
	const cores = $derived(PALETAS[paletaId] || FALLBACK_PALETTE);
	const sid = (id: string) => id.replace('.', '--');
	const spriteUrl = $derived($catalog?.sprite_url || '');

	const SHAPE_PATHS: Record<string, string> = {
		'shape.heater': 'M8 6 H88 V44 C88 74 68 88 48 98 C28 88 8 74 8 44 Z',
		'shape.round': 'M48 6 C24 6 8 26 8 52 C8 78 24 98 48 98 C72 98 88 78 88 52 C88 26 72 6 48 6 Z',
		'shape.square': 'M8 6 H88 V90 H8 Z',
		'shape.pointed': 'M8 6 H88 V60 L48 98 L8 60 Z',
		'shape.kite': 'M48 6 L88 44 L48 98 L8 44 Z',
		'shape.lozenge': 'M48 8 L88 52 L48 96 L8 52 Z',
		'shape.banner': 'M8 6 H88 V82 L48 98 L8 82 Z'
	};

	const shapeId = $derived(getLayer('shape'));
	const escudoPath = $derived(SHAPE_PATHS[shapeId] || SHAPE_PATHS['shape.heater']);

	// Escala refinada: 0.85 para escudos largos, 0.72 para estreitos (padding perfeito)
	const symbolScale = $derived(['shape.kite', 'shape.lozenge'].includes(shapeId) ? 0.72 : 0.85);

	const BORDER_STROKES: Record<string, { width: number; dasharray?: string; linecap?: 'round' | 'butt' }> = {
		'border.plain': { width: 4 },
		'border.rope': { width: 5, dasharray: '2 2', linecap: 'round' },
		'border.beaded': { width: 3, dasharray: '1 4', linecap: 'round' },
		'border.chain': { width: 4, dasharray: '8 4' },
		'border.laurel': { width: 6, dasharray: '10 3', linecap: 'round' },
		'border.runic': { width: 4, dasharray: '6 2 1 2' }
	};
	const borderId = $derived(getLayer('border'));
	const borderStyle = $derived(BORDER_STROKES[borderId] ?? null);
</script>

<svg
	class="brasao"
	viewBox="0 0 96 104"
	width={tamanho}
	height={tamanho * (104 / 96)}
	role="img"
	class:vago={!tag && !layers}
	aria-label={tag ? `Brasão da guilda ${tag}` : 'Escudo heráldico'}
	style:--cor-pri={cores.primária}
	style:--cor-sec={cores.secundária}
	style:--cor-det={cores.detalhe}
>
	<defs>
		<clipPath id="clip-escudo">
			<path d={escudoPath} />
		</clipPath>

		<linearGradient id="grad-ouro" x1="0%" y1="0%" x2="100%" y2="100%">
			<stop offset="0%" stop-color="#BF953F" />
			<stop offset="50%" stop-color="#FCF6BA" />
			<stop offset="100%" stop-color="#AA771C" />
		</linearGradient>

		<linearGradient id="brilho-vidro" x1="0%" y1="0%" x2="0%" y2="100%">
			<stop offset="0%" stop-color="white" stop-opacity="0.2" />
			<stop offset="100%" stop-color="black" stop-opacity="0.1" />
		</linearGradient>

		<!-- Padrões de fundo adaptativos (objectBoundingBox garante encaixe em qualquer shape) -->
		<pattern id="bg--checker--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="0.2" height="0.2" viewBox="0 0 100 100">
			<rect x="0" y="0" width="50" height="50" fill="currentColor" />
			<rect x="50" y="50" width="50" height="50" fill="currentColor" />
		</pattern>
		<pattern id="bg--stripes--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="1" height="0.2" viewBox="0 0 100 100">
			<rect x="0" y="0" width="100" height="50" fill="currentColor" />
		</pattern>
		<pattern id="bg--split--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 100 100">
			<rect x="50" y="0" width="50" height="100" fill="currentColor" />
		</pattern>
		<pattern id="bg--chevron--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="1" height="0.5" viewBox="0 0 100 100">
			<path d="M0 0 L50 50 L100 0 L100 30 L50 80 L0 30 Z" fill="currentColor" />
		</pattern>
		<pattern id="bg--diagonal_split--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 100 100">
			<path d="M0 0 L100 100 L100 0 Z" fill="currentColor" />
		</pattern>
		<pattern id="bg--quarters--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 100 100">
			<rect x="0" y="0" width="50" height="50" fill="currentColor" />
			<rect x="50" y="50" width="50" height="50" fill="currentColor" />
		</pattern>
		<pattern id="bg--rays--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 100 100">
			<path d="M50 50 L0 0 L20 0 Z M50 50 L40 0 L60 0 Z M50 50 L80 0 L100 0 Z M50 50 L100 40 L100 60 Z M50 50 L100 80 L80 100 Z M50 50 L60 100 L40 100 Z M50 50 L20 100 L0 100 Z M50 50 L0 60 L0 40 Z" fill="currentColor" />
		</pattern>
		<pattern id="bg--scales--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="0.2" height="0.2" viewBox="0 0 100 100">
			<path d="M0 50 Q 50 0 100 50 Q 50 100 0 50" fill="none" stroke="currentColor" stroke-width="10" />
		</pattern>
		<pattern id="bg--starfield--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="0.3" height="0.3" viewBox="0 0 100 100">
			<circle cx="50" cy="50" r="10" fill="currentColor" />
			<circle cx="10" cy="10" r="4" fill="currentColor" />
		</pattern>

		<pattern id="bg--nebula--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="1" height="1" viewBox="0 0 100 100">
			<rect width="100" height="100" fill="currentColor" opacity="0.3" />
			<circle cx="30" cy="30" r="40" fill="white" opacity="0.1">
				<animate attributeName="r" values="30;45;30" dur="5s" repeatCount="indefinite" />
			</circle>
			<circle cx="70" cy="70" r="30" fill="white" opacity="0.05" />
		</pattern>

		<pattern id="bg--circuit--pattern" patternUnits="objectBoundingBox" patternContentUnits="objectBoundingBox" width="0.25" height="0.25" viewBox="0 0 100 100">
			<path d="M10 10 H90 V90 H10 Z M50 10 V90 M10 50 H90" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5" />
			<circle cx="10" cy="10" r="3" fill="currentColor" />
			<circle cx="90" cy="90" r="3" fill="currentColor" />
		</pattern>

		<filter id="fx--glow">
			<feGaussianBlur stdDeviation="2" result="blur" />
			<feComposite in="SourceGraphic" in2="blur" operator="over" />
		</filter>

		<filter id="fx--smoke" x="-20%" y="-20%" width="140%" height="140%">
			<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" result="noise" />
			<feDisplacementMap in="SourceGraphic" in2="noise" scale="5" />
		</filter>
	</defs>

	<path d={escudoPath} fill="black" opacity="0.3" transform="translate(0, 3)" />
	<path d={escudoPath} fill="var(--cor-pri)" />

	<g clip-path="url(#clip-escudo)">
		{#if customUrl}
			<image href={customUrl} x="0" y="0" width="96" height="104" preserveAspectRatio="xMidYMid slice" />
		{:else if getLayer('background') !== 'bg.solid'}
			<path
				d={escudoPath}
				fill="url(#{sid(getLayer('background'))}--pattern)"
				style:color="var(--cor-sec)"
				opacity="0.4"
			/>
		{/if}

		{#if !customUrl && getLayer('symbol') !== 'symbol.blank'}
			{@const slug = getLayer('symbol').split('.')[1]}
			{@const mapping = {
				'sword': 'sword-hilt',
				'bow': 'bow-arrow',
				'potion': 'potion-ball',
				'scroll': 'scroll-unfurled',
				'dragon': 'dragon-head',
				'griffin': 'griffin-symbol',
				'kraken': 'kraken-tentacle',
				'reaper': 'reaper-scythe'
			}}
			{@const fileName = (mapping as any)[slug] || slug}
			{@const existingIcons = [
				'axe', 'hydra', 'portal', 'shield', 'phoenix', 'unicorn', 'behemoth', 'crossbow',
				'fireball', 'ice-bolt', 'bow-arrow', 'evil-book', 'leviathan', 'battle-axe',
				'broadsword', 'crown-coin', 'heavy-helm', 'holy-grail', 'rune-stone', 'skull-mask',
				'sword-hilt', 'angel-wings', 'breastplate', 'dragon-head', 'gem-pendant',
				'mailed-fist', 'medusa-head', 'potion-ball', 'spiked-mace', 'crystal-ball',
				'monervas-owl', 'skeleton-key', 'treasure-map', 'reaper-scythe', 'griffin-symbol',
				'kraken-tentacle', 'lightning-storm', 'scroll-unfurled'
			]}
			<g transform="translate(48, 52) scale({symbolScale}) translate(-24, -24)">
				{#if existingIcons.includes(fileName)}
					<image
						href="/icons/{fileName}.png"
						width="48" height="48"
						style:filter="brightness(0) invert(1) drop-shadow(0 2px 2px rgba(0,0,0,0.5))"
					/>
				{:else}
					<use
						href="{spriteUrl}#{sid(getLayer('symbol'))}"
						width="48" height="48"
						fill="var(--cor-det)"
						style:filter="drop-shadow(0 2px 2px rgba(0,0,0,0.5))"
					/>
				{/if}
			</g>
		{/if}

		{#if !customUrl && getLayer('effect') !== 'effect.none'}
			{@const fxId = sid(getLayer('effect'))}
			{#if fxId === 'effect--glow'}
				<path d={escudoPath} fill="none" stroke="var(--cor-det)" stroke-width="4" opacity="0.3" filter="url(#fx--glow)" />
			{:else if fxId === 'effect--smoke'}
				<path d={escudoPath} fill="var(--cor-det)" opacity="0.2" filter="url(#fx--smoke)" />
			{:else if ['effect--flames', 'effect--sparks', 'effect--embers', 'effect--frost'].includes(fxId)}
				<rect width="96" height="104" fill="url(#brilho-vidro)" opacity="0.5" />
				<!-- Simulação visual para efeitos pagos enquanto não há assets dedicados -->
				<path d={escudoPath} fill="none" stroke="var(--cor-det)" stroke-width="2" stroke-dasharray="2 4" opacity="0.5" />
			{/if}
		{/if}

		<path d={escudoPath} fill="url(#brilho-vidro)" pointer-events="none" />
	</g>

	{#if borderStyle}
		<path
			d={escudoPath}
			fill="none"
			stroke="url(#grad-ouro)"
			stroke-width={borderStyle.width}
			stroke-dasharray={borderStyle.dasharray}
			stroke-linecap={borderStyle.linecap ?? 'butt'}
		/>
	{:else}
		<!-- Moldura base quando não há borda escolhida -->
		<path d={escudoPath} fill="none" stroke="url(#grad-ouro)" stroke-width="2.5" />
	{/if}

	<path d={escudoPath} fill="none" stroke="rgba(255,255,255,0.2)" stroke-width="0.5" transform="translate(0.5, 0.5)" />

	{#if tag}
		<text x="48" y="32" text-anchor="middle" class="tag">{tag}</text>
	{/if}
</svg>

<style>
	.brasao {
		display: block;
		--or: #d4af37;
	}

	.brasao.vago {
		opacity: 0.32;
	}

	.tag {
		font-family: var(--display);
		font-size: 18px;
		font-weight: 600;
		fill: var(--or);
		letter-spacing: 0.04em;
		text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
	}
</style>
