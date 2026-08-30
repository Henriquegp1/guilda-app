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
	import { iniciar, onAuth } from '$lib/twitch';
	import { minhaGuilda, ErroApi, type Guilda, type Cargo } from '$lib/api';

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
					{ id: 'ranking', rotulo: 'Ranking' }
				]
			: [
					{ id: 'guildas', rotulo: 'Guildas' },
					{ id: 'ranking', rotulo: 'Ranking' },
					{ id: 'criar', rotulo: 'Criar' }
				]
	);
</script>

<Estandarte>
	{#if estado === 'carregando'}
		<div class="centro" aria-busy="true">
			<Brasao tamanho={88} />
			<p>Carregando</p>
		</div>
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
	{:else}
		<Aba {abas} bind:atual={aba} />

		{#if aba === 'minha' && guilda}
			<MinhaGuilda {guilda} cargo={guilda.my_role} aoSair={carregar} />
		{:else if aba === 'guildas'}
			<Guildas aoEntrar={carregar} />
		{:else if aba === 'ranking'}
			<Ranking minhaGuildaId={guilda?.id ?? null} />
		{:else if aba === 'criar'}
			<Criar aoCriar={carregar} />
		{/if}
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
</style>
