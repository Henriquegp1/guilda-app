/**
 * Setup do GSAP. Ver docs/MOVIMENTO.md — este arquivo implementa aquele contrato.
 * GSAP entra no bundle porque a CSP da Twitch bloqueia script de CDN.
 */
import { gsap } from 'gsap';
import { Flip } from 'gsap/Flip';

gsap.registerPlugin(Flip);

const calmo = () =>
	typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Com movimento reduzido tudo tem duração zero: o estado final aparece na hora.
 * Nenhum componente pode depender de `onComplete` para gravar estado.
 */
export const dur = (s: number) => (calmo() ? 0 : s);

gsap.defaults({ ease: 'power2.out', duration: dur(0.4) });

export { gsap, Flip };

/**
 * Interpola um número exibido. Usado no placar de guerra, que recebe valores
 * novos por PubSub a cada poucos segundos — sem isso o número salta.
 */
export function animarNumero(
	el: HTMLElement,
	de: number,
	para: number,
	formatar: (n: number) => string = (n) => Math.round(n).toLocaleString('pt-BR')
) {
	const alvo = { v: de };
	return gsap.to(alvo, {
		v: para,
		duration: dur(0.6),
		ease: 'power1.out',
		onUpdate: () => (el.textContent = formatar(alvo.v))
	});
}

/** Captura o estado, deixa o chamador mexer no DOM, anima a diferença. */
export function reordenar(itens: Element[], mutar: () => void) {
	const estado = Flip.getState(itens);
	mutar();
	return Flip.from(estado, {
		duration: dur(0.5),
		ease: 'power2.inOut',
		absolute: true,
		// Linha que entra ou sai não desliza: só aparece. Numa lista de 318px o
		// deslize cruzado vira confusão.
		onEnter: (els) => gsap.fromTo(els, { opacity: 0 }, { opacity: 1, duration: dur(0.3) }),
		onLeave: (els) => gsap.to(els, { opacity: 0, duration: dur(0.2) })
	});
}
