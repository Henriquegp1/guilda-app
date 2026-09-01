<script lang="ts">
	import { onMount } from 'svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import {
		filaModeracao,
		suspenderGuilda,
		reativarGuilda,
		banirGuilda,
		transferirLiderancaMod,
		ErroApi,
		type Guilda
	} from '$lib/api';

	let { role }: { role: string } = $props();

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let items = $state<Guilda[]>([]);
	let total = $state(0);
	let filtroStatus = $state('active');
	let busca = $state('');
	let erro = $state('');
	let ocupado = $state<number | null>(null);

	// Controle do Modal
	let modalAberto = $state(false);
	let guildaAlvo = $state<Guilda | null>(null);
	let acaoAlvo = $state<'suspender' | 'reativar' | 'banir' | 'transferir' | null>(null);
	let motivoInput = $state('');
	let novoLiderId = $state('');

	async function carregar() {
		try {
			const res = await filaModeracao(filtroStatus);
			items = res.items;
			total = res.total;
			estado = 'pronto';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao carregar guildas.';
			estado = 'erro';
		}
	}

	const guildasFiltradas = $derived(
		items.filter(g =>
			g.name.toLowerCase().includes(busca.toLowerCase()) ||
			g.tag.toLowerCase().includes(busca.toLowerCase())
		)
	);

	function abrirModal(g: Guilda, acao: typeof acaoAlvo) {
		guildaAlvo = g;
		acaoAlvo = acao;
		motivoInput = '';
		novoLiderId = '';
		modalAberto = true;
	}

	async function confirmarAcao() {
		if (!guildaAlvo || !acaoAlvo) return;

		if (acaoAlvo !== 'reativar' && !motivoInput.trim()) {
			alert('O motivo é obrigatório.');
			return;
		}

		if (acaoAlvo === 'transferir' && !novoLiderId.trim()) {
			alert('O ID do novo líder é obrigatório.');
			return;
		}

		const id = guildaAlvo.id;
		ocupado = id;
		modalAberto = false;

		try {
			if (acaoAlvo === 'suspender') await suspenderGuilda(id, motivoInput);
			else if (acaoAlvo === 'reativar') await reativarGuilda(id);
			else if (acaoAlvo === 'banir') await banirGuilda(id, motivoInput);
			else if (acaoAlvo === 'transferir') await transferirLiderancaMod(id, novoLiderId, motivoInput);
			await carregar();
		} catch (e) {
			alert(e instanceof ErroApi ? e.message : 'Erro na operação.');
		} finally {
			ocupado = null;
		}
	}

	onMount(carregar);
</script>

