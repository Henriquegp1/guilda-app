<script lang="ts">
	import { onMount } from 'svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import Brasao from '$lib/ui/Brasao.svelte';
	import {
		filaIdentidade,
		aprovarIdentidade,
		rejeitarIdentidade,
		ErroApi,
		type IdentityRequest
	} from '$lib/api';

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let fila = $state<IdentityRequest[]>([]);
	let erro = $state('');
	let ocupado = $state<string | null>(null);
	let motivos = $state<Record<string, string>>({});

	async function carregar() {
		try {
			const data = await filaIdentidade();
			fila = data.items;
			estado = 'pronto';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Não foi possível carregar a fila de identidade.';
			estado = 'erro';
		}
	}

	async function agir(req: IdentityRequest, acao: 'aprovar' | 'rejeitar') {
		ocupado = req.request_id;
		erro = '';
		try {
			if (acao === 'aprovar') {
				await aprovarIdentidade(req.request_id);
			} else {
				const motivo = motivos[req.request_id]?.trim();
				if (!motivo) throw new Error('Motivo obrigatório para rejeição.');
				await rejeitarIdentidade(req.request_id, motivo);
			}
			await carregar();
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : (e as Error).message;
		} finally {
			ocupado = null;
		}
	}

	onMount(carregar);

	const quando = (iso: string) =>
		new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

	const labelTipo = (tipo: string) => {
		const map: Record<string, string> = {
			name: 'Troca de Nome',
			tag: 'Troca de TAG',
			emblem: 'Novo Brasão',
			emblem_custom: 'Brasão Customizado (PNG)'
		};
		return map[tipo] || tipo;
	};
</script>

