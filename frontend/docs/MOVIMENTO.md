# Movimento — contrato de animação (GSAP)

O equivalente frontend do `docs/EVENTOS.md`: um lugar só que define onde há
animação e onde não há. Sem isto, cinco fases inventam cinco linguagens de
movimento e o painel vira um pisca-pisca de 318px.

GSAP é [gratuito para uso comercial desde 2025](https://gsap.com/community/standard-license/),
plugins inclusos — Flip e SplitText podem ser usados sem custo. Entra no bundle,
nunca por CDN (a CSP da Twitch bloqueia script externo).

## Onde GSAP se paga

Cinco lugares. Cada um resolve um problema que CSS sozinho resolve mal:

| Onde                          | Técnica          | Por que não é só CSS                                                                      |
| ----------------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| Ranking que reordena          | **Flip**         | A posição muda no DOM; Flip anima do estado antigo para o novo sem calcular offsets à mão |
| Barra de XP e subida de nível | timeline         | Encadeamento com pausa e overshoot; e o número precisa contar junto                       |
| Placar de guerra ao vivo      | tween de número  | O valor chega por PubSub a cada poucos segundos; interpolar evita o salto                 |
| Editor de brasão              | timeline curta   | Trocar camada sem piscar, com as 6 camadas em ordem                                       |
| Território conquistado        | timeline no mapa | Um evento raro que merece peso                                                            |

## Onde não há animação

- **Nada anima na primeira pintura.** O painel abre com o conteúdo já lá. Animação
  de entrada custa os primeiros 300ms de um espaço de 318px que o viewer talvez
  olhe por dois segundos.
- **Erro não anima.** Mensagem de falha aparece, ponto.
- **Nada em `width`, `height`, `top` ou `left`.** Só `transform` e `opacity`.
- **Nada em loop infinito.** Isso fica ao lado de uma live e compete com ela.

## Movimento reduzido não é opcional

```js
gsap.ticker.fps(60);
const calmo = matchMedia('(prefers-reduced-motion: reduce)');
gsap.defaults({ duration: calmo.matches ? 0 : 0.4, ease: 'power2.out' });
```

Com `prefers-reduced-motion`, toda animação vira duração zero: o estado final
aparece imediatamente. Nenhum componente pode depender de um `onComplete` para
gravar estado — a UI precisa estar correta mesmo com tudo em 0s.

## Ciclo de vida

Toda tween nasce dentro de um `gsap.context()` e morre no `onDestroy` do
componente. Tween órfã continua rodando depois que o componente sai, e numa
extensão que fica horas aberta isso é vazamento acumulado, não detalhe.

```svelte
<script>
	let raiz;
	$effect(() => {
		const ctx = gsap.context(() => {
			/* tweens aqui */
		}, raiz);
		return () => ctx.revert();
	});
</script>
```

## Orçamento

Painel é 318 × 496 numa aba que já está decodificando vídeo. No máximo **uma**
animação por vez em tela; se duas quiserem rodar juntas, viram uma timeline.
GSAP core + Flip é o que entra no bundle — plugin novo precisa de justificativa
escrita neste arquivo.
