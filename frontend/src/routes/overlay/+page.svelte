<script lang="ts">
	import { onMount } from 'svelte';
	import { iniciar, onAuth, ouvirBroadcast } from '$lib/twitch';
	import { guerrasAtivas, type Guerra } from '$lib/api';
	import { animarNumero, gsap, dur } from '$lib/motion';

	let guerras = $state<Guerra[]>([]);
	let raiz: HTMLDivElement;

	// Guarda o valor exibido para interpolar do anterior, não do zero.
	const exibido = new Map<string, number>();

	function aplicar(novas: Guerra[]) {
		guerras = novas;
	}

	/** Ação Svelte: `update` é o que faz o número interpolar a cada mensagem. */
	function placar(el: HTMLElement, valor: number) {
		const chave = el.dataset.chave!;
		const aplicar = (v: number) => {
			const de = exibido.get(chave);
			exibido.set(chave, v);
			if (de !== undefined && de !== v) animarNumero(el, de, v);
			else el.textContent = v.toLocaleString('pt-BR');
		};
		aplicar(valor);
		return { update: aplicar };
	}

	onMount(() => {
		iniciar();
		const paraAuth = onAuth(() => {
			// PubSub é a fonte viva; o GET é o que segura enquanto ela silencia.
			guerrasAtivas()
				.then((r) => aplicar(r.items))
				.catch(() => {});
		});
		const paraPubSub = ouvirBroadcast<{ type?: string; wars?: Guerra[] }>((m) => {
			if (m?.type === 'war.board' && Array.isArray(m.wars)) aplicar(m.wars);
		});
		return () => {
			paraAuth();
			paraPubSub();
		};
	});

	$effect(() => {
		if (!raiz || !guerras.length) return;
		const ctx = gsap.context(() => {
			gsap.fromTo(
				raiz,
				{ opacity: 0, y: -8 },
				{ opacity: 1, y: 0, duration: dur(0.35) }
			);
		}, raiz);
		return () => ctx.revert();
	});
</script>

{#if guerras.length}
	<div class="tabuleiro" bind:this={raiz}>
		{#each guerras as g (g.id)}
			<div class="guerra">
				<div class="lado">
					<b>{g.challenger.tag}</b>
					<span
						class="num"
						data-chave={`${g.id}-a`}
						use:placar={g.challenger.score}
					></span>
				</div>
				<span class="cruz" aria-label="contra">⚔</span>
				<div class="lado dir">
					<span
						class="num"
						data-chave={`${g.id}-b`}
						use:placar={g.defender.score}
					></span>
					<b>{g.defender.tag}</b>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.tabuleiro {
		position: absolute;
		top: 10px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-direction: column;
		gap: 6px;
		/* Não bloqueia clique no player: o overlay é informação, não controle. */
		pointer-events: none;
	}

	.guerra {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 7px 14px;
		background: rgba(22, 18, 28, 0.86);
		border: 1px solid var(--or);
		border-radius: 2px;
		backdrop-filter: blur(3px);
	}

	.lado {
		display: flex;
		align-items: baseline;
		gap: 8px;
	}

	.lado.dir {
		flex-direction: row;
	}

	b {
		font-family: var(--display);
		font-size: 15px;
		color: var(--argent);
		letter-spacing: 0.05em;
	}

	.num {
		font-size: 17px;
		font-weight: 600;
		color: var(--or);
		min-width: 3ch;
		text-align: center;
	}

	.cruz {
		color: var(--gules);
		font-size: 13px;
	}
</style>