<div class="painel-mod">
	{#if estado === 'carregando'}
		<Estado estado="carregando" />
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
	{:else}
		<header>
			<h2>Solicitações de Identidade <span class="conta num">{fila.length}</span></h2>
			<button class="btn-refresh" onclick={carregar} disabled={ocupado !== null}>🔄 Atualizar</button>
		</header>

		{#if erro}<p class="msg-erro" role="alert">{erro}</p>{/if}

		{#if !fila.length}
			<p class="vazio">Nenhum pedido de identidade pendente.</p>
		{:else}
			<div class="grid-pedidos">
				{#each fila as req (req.request_id)}
					<div class="card-pedido" class:processando={ocupado === req.request_id}>
						<div class="header-card">
							<span class="tipo-tag {req.type}">{labelTipo(req.type)}</span>
							<span class="data">{quando(req.created_at)}</span>
						</div>

						<div class="corpo-card">
							<div class="info-guilda">
								<span class="nome-guilda">{req.guild_name}</span>
								<small>solicitado por {req.requested_by}</small>
							</div>

							<div class="comparativo">
								{#if req.type === 'name' || req.type === 'tag'}
									<div class="valor-mod">
										<div class="lado">
											<small>ATUAL</small>
											<span class="valor antigo">{req.old_value || '—'}</span>
										</div>
										<div class="seta">➔</div>
										<div class="lado">
											<small>SOLICITADO</small>
											<span class="valor novo">{req.new_value}</span>
										</div>
									</div>
								{:else if req.type === 'emblem' || req.type === 'emblem_custom'}
									<div class="preview-emblema">
										<div class="lado">
											<small>PREVIEW</small>
											<Brasao layers={req.layers} customUrl={req.png_url} tamanho={80} />
										</div>
									</div>
								{/if}
							</div>

							<div class="acao-mod">
								<textarea
									placeholder="Motivo da rejeição (obrigatório se rejeitar)"
									bind:value={motivos[req.request_id]}
									disabled={ocupado === req.request_id}
								></textarea>

								<div class="botoes">
									<button
										class="btn-aprovar"
										onclick={() => agir(req, 'aprovar')}
										disabled={ocupado !== null}
									>✅ Aprovar</button>
									<button
										class="btn-rejeitar"
										onclick={() => agir(req, 'rejeitar')}
										disabled={ocupado !== null || !motivos[req.request_id]?.trim()}
									>❌ Rejeitar</button>
								</div>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	.painel-mod {
		color: var(--argent);
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}

	h2 {
		font-size: 18px;
		margin: 0;
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.conta {
		background: var(--sable-3);
		padding: 2px 8px;
		border-radius: 10px;
		font-size: 12px;
		color: var(--or);
	}

	.btn-refresh {
		background: none;
		border: 1px solid var(--borda);
		color: var(--argent-fraco);
		font-size: 12px;
		padding: 4px 12px;
		cursor: pointer;
	}

	.btn-refresh:hover {
		border-color: var(--or);
		color: var(--or);
	}

	.grid-pedidos {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
		gap: 16px;
	}

	.card-pedido {
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 4px;
		display: flex;
		flex-direction: column;
		transition: opacity 0.2s;
	}

	.card-pedido.processando {
		opacity: 0.5;
		pointer-events: none;
	}

	.header-card {
		padding: 8px 12px;
		border-bottom: 1px solid var(--borda);
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: rgba(255, 255, 255, 0.03);
	}

	.tipo-tag {
		font-size: 10px;
		text-transform: uppercase;
		font-weight: bold;
		padding: 2px 6px;
		border-radius: 2px;
		letter-spacing: 0.05em;
	}

	.tipo-tag.name { background: #3b3b10; color: #ffeb3b; }
	.tipo-tag.tag { background: #103b3b; color: #00bcd4; }
	.tipo-tag.emblem_custom { background: #3b103b; color: #e91e63; }
	.tipo-tag.emblem { background: #103b10; color: #4caf50; }

	.data {
		font-size: 10px;
		color: var(--argent-fraco);
	}

	.corpo-card {
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.info-guilda {
		display: flex;
		flex-direction: column;
	}

	.nome-guilda {
		font-family: var(--display);
		font-size: 18px;
		color: var(--or);
	}

	.info-guilda small {
		font-size: 11px;
		color: var(--argent-fraco);
	}

	.comparativo {
		background: var(--sable);
		padding: 10px;
		border-radius: 4px;
		border: 1px solid rgba(255, 255, 255, 0.05);
	}

	.valor-mod {
		display: flex;
		align-items: center;
		justify-content: space-between;
		text-align: center;
	}

	.lado {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lado small {
		font-size: 9px;
		color: var(--argent-fraco);
		letter-spacing: 0.1em;
	}

	.valor {
		font-size: 16px;
		font-weight: bold;
	}

	.valor.antigo { color: var(--argent-fraco); text-decoration: line-through; }
	.valor.novo { color: var(--vert); }

	.seta {
		color: var(--argent-fraco);
		padding: 0 10px;
	}

	.preview-emblema {
		display: flex;
		justify-content: center;
	}

	.acao-mod {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	textarea {
		width: 100%;
		background: var(--sable-3);
		border: 1px solid var(--borda);
		color: var(--argent);
		padding: 8px;
		font-size: 12px;
		resize: none;
		height: 50px;
		border-radius: 2px;
	}

	textarea:focus {
		border-color: var(--or);
		outline: none;
	}

	.botoes {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
	}

	.botoes button {
		padding: 8px;
		font-size: 12px;
		font-weight: bold;
		cursor: pointer;
		transition: all 0.2s;
	}

	.btn-aprovar {
		background: var(--vert-forte);
		border: 1px solid var(--vert);
		color: white;
	}

	.btn-aprovar:hover:not(:disabled) {
		background: var(--vert);
	}

	.btn-rejeitar {
		background: var(--gules-forte);
		border: 1px solid var(--gules);
		color: white;
	}

	.btn-rejeitar:hover:not(:disabled) {
		background: var(--gules);
	}

	button:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.msg-erro {
		color: var(--gules);
		font-size: 12px;
		padding: 8px;
		background: rgba(255, 0, 0, 0.1);
		border-radius: 4px;
		margin-bottom: 12px;
	}

	.vazio {
		text-align: center;
		padding: 40px;
		color: var(--argent-fraco);
		border: 1px dashed var(--borda);
	}
</style>
