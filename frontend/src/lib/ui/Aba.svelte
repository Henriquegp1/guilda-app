<script lang="ts">
	// Sem roteador: cada view é um HTML independente, não há URL para navegar.
	let {
		abas,
		atual = $bindable()
	}: { abas: { id: string; rotulo: string }[]; atual: string } = $props();
</script>

<nav aria-label="Seções do painel">
	{#each abas as aba (aba.id)}
		<button
			class:ativa={atual === aba.id}
			aria-current={atual === aba.id ? 'page' : undefined}
			onclick={() => (atual = aba.id)}
		>
			{aba.rotulo}
		</button>
	{/each}
</nav>

<style>
	nav {
		display: flex;
		gap: 2px;
		margin: 0 calc(var(--px) * -1) 10px;
		padding: 0 var(--px);
		border-bottom: 1px solid var(--borda);
	}

	button {
		flex: 1;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		border-radius: 0;
		min-height: 40px;
		padding: 4px 2px 7px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: var(--argent-fraco);
	}

	@media (max-width: 600px) {
		button {
			font-size: 13px;
			min-height: 48px;
		}
	}

	button:hover {
		color: var(--argent);
	}

	button.ativa {
		color: var(--or);
		border-bottom-color: var(--or);
	}
</style>
