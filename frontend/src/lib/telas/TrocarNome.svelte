<script lang="ts">
	import { gastarBits } from '$lib/twitch';
	import { post, type Guilda } from '$lib/api';

	let { guilda, tipo, aoSucesso }: { guilda: Guilda; tipo: 'name' | 'tag'; aoSucesso: () => void } = $props();

	// Svelte 5: Inicializamos com o valor atual, mas usamos $derived para os rótulos
	let valor = $state('');
	let ocupado = $state(false);
	let erro = $state('');
	// Se os Bits já foram cobrados nesta tentativa mas o registro da troca
	// falhou, guardamos o recibo pra reenviar SÓ o registro — nunca cobrar
	// Bits de novo pela mesma solicitação por causa de uma falha de rede.
	let ultimoRecibo = $state<string | null>(null);
	let pagamentoNaoConfirmado = $state(false);

	// Sincroniza valor inicial
	$effect(() => {
		valor = tipo === 'name' ? guilda.name : guilda.tag;
	});

	const regex = $derived(tipo === 'name'
		? /^[A-Za-z0-9][A-Za-z0-9 ]{1,22}[A-Za-z0-9]$/
		: /^[A-Z0-9]{2,5}$/);

	const rotulo = $derived(tipo === 'name' ? 'Nome da Guilda' : 'TAG');
	const preco = $derived(tipo === 'name' ? 500 : 300);

	async function enviarRegistro(receipt: string) {
		await post(`/guilds/${guilda.id}/identity/${tipo}`, {
			value: valor,
			transaction_receipt: receipt
		});
	}

	async function solicitar() {
		if (!regex.test(valor)) {
			erro = `${rotulo} inválido.`;
			return;
		}
		if (valor === (tipo === 'name' ? guilda.name : guilda.tag)) {
			erro = 'O valor deve ser diferente do atual.';
			return;
		}

		ocupado = true;
		erro = '';
		try {
			const receipt = await gastarBits(`guild.${tipo === 'name' ? 'rename' : 'tag'}`);
			ultimoRecibo = receipt;
			await enviarRegistro(receipt);
			pagamentoNaoConfirmado = false;
			aoSucesso();
		} catch (e) {
			if (ultimoRecibo) {
				// Os Bits já foram debitados nesta tentativa — só o registro
				// falhou. NÃO deixar o usuário pagar de novo por engano.
				pagamentoNaoConfirmado = true;
				erro =
					(e instanceof Error ? e.message + ' ' : '') +
					'Seus Bits já foram cobrados. Não pague de novo — toque em "Tentar registrar de novo".';
			} else {
				erro = e instanceof Error ? e.message : 'Falha na solicitação';
			}
		} finally {
			ocupado = false;
		}
	}

	async function tentarRegistrarNovamente() {
		if (!ultimoRecibo) return;
		ocupado = true;
		erro = '';
		try {
			await enviarRegistro(ultimoRecibo);
			pagamentoNaoConfirmado = false;
			aoSucesso();
		} catch (e) {
			pagamentoNaoConfirmado = true;
			erro =
				(e instanceof Error ? e.message + ' ' : '') +
				'Ainda não conseguimos registrar. Seus Bits continuam já pagos — pode tentar de novo sem pagar outra vez.';
		} finally {
			ocupado = false;
		}
	}
</script>

<div class="troca">
	<h3>Alterar {rotulo}</h3>
	<p class="instrucao">
		A alteração de {rotulo} custa <span class="ouro">{preco} Bits</span> e passará por moderação do streamer.
	</p>

	<div class="campo">
		<input
			bind:value={valor}
			placeholder={rotulo}
			maxlength={tipo === 'name' ? 24 : 5}
			disabled={ocupado}
		/>
		{#if tipo === 'tag'}
			<small>Apenas letras maiúsculas e números (2-5 caracteres).</small>
		{/if}
	</div>

	{#if erro}<p class="erro" class:aviso-pagamento={pagamentoNaoConfirmado}>{erro}</p>{/if}

	<div class="acoes">
		<button
			class="confirmar"
			disabled={ocupado || (!valor && !pagamentoNaoConfirmado)}
			onclick={pagamentoNaoConfirmado ? tentarRegistrarNovamente : solicitar}
		>
			{#if ocupado}
				Processando...
			{:else if pagamentoNaoConfirmado}
				Tentar registrar de novo (sem novo pagamento)
			{:else}
				Pagar {preco} Bits e Solicitar
			{/if}
		</button>
	</div>
</div>

<style>
	.troca {
		padding: 16px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 2px;
		margin-top: 12px;
	}

	h3 {
		margin: 0;
		font-family: var(--display);
		font-size: 16px;
		color: var(--or);
	}

	.instrucao {
		font-size: 12px;
		color: var(--argent-fraco);
		margin: 8px 0 16px;
	}

	.ouro {
		color: var(--or);
		font-weight: bold;
	}

	.campo input {
		width: 100%;
		padding: 10px;
		background: var(--sable);
		border: 1px solid var(--borda);
		color: var(--argent);
		font: inherit;
	}

	.campo small {
		display: block;
		margin-top: 4px;
		font-size: 10px;
		color: var(--argent-fraco);
	}

	.erro {
		color: var(--gules);
		font-size: 12px;
		margin: 8px 0 0;
	}

	.erro.aviso-pagamento {
		color: var(--or);
	}

	.acoes {
		margin-top: 16px;
	}

	.confirmar {
		width: 100%;
		padding: 10px;
		background: var(--vert);
		color: var(--sable);
		font-weight: bold;
		border: none;
		border-radius: 2px;
	}

	.confirmar:disabled {
		opacity: 0.5;
	}
</style>