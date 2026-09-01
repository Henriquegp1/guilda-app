<script lang="ts">
	import { onMount } from 'svelte';
	import Estandarte from '$lib/ui/Estandarte.svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import Aba from '$lib/ui/Aba.svelte';
	import Brasao from '$lib/ui/Brasao.svelte';
	import MinhaGuilda from '$lib/telas/MinhaGuilda.svelte';
	import Guildas from '$lib/telas/Guildas.svelte';
	import Ranking from '$lib/telas/Ranking.svelte';
	import Criar from '$lib/telas/Criar.svelte';
	import PainelGuerra from '$lib/telas/PainelGuerra.svelte';
	import MapaMundi from '$lib/telas/MapaMundi.svelte';
	import { iniciar, onAuth } from '$lib/twitch';
	import { entrarBloco } from '$lib/motion';
	import { minhaGuilda, ErroApi, type Guilda, type Cargo } from '$lib/api';

	let { fluido = false } = $props();

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let guilda = $state<(Guilda & { my_role: Cargo }) | null>(null);
	let erro = $state('');
	let aba = $state('minha');

	async function carregar() {
		try {
			guilda = await minhaGuilda();
			estado = 'pronto';
			// Quem não tem guilda começa procurando uma, não numa tela vazia.
			if (!guilda && (aba === 'minha' || aba === 'criar')) aba = 'guildas';
			if (guilda && (aba === 'guildas' || aba === 'criar')) aba = 'minha';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.';
			estado = 'erro';
		}
	}

	onMount(() => {
		iniciar();
		return onAuth(carregar);
	});

	const abas = $derived(
		guilda
			? [
					{ id: 'minha', rotulo: 'Minha' },
					{ id: 'mapa', rotulo: 'Mapa' },
					{ id: 'guerra', rotulo: 'Guerra' },
					{ id: 'ranking', rotulo: 'Ranking' }
				]
			: [
					{ id: 'guildas', rotulo: 'Guildas' },
					{ id: 'mapa', rotulo: 'Mapa' },
					{ id: 'ranking', rotulo: 'Ranking' },
					{ id: 'criar', rotulo: 'Criar' }
				]
	);
</script>

<Estandarte {fluido}>
	{#if estado === 'carregando'}
		<div class="centro" aria-busy="true">
			<Brasao tamanho={88} />
			<p>Carregando</p>
		</div>
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
	{:else}
		<Aba {abas} bind:atual={aba} />

		{#key aba}
			<div class="aba-conteudo" in:entrarBloco>
				{#if aba === 'minha' && guilda}
					<MinhaGuilda {guilda} cargo={guilda.my_role} aoSair={carregar} aoAtualizar={carregar} />
				{:else if aba === 'mapa'}
					<MapaMundi />
				{:else if aba === 'guerra' && guilda}
					<PainelGuerra {guilda} cargo={guilda.my_role} />
				{:else if aba === 'guildas'}
					<Guildas aoEntrar={carregar} />
				{:else if aba === 'ranking'}
					<Ranking minhaGuildaId={guilda?.id ?? null} />
				{:else if aba === 'criar'}
					<Criar aoCriar={carregar} />
				{/if}
			</div>
		{/key}
	{/if}
</Estandarte>

<style>
	.centro {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}

	.centro p {
		margin: 0;
		color: var(--argent-fraco);
	}

	.aba-conteudo {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--or) transparent;
	}

	.aba-conteudo::-webkit-scrollbar {
		width: 4px;
	}

	.aba-conteudo::-webkit-scrollbar-thumb {
		background: var(--or);
		border-radius: 2px;
	}
</style>
