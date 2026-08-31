/**
 * Definição das cores das paletas do catálogo (fase 06).
 * Mantido aqui para evitar carregar um JSON gigante só para cores hex.
 */
export const PALETAS: Record<string, { primária: string; secundária: string; detalhe: string }> = {
	'palette.slate': { primária: '#2b2136', secundária: '#1a1422', detalhe: '#a5a0af' },
	'palette.ember': { primária: '#4a1c1c', secundária: '#2a0e0e', detalhe: '#ff4d4d' },
	'palette.forest': { primária: '#1c3a1c', secundária: '#0e1d0e', detalhe: '#4dff4d' },
	'palette.ocean': { primária: '#1c1c4a', secundária: '#0e0e2d', detalhe: '#4d4dff' },
	'palette.sand': { primária: '#4a4a1c', secundária: '#2a2a0e', detalhe: '#ffff4d' },
	'palette.plum': { primária: '#3a1c3a', secundária: '#1d0e1d', detalhe: '#ff4dff' },
	'palette.crimson_black': { primária: '#600', secundária: '#000', detalhe: '#f00' },
	'palette.gold_navy': { primária: '#001f3f', secundária: '#000a1a', detalhe: '#ffca28' },
	'palette.emerald_ivory': { primária: '#004d40', secundária: '#f5f5f0', detalhe: '#00c853' },
	'palette.royal_gold': { primária: '#3d2b1f', secundária: '#1a110a', detalhe: '#ffd700' },
	'palette.void_neon': { primária: '#0a0a0a', secundária: '#000', detalhe: '#00f2ff' }
};

export const FALLBACK_PALETTE = PALETAS['palette.slate'];
