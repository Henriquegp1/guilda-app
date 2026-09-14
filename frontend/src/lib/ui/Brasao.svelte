<script lang="ts">
    import { base } from '$app/paths';
    import { assetsById } from '$lib/catalog';
    import { PALETAS, FALLBACK_PALETTE } from './paletas';
    import type { EmblemLayers } from '$lib/api';

    let {
        tag = '',
        tamanho = 96,
        layers,
        customUrl,
        progressionFrame
    }: {
        tag?: string;
        tamanho?: number;
        layers?: Partial<EmblemLayers>;
        customUrl?: string | null;
        progressionFrame?: string;
    } = $props();

    // =========================================================
    // FALLBACKS
    // =========================================================

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

        if ($assetsById.size > 0 && !$assetsById.has(id)) {
            return FALLBACKS[l];
        }

        return id;
    };

    const paletaId = $derived(getLayer('palette'));
    const cores = $derived(PALETAS[paletaId] || FALLBACK_PALETTE);

    const sid = (id: string) => id.replace('.', '--');

    // =========================================================
    // IDENTIDADE DA INSTÂNCIA
    //
    // Usamos um identificador baseado nos dados do brasão para
    // evitar conflitos entre defs quando vários brasões aparecem
    // na mesma página.
    // =========================================================

    const hashString = (value: string) => {
        let hash = 0;

        for (let i = 0; i < value.length; i++) {
            hash = ((hash << 5) - hash) + value.charCodeAt(i);
            hash |= 0;
        }

        return Math.abs(hash).toString(36);
    };

    const instanceId = $derived(
        `emblem-${hashString(
            `${tag}|${tamanho}|${progressionFrame ?? ''}|${getLayer('shape')}|${getLayer('palette')}`
        )}`
    );

    // =========================================================
    // URL DO CATÁLOGO / ÍCONES
    // =========================================================

    const getExtensionRoot = () => {
        if (typeof window === 'undefined') return '';

        const p = window.location.pathname;

        const secondLastSlash = p.lastIndexOf(
            '/',
            p.lastIndexOf('/') - 1
        );

        return p.substring(0, secondLastSlash);
    };

    const getCatalogUrl = () => {
        if (typeof window === 'undefined') {
            return 'catalog.svg';
        }

        return `${window.location.origin}${getExtensionRoot()}/catalog.svg`;
    };

    const spriteUrl = $derived(getCatalogUrl());

    const getIconUrl = (name: string) => {
        if (typeof window === 'undefined') return '';

        return `${window.location.origin}${getExtensionRoot()}/icons/${name}.png`;
    };

    // =========================================================
    // SHAPES
    // =========================================================

    const SHAPE_PATHS: Record<string, string> = {
        'shape.heater':
            'M8 6 H88 V44 C88 74 68 88 48 98 C28 88 8 74 8 44 Z',

        'shape.round':
            'M48 6 C24 6 8 26 8 52 C8 78 24 98 48 98 C72 98 88 78 88 52 C88 26 72 6 48 6 Z',

        'shape.square':
            'M8 6 H88 V90 H8 Z',

        'shape.pointed':
            'M8 6 H88 V60 L48 98 L8 60 Z',

        'shape.kite':
            'M48 6 L88 44 L48 98 L8 44 Z',

        'shape.lozenge':
            'M48 8 L88 52 L48 96 L8 52 Z',

        'shape.banner':
            'M8 6 H88 V82 L48 98 L8 82 Z'
    };

    const shapeId = $derived(getLayer('shape'));

    const escudoPath = $derived(
        SHAPE_PATHS[shapeId] || SHAPE_PATHS['shape.heater']
    );

    // =========================================================
    // GEOMETRIA DA MOLDURA
    //
    // Cada shape possui uma configuração própria.
    //
    // A moldura externa continua sendo desenhada pelo próprio
    // escudoPath, enquanto os ornamentos são posicionados de
    // acordo com a geometria do shape.
    // =========================================================

    type ShapeFrameGeometry = {
        topY: number;
        topWidth: number;
        sideY: number;
        sideScale: number;
        topScale: number;
    };

    const SHAPE_FRAME_GEOMETRY: Record<string, ShapeFrameGeometry> = {
        'shape.heater': {
            topY: 6,
            topWidth: 58,
            sideY: 52,
            sideScale: 1,
            topScale: 1
        },

        'shape.round': {
            topY: 7,
            topWidth: 50,
            sideY: 52,
            sideScale: 0.82,
            topScale: 0.9
        },

        'shape.square': {
            topY: 0,
            topWidth: 58,
            sideY: 48,
            sideScale: 1,
            topScale: 1
        },

        'shape.pointed': {
            topY: 0,
            topWidth: 58,
            sideY: 48,
            sideScale: 0.95,
            topScale: 1
        },

        'shape.kite': {
            topY: 11,
            topWidth: 42,
            sideY: 46,
            sideScale: 0.68,
            topScale: 0.85
        },

        'shape.lozenge': {
            topY: 11,
            topWidth: 38,
            sideY: 52,
            sideScale: 0.62,
            topScale: 0.8
        },

        'shape.banner': {
            topY: 1,
            topWidth: 58,
            sideY: 46,
            sideScale: 0.95,
            topScale: 1
        }
    };

    const frameGeometry = $derived(
        SHAPE_FRAME_GEOMETRY[shapeId] ||
        SHAPE_FRAME_GEOMETRY['shape.heater']
    );

    // =========================================================
    // SÍMBOLO
    // =========================================================

    const symbolScale = $derived(
        ['shape.kite', 'shape.lozenge'].includes(shapeId)
            ? 0.72
            : 0.85
    );

    // =========================================================
    // BORDER
    // =========================================================

    const BORDER_STROKES: Record<
        string,
        {
            width: number;
            dasharray?: string;
            linecap?: 'round' | 'butt';
        }
    > = {
        'border.plain': {
            width: 4
        },

        'border.rope': {
            width: 5,
            dasharray: '2 2',
            linecap: 'round'
        },

        'border.beaded': {
            width: 3,
            dasharray: '1 4',
            linecap: 'round'
        },

        'border.chain': {
            width: 4,
            dasharray: '8 4'
        },

        'border.laurel': {
            width: 6,
            dasharray: '10 3',
            linecap: 'round'
        },

        'border.runic': {
            width: 4,
            dasharray: '6 2 1 2'
        }
    };

    const borderId = $derived(getLayer('border'));

    const borderStyle = $derived(
        BORDER_STROKES[borderId] ?? null
    );

    // =========================================================
    // PROGRESSION FRAME
    // =========================================================

    const FRAME_COLORS: Record<string, string> = {
        frame_bronze: '#CD7F32',
        frame_silver: '#BDC3C7',
        frame_gold: '#F1C40F',
        frame_platinum: '#3498DB',
        frame_diamond: '#9B59B6',
        frame_legendary: '#F39C12'
    };

    type FrameConfig = {
        stroke: number;
        outerStroke: number;
        ornamentScale: number;
        glow: boolean;
        sides: boolean;
        crystal: boolean;
        crown: boolean;
    };

    const FRAME_CONFIGS: Record<string, FrameConfig> = {
        frame_bronze: {
            stroke: 5,
            outerStroke: 8,
            ornamentScale: 0.62,
            glow: false,
            sides: false,
            crystal: false,
            crown: false
        },

        frame_silver: {
            stroke: 6,
            outerStroke: 9,
            ornamentScale: 0.72,
            glow: false,
            sides: false,
            crystal: false,
            crown: false
        },

        frame_gold: {
            stroke: 7,
            outerStroke: 11,
            ornamentScale: 0.82,
            glow: false,
            sides: true,
            crystal: false,
            crown: false
        },

        frame_platinum: {
            stroke: 8,
            outerStroke: 13,
            ornamentScale: 0.92,
            glow: true,
            sides: true,
            crystal: false,
            crown: false
        },

        frame_diamond: {
            stroke: 9,
            outerStroke: 15,
            ornamentScale: 1,
            glow: true,
            sides: true,
            crystal: true,
            crown: false
        },

        frame_legendary: {
            stroke: 10,
            outerStroke: 17,
            ornamentScale: 1.08,
            glow: true,
            sides: true,
            crystal: true,
            crown: true
        }
    };

    const frameConfig = $derived(
        progressionFrame
            ? FRAME_CONFIGS[progressionFrame]
            : null
    );

    const frameColor = $derived(
        progressionFrame
            ? FRAME_COLORS[progressionFrame]
            : null
    );

    // =========================================================
    // ÍCONES
    // =========================================================

    const SYMBOL_MAPPING: Record<string, string> = {
        sword: 'sword-hilt',
        dagger: 'sword-hilt',
        spear: 'sword-hilt',

        hammer: 'battle-axe',
        mace: 'spiked-mace',
        staff: 'spiked-mace',

        wand: 'potion-ball',
        torch: 'fireball',
        lantern: 'crystal-ball',

        scroll: 'scroll-unfurled',
        potion: 'potion-ball',
        gem: 'gem-pendant',
        key: 'skeleton-key',

        flag: 'shield',

        eagle: 'angel-wings',
        falcon: 'angel-wings',
        seraph: 'angel-wings',

        wolf: 'skull-mask',
        bear: 'skull-mask',
        boar: 'skull-mask',
        cerberus: 'skull-mask',
        chimera: 'skull-mask',
        basilisk: 'skull-mask',
        minotaur: 'skull-mask',

        dragon: 'dragon-head',
        wyrm: 'dragon-head',

        griffin: 'griffin-symbol',
        kraken: 'kraken-tentacle',
        reaper: 'reaper-scythe',

        colossus: 'mailed-fist',
        titan: 'mailed-fist'
    };

    const VERIFIED_ICONS = new Set([
        'axe',
        'hydra',
        'portal',
        'shield',
        'phoenix',
        'unicorn',
        'behemoth',
        'crossbow',
        'fireball',
        'ice-bolt',
        'bow-arrow',
        'evil-book',
        'leviathan',
        'battle-axe',
        'broadsword',
        'crown-coin',
        'heavy-helm',
        'holy-grail',
        'rune-stone',
        'skull-mask',
        'sword-hilt',
        'angel-wings',
        'breastplate',
        'dragon-head',
        'gem-pendant',
        'mailed-fist',
        'medusa-head',
        'potion-ball',
        'spiked-mace',
        'crystal-ball',
        'monervas-owl',
        'skeleton-key',
        'treasure-map',
        'reaper-scythe',
        'griffin-symbol',
        'kraken-tentacle',
        'lightning-storm',
        'scroll-unfurled'
    ]);

    // =========================================================
    // DEBUG
    // =========================================================

    $effect(() => {
        if (tag) {
            console.log(
                '[Guilda] Renderizando brasão:',
                tag,
                '| shape:',
                shapeId,
                '| frame:',
                progressionFrame,
                '| tamanho:',
                tamanho,
                '| base:',
                base
            );
        }
    });
