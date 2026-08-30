<script lang="ts">
	import Brasao from '$lib/ui/Brasao.svelte';
	import { criarRascunho, confirmarPagamento, ErroApi } from '$lib/api';
	import { gastarBits, produtosBits, bitsHabilitado, aoMudarRecursos } from '$lib/twitch';

	let { aoCriar }: { aoCriar: () => void } = $props();

	let nome = $state('');
	let tag = $state('');
	let lema = $state('');
	let descricao = $state('');
	let sku = $state('');
	let custo = $state<number | null>(null);
	let temBits = $state(true);

	// Cada passo é um estado do backend, não um passo de formulário: o rascunho
	// já existe no banco antes de o viewer pagar (fase 01).
	let passo = $state<'form' | 'pagando' | 'confirmando' | 'pendente'>('form');
	let erro = $state('');
	let rascunhoId = $state<number | null>(null);

	$effect(() => {
		temBits = bitsHabilitado();
		return aoMudarRecursos(() => (temBits = bitsHabilitado()));
	});

	$effect(() => {
		produtosBits()
			.then((ps) => {
				const p = ps.find((x) => x.sku.startsWith('guild_creation')) ?? ps[0];
				if (p) {
					sku = p.sku;
					custo = Number(p.cost.amount);
				}
			})
			.catch(() => {});
	});

	// Espelha a validação do servidor para avisar antes de cobrar Bits. Quem
	// decide continua sendo o servidor.
	const nomeOk = $derived(/^[A-Za-z0-9 ]{3,24}$/.test(nome.trim()));
	const tagOk = $derived(/^[A-Z0-9]{2,5}$/.test(tag));
	const podeEnviar = $derived(nomeOk && tagOk && passo === 'form' && temBits);

	async function criar() {
		erro = '';
		passo = 'pagando';
		try {
			const g =
				rascunhoId === null
					? await criarRascunho({
							name: nome.trim(),
							tag,
							motto: lema.trim() || undefined,
							description: descricao.trim() || undefined
						})
					: { id: rascunhoId };
			rascunhoId = g.id;

			const recibo = await gastarBits(sku);
			passo = 'confirmando';
			await confirmarPagamento(g.id, recibo);
			passo = 'pendente';
			aoCriar();
		} catch (e) {
			if (e instanceof Error && e.message === 'BITS_CANCELADO') {
				// O rascunho fica reservado por 15 min: dá para tentar de novo sem
				// perder o nome nem criar outro.
				erro = 'Pagamento cancelado. O nome fica reservado por 15 minutos.';
				passo = 'form';
				return;
			}
			erro = e instanceof ErroApi ? e.message : 'Não foi possível criar a guilda.';
			passo = 'form';
		}
	}
</script>

{#if passo === 'pendente'}
	<div class="fim">
		<Brasao tag={tag} tamanho={80} />
		<h2>Guilda criada</h2>
		<p>Ela aparece no canal assim que o streamer aprovar o nome e o brasão.</p>
	</div>
{:else if passo === 'confirmando'}
	<div class="fim">
		<Brasao tamanho={80} />
		<h2>Confirmando pagamento</h2>
		<p>Pode fechar o painel — a guilda é criada mesmo assim.</p>
	</div>
{:else}
	<form
		onsubmit={(e) => {
			e.preventDefault();
			criar();
		}}
	>
		{#if erro}
			<p class="erro" role="alert">{erro}</p>
		{/if}

		<label>
			Nome
			<input bind:value={nome} maxlength="24" placeholder="Ordem Carmesim" required />
			<small class:ruim={nome && !nomeOk}>3 a 24 letras, números e espaços</small>
		</label>

		<label>
			TAG
			<input
				value={tag}
				oninput={(e) => (tag = e.currentTarget.value.toUpperCase().slice(0, 5))}
				maxlength="5"
				placeholder="OCR"
				required
			/>
			<small class:ruim={tag && !tagOk}>2 a 5 letras ou números</small>
		</label>

		<label>
			Lema <span class="opc">opcional</span>
			<input bind:value={lema} maxlength="40" placeholder="Do carmim nasce a aurora" />
		</label>

		<label>
			Descrição <span class="opc">opcional</span>
			<textarea bind:value={descricao} maxlength="280" rows="2"></textarea>
		</label>

		{#if !temBits}
			<p class="nota">
				Este canal ainda não aceita Bits, então não dá para criar guilda por aqui.
				Você pode entrar em uma guilda existente.
			</p>
		{/if}

		<button class="twitch" type="submit" disabled={!podeEnviar}>
			{#if passo === 'pagando'}
				Aguardando pagamento
			{:else if custo}
				Criar por {custo} Bits
			{:else}
				Criar guilda
			{/if}
		</button>

		<p class="nota">Nome, brasão e descrição passam por aprovação do streamer.</p>
	</form>
{/if}

<style>
	form {
		display: flex;
		flex-direction: column;
		gap: 9px;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: 6px;
		/* Diz "tem mais abaixo" em vez de parecer corte. */
		mask-image: linear-gradient(180deg, #000 calc(100% - 20px), transparent);
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--argent-fraco);
	}

	.opc {
		text-transform: none;
		letter-spacing: 0;
		opacity: 0.7;
	}

	input,
	textarea {
		font: inherit;
		font-size: 13px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--argent);
		background: var(--sable);
		border: 1px solid var(--borda);
		border-radius: 2px;
		padding: 7px 8px;
		resize: none;
	}

	input:focus,
	textarea:focus {
		border-color: var(--or);
		outline: none;
	}

	small {
		font-size: 10px;
		text-transform: none;
		letter-spacing: 0;
	}

	small.ruim {
		color: var(--gules);
	}

	.nota {
		margin: 0;
		font-size: 11px;
		color: var(--argent-fraco);
		text-wrap: pretty;
	}

	.erro {
		margin: 0;
		padding-left: 10px;
		border-left: 2px solid var(--gules);
		font-size: 12px;
	}

	.fim {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		text-align: center;
	}

	.fim h2 {
		font-size: 19px;
	}

	.fim p {
		margin: 0;
		color: var(--argent-fraco);
		text-wrap: balance;
	}
</style>
