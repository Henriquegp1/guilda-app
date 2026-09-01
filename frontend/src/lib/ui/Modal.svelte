<script lang="ts">
	let {
		titulo,
		aberto = $bindable(false),
		aoConfirmar,
		aoCancelar,
		confirmarTexto = 'Confirmar',
		cancelarTexto = 'Cancelar',
		perigoso = false,
		children
	} = $props();

	function fechar() {
		aberto = false;
		if (aoCancelar) aoCancelar();
	}

	function confirmar() {
		if (aoConfirmar) aoConfirmar();
	}
</script>

{#if aberto}
	<div class="modal-overlay" onclick={fechar} role="presentation">
		<div class="modal-content" onclick={(e) => e.stopPropagation()} role="dialog">
			<header>
				<h3>{titulo}</h3>
				<button class="btn-fechar" onclick={fechar}>&times;</button>
			</header>

			<div class="corpo">
				{@render children()}
			</div>

			<footer>
				<button class="btn-cancelar" onclick={fechar}>{cancelarTexto}</button>
				<button
					class="btn-confirmar"
					class:perigoso
					onclick={confirmar}
				>
					{confirmarTexto}
				</button>
			</footer>
		</div>
	</div>
{/if}

<style>
	.modal-overlay {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
		padding: 16px;
	}

	.modal-content {
		background: var(--sable-2);
		border: 1px solid var(--or);
		border-radius: 4px;
		width: 100%;
		max-width: 450px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 16px 20px;
		border-bottom: 1px solid var(--borda);
	}

	h3 { color: var(--or); font-size: 18px; margin: 0; }

	.btn-fechar {
		background: none;
		border: none;
		font-size: 24px;
		color: var(--argent-fraco);
		cursor: pointer;
		padding: 0;
		min-height: auto;
	}

	.corpo {
		padding: 20px;
		color: var(--argent);
		font-size: 14px;
		line-height: 1.5;
	}

	footer {
		padding: 16px 20px;
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		border-top: 1px solid var(--borda);
	}

	button {
		font-weight: bold;
		text-transform: uppercase;
		font-size: 12px;
		letter-spacing: 0.05em;
	}

	.btn-cancelar {
		background: none;
		border: 1px solid var(--borda);
		color: var(--argent-fraco);
	}

	.btn-confirmar {
		background: var(--or);
		color: var(--sable);
		border: none;
	}

	.btn-confirmar.perigoso {
		background: var(--gules);
		color: white;
	}
</style>
