<script lang="ts">
	import { declararGuerra, type Guilda, type WarFormat } from '$lib/api';
	import { wars } from '$lib/stores/warStore';

	let { guilda, aoCancelar }: { guilda: Guilda; aoCancelar: () => void } = $props();

	let tagInimiga = $state('');
	let formato = $state<WarFormat>('skirmish');
	let ocupado = $state(false);
	let erro = $state('');

	async function enviar() {
		if (tagInimiga.length < 2) {
			erro = 'TAG inválida.';
			return;
		}

		ocupado = true;
		erro = '';
		try {
			await declararGuerra({
				defender_tag: tagInimiga,
				format: formato
			});
			await wars.atualizar();
			aoCancelar();
		} catch (e) {
			erro = e instanceof Error ? e.message : 'Falha ao declarar guerra.';
		} finally {
			ocupado = false;
		}
	}
</script>

<div class="declarar-guerra">
	<header>
		<button class="voltar" onclick={aoCancelar}>← Voltar</button>
		<h3>Novo Desafio</h3>
	</header>

	<div class="campo">
		<label for="tag">TAG da Guilda Inimiga</label>
		<input
			id="tag"
			bind:value={tagInimiga}
			placeholder="Ex: VOID"
			maxlength="5"
			style="text-transform: uppercase"
		/>
	</div>

	<div class="campo">
		<label for="formato">Formato</label>
		<select id="formato" bind:value={formato}>
			<option value="skirmish">Skirmish (6h - Rápido)</option>
			<option value="campaign">Campaign (7 dias - Épico)</option>
			<!-- Special exige configuração de território, simplificado por agora -->
		</select>
	</div>

	{#if erro}<p class="erro">{erro}</p>{/if}

	<button class="confirmar" disabled={ocupado || !tagInimiga} onclick={enviar}>
		{ocupado ? 'Enviando...' : 'Lançar Desafio'}
	</button>

	<p class="nota">
		O desafio ficará pendente até a guilda inimiga aceitar ou o tempo expirar.
	</p>
</div>

<style>
	.declarar-guerra {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.voltar {
		background: none;
		border: none;
		color: var(--or);
		font-size: 12px;
		cursor: pointer;
	}

	h3 { margin: 0; font-family: var(--display); color: var(--or); }

	.campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	label {
		font-size: 11px;
		text-transform: uppercase;
		color: var(--argent-fraco);
	}

	input, select {
		padding: 10px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		color: var(--argent);
		border-radius: 2px;
		font: inherit;
	}

	.erro { color: var(--gules); font-size: 12px; margin: 0; }

	.confirmar {
		padding: 12px;
		background: var(--gules);
		color: #fff;
		font-weight: bold;
		border: none;
		border-radius: 2px;
		cursor: pointer;
	}

	.confirmar:disabled { opacity: 0.5; }

	.nota { font-size: 11px; color: var(--argent-fraco); text-align: center; margin: 0; }
</style>
