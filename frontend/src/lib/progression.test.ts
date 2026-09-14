import { describe, it, expect } from 'vitest';

// Simulação da lógica que está no componente MinhaGuilda.svelte
function getProgressionFrame(unlocks: string[]) {
	const frames = [
		'frame_legendary',
		'frame_diamond',
		'frame_platinum',
		'frame_gold',
		'frame_silver',
		'frame_bronze'
	];
	return frames.find((f) => unlocks.includes(f));
}

describe('Lógica de Seleção de Moldura', () => {
	it('seleciona Bronze no nível 10', () => {
		expect(getProgressionFrame(['frame_bronze'])).toBe('frame_bronze');
	});

	it('seleciona Ouro no nível 30 (mesmo tendo Bronze e Prata)', () => {
		const unlocks = ['frame_bronze', 'frame_silver', 'frame_gold'];
		expect(getProgressionFrame(unlocks)).toBe('frame_gold');
	});

	it('seleciona Lendário no nível 50', () => {
		const unlocks = ['frame_bronze', 'frame_silver', 'frame_gold', 'frame_platinum', 'frame_diamond', 'frame_legendary'];
		expect(getProgressionFrame(unlocks)).toBe('frame_legendary');
	});

	it('não retorna nada para nível baixo (sem frames)', () => {
		expect(getProgressionFrame(['description_280', 'palette_6'])).toBeUndefined();
	});
});
