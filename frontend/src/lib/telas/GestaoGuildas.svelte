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
		editarGuildaMod,
		criarGuildaMod,
		ajustarXpMod,
		ajustarPrestigioMod,
		membrosModeracao,
		apagarGuilda,
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
	let membrosAbertos = $state<Set<number>>(new Set());
	let membrosPorGuilda = $state<Record<number, { user_id: string; role: string; nickname: string; joined_at: string }[]>>({});

	// Controle do Modal
	let modalAberto = $state(false);
	let guildaAlvo = $state<Guilda | null>(null);
	let acaoAlvo = $state<'suspender' | 'reativar' | 'banir' | 'transferir' | 'apagar' | 'editar' | 'xp' | 'prestigio' | 'criar' | null>(null);
	let motivoInput = $state('');
	let novoLiderId = $state('');
	let confirmacaoTag = $state('');
	let editNomeInput = $state('');
	let editDescInput = $state('');
	let ajusteQtdInput = $state('');
	let novaNomeInput = $state('');
	let novaTagInput = $state('');
	let novaLiderInput = $state('');

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
		erro = '';
		motivoInput = '';
		novoLiderId = '';
		confirmacaoTag = '';
		editNomeInput = g.name;
		editDescInput = g.description ?? '';
		ajusteQtdInput = '';
		modalAberto = true;
	}

	function abrirCriar() {
		guildaAlvo = null;
		acaoAlvo = 'criar';
		erro = '';
		motivoInput = '';
		novaNomeInput = '';
		novaTagInput = '';
		novaLiderInput = '';
		modalAberto = true;
	}

	// Criação gratuita (só streamer). O servidor valida de novo; aqui só
	// espelhamos as regras para avisar antes de fechar o modal.
	async function confirmarCriar() {
		const name = novaNomeInput.trim();
		const tag = novaTagInput.trim().toUpperCase();
		const lider = novaLiderInput.trim();
		if (!/^[A-Za-z0-9][A-Za-z0-9 ]{1,22}[A-Za-z0-9]$/.test(name) || name.includes('  ')) {
			erro = 'Nome: 3–24 caracteres (letras, números e espaço), sem espaço nas pontas nem duplo.';
			return;
		}
		if (!/^[A-Z0-9]{2,5}$/.test(tag)) {
			erro = 'TAG: 2–5 caracteres (letras e números).';
			return;
		}
		if (!/^\d{1,20}$/.test(lider)) {
			erro = 'ID do líder: apenas números (ID da Twitch).';
			return;
		}
		if (!motivoInput.trim()) {
			erro = 'O motivo é obrigatório.';
			return;
		}
		modalAberto = false;
		try {
			await criarGuildaMod({ name, tag, leader_user_id: lider, reason: motivoInput.trim() });
			filtroStatus = 'active';
			await carregar();
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao criar a guilda.';
		}
	}

	async function alternarMembros(g: Guilda) {
		if (membrosAbertos.has(g.id)) {
			membrosAbertos.delete(g.id);
			membrosAbertos = new Set(membrosAbertos);
			return;
		}
		try {
			if (!membrosPorGuilda[g.id]) {
				const res = await membrosModeracao(g.id);
				membrosPorGuilda = { ...membrosPorGuilda, [g.id]: res.members };
			}
			membrosAbertos = new Set([...membrosAbertos, g.id]);
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao carregar membros.';
		}
	}

	async function confirmarAcao() {
		if (acaoAlvo === 'criar') return confirmarCriar();
		if (!guildaAlvo || !acaoAlvo) return;
		erro = '';

		if (!['reativar', 'apagar', 'editar'].includes(acaoAlvo) && !motivoInput.trim()) {
			erro = 'O motivo é obrigatório.';
			return;
		}
		if (acaoAlvo === 'apagar' && confirmacaoTag.trim().toUpperCase() !== guildaAlvo.tag.toUpperCase()) {
			erro = 'Digite a TAG da guilda para confirmar.';
			return;
		}

		if (acaoAlvo === 'transferir' && !novoLiderId.trim()) {
			erro = 'O ID do novo líder é obrigatório.';
			return;
		}

		let quantidade = 0;
		if (acaoAlvo === 'xp' || acaoAlvo === 'prestigio') {
			quantidade = Math.trunc(Number(ajusteQtdInput));
			if (!Number.isFinite(quantidade) || quantidade === 0) {
				erro = 'Informe uma quantidade inteira diferente de zero (pode ser negativa).';
				return;
			}
		}

		let camposEditados: { name?: string; description?: string } = {};
		if (acaoAlvo === 'editar') {
			if (editNomeInput.trim() !== guildaAlvo.name) camposEditados.name = editNomeInput.trim();
			if (editDescInput.trim() !== (guildaAlvo.description ?? '')) camposEditados.description = editDescInput.trim();
			if (!Object.keys(camposEditados).length) {
				erro = 'Nada foi alterado.';
				return;
			}
		}

		const id = guildaAlvo.id;
		ocupado = id;
		modalAberto = false;

		try {
			if (acaoAlvo === 'suspender') await suspenderGuilda(id, motivoInput);
			else if (acaoAlvo === 'reativar') await reativarGuilda(id);
			else if (acaoAlvo === 'banir') await banirGuilda(id, motivoInput);
			else if (acaoAlvo === 'transferir') await transferirLiderancaMod(id, novoLiderId, motivoInput);
			else if (acaoAlvo === 'apagar') await apagarGuilda(id);
			else if (acaoAlvo === 'editar') await editarGuildaMod(id, camposEditados);
			else if (acaoAlvo === 'xp') await ajustarXpMod(id, quantidade, motivoInput);
			else if (acaoAlvo === 'prestigio') await ajustarPrestigioMod(id, quantidade, motivoInput);
			await carregar();
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro na operação.';
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
		{#if erro}
			<p class="erro-banner">
				{erro}
				<button class="fechar-erro" onclick={() => (erro = '')} aria-label="Dispensar aviso">×</button>
			</p>
		{/if}
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
				{#if role === 'broadcaster'}
					<button class="btn-criar" onclick={abrirCriar}>+ Criar grátis</button>
				{/if}
			</div>
			<button class="btn-refresh" onclick={carregar} aria-label="Atualizar lista">🔄</button>
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
							<button class="btn-members" onclick={() => alternarMembros(g)}>{membrosAbertos.has(g.id) ? 'Ocultar' : 'Membros'}</button>
							<button class="btn-edit" onclick={() => abrirModal(g, 'editar')}>Editar</button>
							<button class="btn-xp" onclick={() => abrirModal(g, 'xp')}>XP</button>
							{#if g.status === 'active' || g.status === 'overflow'}
								<button class="btn-suspend" onclick={() => abrirModal(g, 'suspender')}>Pausar</button>
							{/if}
							{#if g.status === 'suspended'}
								<button class="btn-reactivate" onclick={() => abrirModal(g, 'reativar')}>Voltar</button>
							{/if}

							{#if role === 'broadcaster'}
								<button class="btn-prestige" onclick={() => abrirModal(g, 'prestigio')}>Prestígio</button>
								<button class="btn-ban" onclick={() => abrirModal(g, 'banir')}>Banir</button>
								<button class="btn-transfer" onclick={() => abrirModal(g, 'transferir')}>Líder</button>
								<button class="btn-delete" onclick={() => abrirModal(g, 'apagar')}>Apagar</button>
							{/if}
						</td>
					</tr>
					{#if membrosAbertos.has(g.id)}
						<tr class="linha-membros">
							<td colspan="5">
								{#if membrosPorGuilda[g.id]?.length}
									<ul>
										{#each membrosPorGuilda[g.id] as membro}
											<li><strong>{membro.nickname}</strong> <span>{membro.user_id} · {membro.role}</span></li>
										{/each}
									</ul>
								{:else}
									<span class="sem-membros">Nenhum membro.</span>
								{/if}
							</td>
						</tr>
					{/if}
				{/each}
			</tbody>
		</table>

		{#if !guildasFiltradas.length}
			<p class="vazio">Nenhuma guilda encontrada para os filtros atuais.</p>
		{/if}
	{/if}
</div>

<Modal
	titulo={acaoAlvo === 'criar'
		? 'CRIAR GUILDA (GRÁTIS)'
		: `${acaoAlvo?.toUpperCase()} GUILDA: ${guildaAlvo?.name}`}
	bind:aberto={modalAberto}
	confirmarTexto={acaoAlvo === 'reativar' ? 'Confirmar' : acaoAlvo === 'criar' ? 'Criar guilda' : 'Aplicar Ação'}
	perigoso={acaoAlvo === 'banir'}
	aoConfirmar={confirmarAcao}
>
	{#if erro}
		<p class="erro-modal">{erro}</p>
	{/if}

	{#if acaoAlvo === 'reativar'}
		<p>Deseja reativar a guilda <b>{guildaAlvo?.name}</b>? Ela voltará a aparecer nas listagens públicas.</p>
	{:else if acaoAlvo === 'apagar'}
		<p class="perigo">Esta ação apagará a guilda e os dados relacionados. O canal e os usuários serão preservados.</p>
		<div class="field">
			<label for="confirmacao-tag">Digite a TAG {guildaAlvo?.tag} para confirmar</label>
			<input id="confirmacao-tag" type="text" bind:value={confirmacaoTag} autocomplete="off" />
		</div>
	{:else if acaoAlvo === 'criar'}
		<div class="form-modal">
			<div class="field">
				<label for="nova-nome">Nome</label>
				<input id="nova-nome" type="text" bind:value={novaNomeInput} maxlength="24" autocomplete="off" />
			</div>
			<div class="field">
				<label for="nova-tag">TAG</label>
				<input id="nova-tag" type="text" bind:value={novaTagInput} maxlength="5" autocomplete="off" />
			</div>
			<div class="field">
				<label for="nova-lider">ID do líder (Twitch ID)</label>
				<input id="nova-lider" type="text" inputmode="numeric" bind:value={novaLiderInput} placeholder="Ex: 12345678" autocomplete="off" />
			</div>
			<div class="field">
				<label for="nova-motivo">Motivo</label>
				<textarea id="nova-motivo" bind:value={motivoInput} placeholder="Ex: prêmio de sorteio, parceria..."></textarea>
			</div>
			<p class="aviso-modal">A guilda nasce ativa, sem cobrança de Bits, e a criação fica registrada no Log de Auditoria.</p>
		</div>
	{:else if acaoAlvo === 'editar'}
		<div class="form-modal">
			<div class="field">
				<label for="edit-nome">Nome</label>
				<input id="edit-nome" type="text" bind:value={editNomeInput} maxlength="32" />
			</div>
			<div class="field">
				<label for="edit-desc">Descrição</label>
				<textarea id="edit-desc" bind:value={editDescInput} maxlength="280" placeholder="Sem descrição"></textarea>
			</div>
			<p class="aviso-modal">Cada campo alterado gera uma linha própria no Log de Auditoria (antes/depois).</p>
		</div>
	{:else}
		<div class="form-modal">
			{#if acaoAlvo === 'transferir'}
				<div class="field">
					<label for="novo-lider-id">ID do Novo Líder (Twitch ID)</label>
					<input id="novo-lider-id" type="text" bind:value={novoLiderId} placeholder="Ex: 12345678" />
				</div>
			{:else if acaoAlvo === 'xp' || acaoAlvo === 'prestigio'}
				<div class="field">
					<label for="ajuste-qtd">Quantidade de {acaoAlvo === 'xp' ? 'XP' : 'Prestígio'} (negativo para remover)</label>
					<input id="ajuste-qtd" type="number" bind:value={ajusteQtdInput} placeholder="Ex: 500 ou -200" />
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
	.btn-edit:hover { border-color: var(--or); color: var(--or); }
	.btn-criar { border-color: var(--or); color: var(--or); font-size: 11px; padding: 5px 10px; white-space: nowrap; }
	.btn-criar:hover { background: var(--or); color: var(--sable); }
	.btn-xp:hover { border-color: var(--or); color: var(--or); }
	.btn-prestige:hover { border-color: var(--or); color: var(--or); }
	.btn-ban:hover { border-color: var(--gules); color: var(--gules); }
	.btn-delete:hover { border-color: var(--gules); color: var(--gules); }
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
	.perigo { color: var(--gules); }
	.erro-modal { color: var(--gules); background: rgba(166, 50, 50, 0.1); border: 1px solid var(--gules); padding: 8px 10px; border-radius: 4px; font-size: 12px; margin: 0 0 12px; }
	.erro-banner { display: flex; justify-content: space-between; align-items: center; gap: 12px; color: var(--gules); background: rgba(166, 50, 50, 0.1); border: 1px solid var(--gules); padding: 10px 14px; border-radius: 4px; font-size: 13px; margin-bottom: 16px; }
	.fechar-erro { background: none; border: none; color: var(--gules); font-size: 16px; cursor: pointer; padding: 0 4px; min-height: auto; }
	.linha-membros td { background: var(--sable-3); padding: 8px 16px; }
	.linha-membros ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 5px; }
	.linha-membros li { color: var(--argent); font-size: 12px; }
	.linha-membros li span, .sem-membros { color: var(--argent-fraco); }

	.vazio { text-align: center; padding: 60px; color: var(--argent-fraco); border: 1px dashed var(--borda); margin-top: 20px; }
</style>