<div class="gestao-guildas">
	{#if estado === 'carregando'}
		<Estado estado="carregando" />
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
	{:else}
		<header>
			<div class="controles">
				<select bind:value={filtroStatus} onchange={carregar}>
					<option value="active">Ativas</option>
					<option value="suspended">Suspensas</option>
					<option value="banned">Banidas</option>
				</select>

				<div class="busca-container">
					<input type="text" placeholder="Buscar nome ou TAG..." bind:value={busca} />
				</div>

				<span class="total">{total} guildas</span>
			</div>
			<button class="btn-refresh" onclick={carregar}>🔄</button>
		</header>

		<table class="tabela">
			<thead>
				<tr>
					<th>Nome</th>
					<th>TAG</th>
					<th>Nível</th>
					<th>Líder</th>
					<th>Ações</th>
				</tr>
			</thead>
			<tbody>
				{#each guildasFiltradas as g (g.id)}
					<tr class:ocupado={ocupado === g.id}>
						<td class="nome">{g.name}</td>
						<td><span class="tag">[{g.tag}]</span></td>
						<td>{g.level}</td>
						<td><small class="num">{g.leader_user_id}</small></td>
						<td class="btns">
							{#if g.status === 'active' || g.status === 'overflow'}
								<button class="btn-suspend" onclick={() => abrirModal(g, 'suspender')}>Pausar</button>
							{/if}
							{#if g.status === 'suspended'}
								<button class="btn-reactivate" onclick={() => abrirModal(g, 'reativar')}>Voltar</button>
							{/if}

							{#if role === 'broadcaster'}
								<button class="btn-ban" onclick={() => abrirModal(g, 'banir')}>Banir</button>
								<button class="btn-transfer" onclick={() => abrirModal(g, 'transferir')}>Líder</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		{#if !guildasFiltradas.length}
			<p class="vazio">Nenhuma guilda encontrada para os filtros atuais.</p>
		{/if}
	{/if}
</div>

<Modal
	titulo="{acaoAlvo?.toUpperCase()} GUILDA: {guildaAlvo?.name}"
	bind:aberto={modalAberto}
	confirmarTexto={acaoAlvo === 'reativar' ? 'Confirmar' : 'Aplicar Ação'}
	perigoso={acaoAlvo === 'banir'}
	aoConfirmar={confirmarAcao}
>
	{#if acaoAlvo === 'reativar'}
		<p>Deseja reativar a guilda <b>{guildaAlvo?.name}</b>? Ela voltará a aparecer nas listagens públicas.</p>
	{:else}
		<div class="form-modal">
			{#if acaoAlvo === 'transferir'}
				<div class="field">
					<label for="novo-lider-id">ID do Novo Líder (Twitch ID)</label>
					<input id="novo-lider-id" type="text" bind:value={novoLiderId} placeholder="Ex: 12345678" />
				</div>
			{/if}
			<div class="field">
				<label for="motivo-acao">Motivo da Ação</label>
				<textarea
					id="motivo-acao"
					bind:value={motivoInput}
					placeholder="Explique o motivo desta decisão administrativa..."
				></textarea>
			</div>
			<p class="aviso-modal">Esta ação será registrada permanentemente no Log de Auditoria.</p>
		</div>
	{/if}
</Modal>

<style>
	header { display: flex; justify-content: space-between; margin-bottom: 16px; }
	.controles { display: flex; align-items: center; gap: 12px; flex: 1; }

	select {
		background: var(--sable-3);
		border: 1px solid var(--borda);
		color: var(--argent);
		padding: 6px 12px;
		font-size: 13px;
		border-radius: 2px;
	}

	.busca-container { flex: 1; max-width: 300px; }
	.busca-container input {
		width: 100%;
		background: var(--sable-3);
		border: 1px solid var(--borda);
		color: var(--argent);
		padding: 6px 12px;
		font-size: 13px;
		border-radius: 2px;
	}

	.total { font-size: 11px; color: var(--argent-fraco); text-transform: uppercase; white-space: nowrap; }

	.tabela { width: 100%; border-collapse: collapse; font-size: 13px; }
	th { text-align: left; padding: 12px 8px; border-bottom: 2px solid var(--borda); color: var(--argent-fraco); font-size: 11px; text-transform: uppercase; }
	td { padding: 10px 8px; border-bottom: 1px solid var(--borda); vertical-align: middle; }

	.nome { color: var(--or); font-weight: bold; }
	.tag { color: var(--argent-fraco); }

	.btns { display: flex; gap: 4px; }
	button {
		border: 1px solid var(--borda);
		background: none;
		color: var(--argent-fraco);
		font-size: 10px;
		padding: 3px 6px;
		cursor: pointer;
		text-transform: uppercase;
		min-height: auto;
	}

	button:hover { border-color: var(--argent); color: var(--argent); }
	.btn-ban:hover { border-color: var(--gules); color: var(--gules); }
	.btn-reactivate:hover { border-color: var(--vert); color: var(--vert); }

	.ocupado { opacity: 0.3; pointer-events: none; }
	.btn-refresh { background: none; border: 1px solid var(--borda); cursor: pointer; color: var(--argent-fraco); padding: 4px 12px; }

	/* Estilos Modal */
	.form-modal { display: flex; flex-direction: column; gap: 16px; }
	.field { display: flex; flex-direction: column; gap: 6px; }
	.field label { font-size: 11px; text-transform: uppercase; color: var(--argent-fraco); }
	.field input, .field textarea {
		background: var(--sable-3);
		border: 1px solid var(--borda);
		color: var(--argent);
		padding: 10px;
		font-size: 13px;
		border-radius: 2px;
	}
	.field textarea { height: 80px; resize: none; }
	.aviso-modal { font-size: 11px; color: var(--argent-fraco); font-style: italic; margin-top: 8px; }

	.vazio { text-align: center; padding: 60px; color: var(--argent-fraco); border: 1px dashed var(--borda); margin-top: 20px; }
</style>
