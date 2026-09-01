<script lang="ts">
	import { onMount } from 'svelte';
	import Aba from '$lib/ui/Aba.svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import { iniciar, onAuth, dadosAuth } from '$lib/twitch';
	import SolicitacoesIdentidade from '$lib/telas/SolicitacoesIdentidade.svelte';
	import FilaFundacao from '$lib/telas/FilaFundacao.svelte';
	import GestaoGuildas from '$lib/telas/GestaoGuildas.svelte';
	import LogAuditoria from '$lib/telas/LogAuditoria.svelte';

	let abaAtiva = $state('identidade');
	let role = $state('');
	let carregando = $state(true);

	const abas = [
		{ id: 'identidade', rotulo: 'Identidade' },
		{ id: 'fundacao', rotulo: 'Fundação' },
		{ id: 'gestao', rotulo: 'Gestão' },
		{ id: 'auditoria', rotulo: 'Auditoria' }
	];

	onMount(() => {
		iniciar();
		return onAuth((auth) => {
			role = auth.role;
			carregando = false;
		});
	});
</script>

<main>
	<h1>Central de Moderação</h1>

	{#if carregando}
		<Estado estado="carregando" />
	{:else if !['broadcaster', 'moderator'].includes(role)}
		<Estado
			estado="erro"
			mensagem="Acesso restrito. Apenas o streamer e seus moderadores podem acessar esta área."
		/>
	{:else}
		<Aba {abas} bind:atual={abaAtiva} />

		<div class="conteudo-aba">
			{#if abaAtiva === 'identidade'}
				<SolicitacoesIdentidade />
			{:else if abaAtiva === 'fundacao'}
				<FilaFundacao />
			{:else if abaAtiva === 'gestao'}
				<GestaoGuildas {role} />
			{:else if abaAtiva === 'auditoria'}
				<LogAuditoria />
			{/if}
		</div>
	{/if}
</main>

<style>
	main {
		max-width: 900px;
		margin: 0 auto;
		padding: 24px 16px 60px;
		background: var(--sable);
		min-height: 100vh;
	}

	h1 {
		font-size: 24px;
		margin-bottom: 24px;
		font-family: var(--display);
		color: var(--or);
	}

	.conteudo-aba {
		margin-top: 20px;
	}
</style>
