<script lang="ts">
	import { onMount } from 'svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import { filaModeracao, aprovarGuilda, rejeitarGuilda, ErroApi } from '$lib/api';

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let items = $state<any[]>([]);
	let total = $state(0);
	let erro = $state('');
	let ocupado = $state<number | null>(null);
	let motivos = $state<Record<number, string>>({});

	async function carregar() {
		try {
			const res = await filaModeracao('pending');
			items = res.items;
			total = res.total;
			estado = 'pronto';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao carregar fundações.';
			estado = 'erro';
		}
	}

	async function agir(id: number, acao: 'aprovar' | 'rejeitar') {
		ocupado = id;
		erro = '';
		try {
			if (acao === 'aprovar') {
				await aprovarGuilda(id);
			} else {
				const motivo = motivos[id]?.trim();
				if (!motivo) throw new Error('Motivo obrigatório para rejeição.');
				await rejeitarGuilda(id, motivo);
			}
			await carregar();
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : (e as Error).message;
		} finally {
			ocupado = null;
		}
	}

	onMount(carregar);

	const quando = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');
</script>

<div class="fila-fundacao">
	{#if estado === 'carregando'}
		<Estado estado="carregando" />
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
	{:else}
		<header>
			<h2>Novas Guildas <span class="conta">{total}</span></h2>
			<button class="btn-refresh" onclick={carregar}>🔄 Atualizar</button>
		</header>

		{#if erro}<p class="msg-erro">{erro}</p>{/if}

		{#if !items.length}
			<p class="vazio">Nenhuma guilda aguardando aprovação.</p>
		{:else}
			<div class="lista">
				{#each items as g (g.id)}
					<div class="card" class:ocupado={ocupado === g.id}>
						<div class="info">
							<div class="main-info">
								<h3>{g.name} <span class="tag">[{g.tag}]</span></h3>
								<p class="meta">Criada por {g.creator_user_id} em {quando(g.created_at)}</p>
							</div>
							{#if g.description}
								<p class="desc">{g.description}</p>
							{/if}
						</div>

						<div class="acoes">
							<textarea
								placeholder="Motivo (obrigatório para rejeitar)"
								bind:value={motivos[g.id]}
							></textarea>
							<div class="btns">
								<button class="btn-aprovar" onclick={() => agir(g.id, 'aprovar')}>Aprovar</button>
								<button class="btn-rejeitar" onclick={() => agir(g.id, 'rejeitar')}>Rejeitar</button>
							</div>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>

<style>
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}

	h2 { font-size: 18px; margin: 0; }
	.conta { font-size: 12px; background: var(--sable-3); padding: 2px 8px; border-radius: 10px; color: var(--or); }

	.btn-refresh { background: none; border: 1px solid var(--borda); color: var(--argent-fraco); font-size: 12px; padding: 4px 12px; cursor: pointer; }

	.lista { display: flex; flex-direction: column; gap: 12px; }

	.card {
		background: var(--sable-2);
		border: 1px solid var(--borda);
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.main-info h3 { margin: 0; color: var(--or); font-family: var(--display); }
	.tag { color: var(--argent-fraco); font-family: var(--texto); font-size: 14px; }
	.meta { font-size: 11px; color: var(--argent-fraco); margin: 4px 0; }
	.desc { font-size: 13px; color: var(--argent); margin: 8px 0; font-style: italic; }

	.acoes { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--borda); padding-top: 12px; }

	textarea {
		width: 100%;
		background: var(--sable-3);
		border: 1px solid var(--borda);
		color: var(--argent);
		padding: 8px;
		font-size: 12px;
		height: 40px;
		resize: none;
	}

	.btns { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

	button { padding: 8px; font-weight: bold; cursor: pointer; border: none; font-size: 12px; }
	.btn-aprovar { background: var(--vert-forte); color: white; }
	.btn-rejeitar { background: var(--gules-forte); color: white; }

	.ocupado { opacity: 0.5; pointer-events: none; }
	.msg-erro { color: var(--gules); font-size: 12px; margin-bottom: 12px; }
	.vazio { text-align: center; padding: 40px; color: var(--argent-fraco); border: 1px dashed var(--borda); }
</style>
