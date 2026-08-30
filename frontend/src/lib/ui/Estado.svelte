<script lang="ts">
	let {
		estado,
		mensagem = '',
		acao = '',
		aoAgir
	}: {
		estado: 'carregando' | 'vazio' | 'erro';
		mensagem?: string;
		acao?: string;
		aoAgir?: () => void;
	} = $props();
</script>

<div class="estado" role={estado === 'erro' ? 'alert' : 'status'}>
	{#if estado === 'carregando'}
		<span class="marca" aria-hidden="true"></span>
		<p>Carregando</p>
	{:else}
		<p class:erro={estado === 'erro'}>{mensagem}</p>
		{#if acao && aoAgir}
			<button onclick={aoAgir}>{acao}</button>
		{/if}
	{/if}
</div>

<style>
	.estado {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		text-align: center;
		padding: 0 4px;
	}

	p {
		margin: 0;
		color: var(--argent-fraco);
		text-wrap: balance;
	}

	p.erro {
		color: var(--argent);
		border-left: 2px solid var(--gules);
		padding-left: 10px;
		text-align: left;
	}

	.marca {
		width: 12px;
		height: 12px;
		background: var(--or);
		transform: rotate(45deg);
		opacity: 0.5;
		animation: pulso 1.4s ease-in-out infinite;
	}

	@keyframes pulso {
		50% {
			opacity: 1;
		}
	}
</style>