</script>

<svg
    class="brasao"
    viewBox="-25 -45 146 165"
    width={tamanho}
    height={tamanho * (165 / 146)}
    role="img"
    class:vago={!tag && !layers}
    aria-label={tag ? `Brasão da guilda ${tag}` : 'Escudo heráldico'}
    style:--cor-pri={cores.primária}
    style:--cor-sec={cores.secundária}
    style:--cor-det={cores.detalhe}
>
    <defs>

        <!-- =====================================================
             CLIP DO ESCUDO
        ====================================================== -->

        <clipPath id={`${instanceId}-clip-escudo`}>
            <path d={escudoPath} />
        </clipPath>

        <!-- =====================================================
             GRADIENTES
        ====================================================== -->

        <linearGradient
            id={`${instanceId}-grad-ouro`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
        >
            <stop offset="0%" stop-color="#BF953F" />
            <stop offset="50%" stop-color="#FCF6BA" />
            <stop offset="100%" stop-color="#AA771C" />
        </linearGradient>

        <linearGradient
            id={`${instanceId}-grad-legendary`}
            x1="0%"
            y1="0%"
            x2="100%"
            y2="100%"
        >
            <stop offset="0%" stop-color="#FFD700" />
            <stop offset="50%" stop-color="#FFFFFF" />
            <stop offset="100%" stop-color="#FFD700" />

            <animate
                attributeName="x1"
                values="0%;100%;0%"
                dur="3s"
                repeatCount="indefinite"
            />
        </linearGradient>

        <linearGradient
            id={`${instanceId}-brilho-vidro`}
            x1="0%"
            y1="0%"
            x2="0%"
            y2="100%"
        >
            <stop
                offset="0%"
                stop-color="white"
                stop-opacity="0.2"
            />

            <stop
                offset="100%"
                stop-color="black"
                stop-opacity="0.1"
            />
        </linearGradient>

        <!-- =====================================================
             GLOW
        ====================================================== -->

        <filter
            id={`${instanceId}-fx-glow`}
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
        >
            <feGaussianBlur
                stdDeviation="3"
                result="blur"
            />

            <feComposite
                in="SourceGraphic"
                in2="blur"
                operator="over"
            />
        </filter>

        <filter
            id={`${instanceId}-fx-glow-strong`}
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
        >
            <feGaussianBlur
                stdDeviation="5"
                result="blur"
            />

            <feComposite
                in="SourceGraphic"
                in2="blur"
                operator="over"
            />
        </filter>

        <!-- =====================================================
             SMOKE
        ====================================================== -->

        <filter
            id={`${instanceId}-fx-smoke`}
            x="-20%"
            y="-20%"
            width="140%"
            height="140%"
        >
            <feTurbulence
                type="fractalNoise"
                baseFrequency="0.05"
                numOctaves="3"
                result="noise"
            />

            <feDisplacementMap
                in="SourceGraphic"
                in2="noise"
                scale="5"
            />
        </filter>

        <!-- =====================================================
             BACKGROUND PATTERNS
        ====================================================== -->

        <pattern
            id={`${instanceId}-bg-checker-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="0.2"
            height="0.2"
            viewBox="0 0 100 100"
        >
            <rect
                x="0"
                y="0"
                width="50"
                height="50"
                fill="currentColor"
            />

            <rect
                x="50"
                y="50"
                width="50"
                height="50"
                fill="currentColor"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-stripes-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="1"
            height="0.2"
            viewBox="0 0 100 100"
        >
            <rect
                x="0"
                y="0"
                width="100"
                height="50"
                fill="currentColor"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-split-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="1"
            height="1"
            viewBox="0 0 100 100"
        >
            <rect
                x="50"
                y="0"
                width="50"
                height="100"
                fill="currentColor"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-chevron-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="1"
            height="0.5"
            viewBox="0 0 100 100"
        >
            <path
                d="M0 0 L50 50 L100 0 L100 30 L50 80 L0 30 Z"
                fill="currentColor"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-diagonal-split-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="1"
            height="1"
            viewBox="0 0 100 100"
        >
            <path
                d="M0 0 L100 100 L100 0 Z"
                fill="currentColor"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-quarters-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="1"
            height="1"
            viewBox="0 0 100 100"
        >
            <rect
                x="0"
                y="0"
                width="50"
                height="50"
                fill="currentColor"
            />

            <rect
                x="50"
                y="50"
                width="50"
                height="50"
                fill="currentColor"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-rays-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="1"
            height="1"
            viewBox="0 0 100 100"
        >
            <path
                d="
                    M50 50 L0 0 L20 0 Z
                    M50 50 L40 0 L60 0 Z
                    M50 50 L80 0 L100 0 Z
                    M50 50 L100 40 L100 60 Z
                    M50 50 L100 80 L80 100 Z
                    M50 50 L60 100 L40 100 Z
                    M50 50 L20 100 L0 100 Z
                    M50 50 L0 60 L0 40 Z
                "
                fill="currentColor"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-scales-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="0.2"
            height="0.2"
            viewBox="0 0 100 100"
        >
            <path
                d="M0 50 Q50 0 100 50 Q50 100 0 50"
                fill="none"
                stroke="currentColor"
                stroke-width="10"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-starfield-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="0.3"
            height="0.3"
            viewBox="0 0 100 100"
        >
            <circle
                cx="50"
                cy="50"
                r="10"
                fill="currentColor"
            />

            <circle
                cx="10"
                cy="10"
                r="4"
                fill="currentColor"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-nebula-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="1"
            height="1"
            viewBox="0 0 100 100"
        >
            <rect
                width="100"
                height="100"
                fill="currentColor"
                opacity="0.3"
            />

            <circle
                cx="30"
                cy="30"
                r="40"
                fill="white"
                opacity="0.1"
            >
                <animate
                    attributeName="r"
                    values="30;45;30"
                    dur="5s"
                    repeatCount="indefinite"
                />
            </circle>

            <circle
                cx="70"
                cy="70"
                r="30"
                fill="white"
                opacity="0.05"
            />
        </pattern>

        <pattern
            id={`${instanceId}-bg-circuit-pattern`}
            patternUnits="objectBoundingBox"
            patternContentUnits="objectBoundingBox"
            width="0.25"
            height="0.25"
            viewBox="0 0 100 100"
        >
            <path
                d="
                    M10 10 H90 V90 H10 Z
                    M50 10 V90
                    M10 50 H90
                "
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                opacity="0.5"
            />

            <circle
                cx="10"
                cy="10"
                r="3"
                fill="currentColor"
            />

            <circle
                cx="90"
                cy="90"
                r="3"
                fill="currentColor"
            />
        </pattern>
    </defs>

    <!-- =========================================================
         SOMBRA DO ESCUDO
    ========================================================== -->

    <path
        d={escudoPath}
        fill="black"
        opacity="0.35"
        transform="translate(0, 3)"
    />

    <!-- =========================================================
         PROGRESSION FRAME
    ========================================================== -->

    {#if progressionFrame && frameConfig && frameColor}

        <g
            class="progression-frame"
            style:color={frameColor}
            pointer-events="none"
        >

            <!-- =================================================
                 AURA
            ================================================== -->

            {#if frameConfig.glow}

                <path
                    d={escudoPath}
                    fill="none"
                    stroke="currentColor"
                    stroke-width={frameConfig.outerStroke + 5}
                    opacity="0.22"
                    filter={`url(#${instanceId}-fx-glow-strong)`}
                />

            {/if}

            <!-- =================================================
                 CONTORNO EXTERNO
            ================================================== -->

            <path
                d={escudoPath}
                fill="none"
                stroke="rgba(0,0,0,0.65)"
                stroke-width={frameConfig.outerStroke + 3}
                stroke-linejoin="round"
            />

            <!-- =================================================
                 MOLDURA PRINCIPAL
            ================================================== -->

            <path
                d={escudoPath}
                fill="none"
                stroke="currentColor"
                stroke-width={frameConfig.outerStroke}
                stroke-linejoin="round"
            />

            <!-- =================================================
                 BRILHO DA MOLDURA
            ================================================== -->

            <path
                d={escudoPath}
                fill="none"
                stroke="white"
                stroke-width="1.5"
                stroke-linejoin="round"
                opacity="0.38"
            />

            <!-- =================================================
                 ORNAMENTO SUPERIOR
            ================================================== -->

            <g
                transform={`
                    translate(48 ${frameGeometry.topY})
                    scale(${frameConfig.ornamentScale * frameGeometry.topScale})
                `}
            >

                {#if progressionFrame === 'frame_bronze'}

                    <!-- Bronze: uma pequena ponta -->
                    <path
                        d="
                            M-24 2
                            L-12 -8
                            L0 -28
                            L12 -8
                            L24 2
                            Z
                        "
                        fill="currentColor"
                        stroke="rgba(0,0,0,0.55)"
                        stroke-width="1.5"
                        stroke-linejoin="round"
                    />

                    <path
                        d="M0 -24 L0 -5"
                        stroke="white"
                        stroke-width="1"
                        opacity="0.3"
                    />

                {:else if progressionFrame === 'frame_silver'}

                    <!-- Silver: crista dupla -->
                    <path
                        d="
                            M-30 3
                            L-20 -10
                            L-8 -7
                            L0 -30
                            L8 -7
                            L20 -10
                            L30 3
                            Z
                        "
                        fill="currentColor"
                        stroke="rgba(0,0,0,0.5)"
                        stroke-width="1.5"
                        stroke-linejoin="round"
                    />

                    <path
                        d="
                            M0 -26
                            L-5 -9
                            M0 -26
                            L5 -9
                        "
                        stroke="white"
                        stroke-width="1.5"
                        opacity="0.4"
                    />

                {:else if progressionFrame === 'frame_gold'}

                    <!-- Gold: asas -->
                    <path
                        d="
                            M-38 5
                            L-52 -10
                            L-25 -6
                            L-12 -18
                            L0 -36
                            L12 -18
                            L25 -6
                            L52 -10
                            L38 5
                            L18 0
                            L0 -20
                            L-18 0
                            Z
                        "
                        fill="currentColor"
                        stroke="rgba(0,0,0,0.55)"
                        stroke-width="1.5"
                        stroke-linejoin="round"
                    />

                    <path
                        d="
                            M-42 -7 L-20 -2
                            M42 -7 L20 -2
                            M0 -30 L0 -12
                        "
                        stroke="white"
                        stroke-width="1.5"
                        opacity="0.35"
                    />

                {:else if progressionFrame === 'frame_platinum'}

                    <!-- Platinum: armadura -->
                    <path
                        d="
                            M-46 7
                            L-62 -12
                            L-35 -7
                            L-19 -17
                            L0 -43
                            L19 -17
                            L35 -7
                            L62 -12
                            L46 7
                            L25 1
                            L0 -25
                            L-25 1
                            Z
                        "
                        fill="currentColor"
                        stroke="rgba(0,0,0,0.55)"
                        stroke-width="2"
                        stroke-linejoin="round"
                    />

                    <path
                        d="
                            M-50 -8 L-29 -3
                            M50 -8 L29 -3
                            M0 -37 L0 -12
                        "
                        stroke="white"
                        stroke-width="2"
                        opacity="0.4"
                    />

                {:else if progressionFrame === 'frame_diamond'}

                    <!-- Diamond: cristal -->
                    <g filter={`url(#${instanceId}-fx-glow)`}>

                        <path
                            d="
                                M-50 7
                                L-68 -9
                                L-38 -4
                                L-18 -15
                                L0 -50
                                L18 -15
                                L38 -4
                                L68 -9
                                L50 7
                                L24 0
                                L0 -30
                                L-24 0
                                Z
                            "
                            fill="currentColor"
                            stroke="rgba(0,0,0,0.55)"
                            stroke-width="2"
                            stroke-linejoin="round"
                        />

                        <!-- cristal central -->
                        <path
                            d="
                                M0 -45
                                L10 -28
                                L0 -13
                                L-10 -28
                                Z
                            "
                            fill="white"
                            opacity="0.38"
                        />

                        <path
                            d="
                                M-56 -7 L-32 -2
                                M56 -7 L32 -2
                            "
                            stroke="white"
                            stroke-width="2"
                            opacity="0.5"
                        />

                    </g>

                {:else if progressionFrame === 'frame_legendary'}

                    <!-- Legendary: coroa -->
                    <g filter={`url(#${instanceId}-fx-glow-strong)`}>

                        <path
                            d="
                                M-55 9
                                L-75 -7
                                L-43 -2
                                L-23 -15
                                L0 -58
                                L23 -15
                                L43 -2
                                L75 -7
                                L55 9
                                L29 2
                                L0 -34
                                L-29 2
                                Z
                            "
                            fill="url(#${instanceId}-grad-legendary)"
                            stroke="rgba(0,0,0,0.65)"
                            stroke-width="2"
                            stroke-linejoin="round"
                        />

                        <!-- Cristal central -->
                        <path
                            d="
                                M0 -53
                                L11 -34
                                L0 -17
                                L-11 -34
                                Z
                            "
                            fill="white"
                            opacity="0.6"
                        />

                        <!-- Cristais laterais -->
                        <path
                            d="
                                M-61 -5
                                L-50 -13
                                L-43 -1
                                L-54 6
                                Z
                            "
                            fill="white"
                            opacity="0.45"
                        />

                        <path
                            d="
                                M61 -5
                                L50 -13
                                L43 -1
                                L54 6
                                Z
                            "
                            fill="white"
                            opacity="0.45"
                        />

                        <!-- brilho central -->
                        <circle
                            cy="-54"
                            r="4"
                            fill="white"
                        >
                            <animate
                                attributeName="opacity"
                                values="0.25;1;0.25"
                                dur="1.5s"
                                repeatCount="indefinite"
                            />

                            <animate
                                attributeName="r"
                                values="3;5;3"
                                dur="1.5s"
                                repeatCount="indefinite"
                            />
                        </circle>

                    </g>

                {/if}

            </g>

            <!-- =================================================
                 ORNAMENTOS LATERAIS
            ================================================== -->

            {#if frameConfig.sides}

                <g
                    transform={`
                        translate(48 ${frameGeometry.sideY})
                        scale(${frameGeometry.sideScale})
                    `}
                >

                    <!-- esquerda -->
                    <path
                        d="
                            M-39 -8
                            L-52 0
                            L-39 8
                            L-31 0
                            Z
                        "
                        fill="currentColor"
                        stroke="rgba(0,0,0,0.5)"
                        stroke-width="1.5"
                    />

                    <!-- direita -->
                    <path
                        d="
                            M39 -8
                            L52 0
                            L39 8
                            L31 0
                            Z
                        "
                        fill="currentColor"
                        stroke="rgba(0,0,0,0.5)"
                        stroke-width="1.5"
                    />

                    {#if frameConfig.crystal}

                        <path
                            d="
                                M-57 0
                                L-49 -7
                                L-42 0
                                L-49 7
                                Z
                            "
                            fill="white"
                            opacity="0.5"
                        />

                        <path
                            d="
                                M57 0
                                L49 -7
                                L42 0
                                L49 7
                                Z
                            "
                            fill="white"
                            opacity="0.5"
                        />

                    {/if}

                </g>

            {/if}

            <!-- =================================================
                 LINHA DE BASE DA MOLDURA
            ================================================== -->

            {#if frameConfig.crystal}

                <path
                    d={escudoPath}
                    fill="none"
                    stroke="white"
                    stroke-width="1"
                    stroke-dasharray="2 4"
                    opacity="0.35"
                />

            {/if}

            <!-- =================================================
                 EFEITO LEGENDARY
            ================================================== -->

            {#if frameConfig.crown}

                <path
                    d={escudoPath}
                    fill="none"
                    stroke="white"
                    stroke-width="2"
                    opacity="0.45"
                >
                    <animate
                        attributeName="stroke-opacity"
                        values="0.15;0.7;0.15"
                        dur="2s"
                        repeatCount="indefinite"
                    />
                </path>

            {/if}

        </g>

    {/if}

    <!-- =========================================================
         FUNDO PRINCIPAL DO ESCUDO
    ========================================================== -->

    <path
        d={escudoPath}
        fill="var(--cor-pri)"
    />

    <!-- =========================================================
         CONTEÚDO DO ESCUDO
    ========================================================== -->

    <g clip-path={`url(#${instanceId}-clip-escudo)`}>

        <!-- CUSTOM IMAGE -->

        {#if customUrl}

            <image
                href={customUrl}
                x="0"
                y="0"
                width="96"
                height="104"
                preserveAspectRatio="xMidYMid slice"
            />

        {:else if getLayer('background') !== 'bg.solid'}

            <!-- BACKGROUND PATTERN -->

            <path
                d={escudoPath}
                fill={`url(#${instanceId}-${sid(getLayer('background'))}-pattern)`}
                style:color="var(--cor-sec)"
                opacity="0.4"
            />

        {/if}

        <!-- =====================================================
             SÍMBOLO
        ====================================================== -->

        {#if !customUrl && getLayer('symbol') !== 'symbol.blank'}

            {@const symbolId = getLayer('symbol')}
            {@const slug = symbolId.split('.')[1] || ''}
            {@const fileName = SYMBOL_MAPPING[slug] || slug}

            <g
                transform={`
                    translate(48,52)
                    scale(${symbolScale})
                    translate(-24,-24)
                `}
            >

                {#if VERIFIED_ICONS.has(fileName)}

                    <image
                        href={getIconUrl(fileName)}
                        width="48"
                        height="48"
                        style:filter="brightness(0) invert(1) drop-shadow(0 2px 2px rgba(0,0,0,0.5))"
                    />

                {:else}

                    <use
                        href={`${spriteUrl}#${sid(symbolId)}`}
                        width="48"
                        height="48"
                        fill="var(--cor-det)"
                    />

                {/if}

            </g>

        {/if}

        <!-- =====================================================
             EFEITOS
        ====================================================== -->

        {#if !customUrl && getLayer('effect') !== 'effect.none'}

            {@const fxId = sid(getLayer('effect'))}

            {#if fxId === 'effect--glow'}

                <path
                    d={escudoPath}
                    fill="none"
                    stroke="var(--cor-det)"
                    stroke-width="4"
                    opacity="0.3"
                    filter={`url(#${instanceId}-fx-glow)`}
                />

            {:else if fxId === 'effect--smoke'}

                <path
                    d={escudoPath}
                    fill="var(--cor-det)"
                    opacity="0.2"
                    filter={`url(#${instanceId}-fx-smoke)`}
                />

            {:else if [
                'effect--flames',
                'effect--sparks',
                'effect--embers',
                'effect--frost'
            ].includes(fxId)}

                <rect
                    width="96"
                    height="104"
                    fill={`url(#${instanceId}-brilho-vidro)`}
                    opacity="0.5"
                />

                <path
                    d={escudoPath}
                    fill="none"
                    stroke="var(--cor-det)"
                    stroke-width="2"
                    stroke-dasharray="2 4"
                    opacity="0.5"
                />

            {/if}

        {/if}

        <!-- =====================================================
             BRILHO INTERNO
        ====================================================== -->

        <path
            d={escudoPath}
            fill={`url(#${instanceId}-brilho-vidro)`}
            pointer-events="none"
        />

    </g>

    <!-- =========================================================
         BORDA DO BRASÃO
    ========================================================== -->

    {#if borderStyle}

        <path
            d={escudoPath}
            fill="none"
            stroke={`url(#${instanceId}-grad-ouro)`}
            stroke-width={borderStyle.width}
            stroke-dasharray={borderStyle.dasharray}
            stroke-linecap={borderStyle.linecap ?? 'butt'}
            stroke-linejoin="round"
        />

    {:else}

        <path
            d={escudoPath}
            fill="none"
            stroke={`url(#${instanceId}-grad-ouro)`}
            stroke-width="2.5"
            stroke-linejoin="round"
        />

    {/if}

    <!-- =========================================================
         HIGHLIGHT FINAL
    ========================================================== -->

    <path
        d={escudoPath}
        fill="none"
        stroke="rgba(255,255,255,0.2)"
        stroke-width="0.7"
        transform="translate(0.5,0.5)"
    />

    <!-- =========================================================
         TAG
    ========================================================== -->

    {#if tag}

        <text
            x="48"
            y="32"
            text-anchor="middle"
            class="tag"
        >
            {tag}
        </text>

    {/if}

</svg>

<style>
    .brasao {
        display: block;
        overflow: visible;
        --or: #d4af37;
    }

    .brasao.vago {
        opacity: 0.32;
    }

    .progression-frame {
        transform-box: fill-box;
        transform-origin: center;
    }

    .tag {
        font-family: var(--display);
        font-size: 18px;
        font-weight: 600;
        fill: var(--or);
        letter-spacing: 0.04em;
        text-shadow:
            0 1px 2px rgba(0, 0, 0, 0.8);
    }
</style>