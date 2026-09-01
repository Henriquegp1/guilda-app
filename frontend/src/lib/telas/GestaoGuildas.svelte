<script lang="ts">
	import { onMount } from 'svelte';
	import Estado from '$lib/ui/Estado.svelte';
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
	let erro = $state('');
	let ocupado = $state<number | null>(null);

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

	async function agir(g: Guilda, acao: 'suspender' | 'reativar' | 'banir' | 'transferir') {
		const motivo = prompt(`Digite o motivo para ${acao}:`);
		if (motivo === null) return;
		if (!motivo.trim()) {
			alert('Motivo é obrigatório.');
			return;
		}

		ocupado = g.id;
		try {
			if (acao === 'suspender') await suspenderGuilda(g.id, motivo);
			else if (acao === 'reativar') await reativarGuilda(g.id);
			else if (acao === 'banir') await banirGuilda(g.id, motivo);
			else if (acao === 'transferir') {
				const novoLider = prompt('Digite o ID do novo líder:');
				if (novoLider) await transferirLiderancaMod(g.id, novoLider, motivo);
			}
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
			<div class="filtros">
				<select bind:value={filtroStatus} onchange={carregar}>
					<option value="active">Ativas</option>
					<option value="suspended">Suspensas</option>
					<option value="banned">Banidas</option>
				</select>
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
				{#each items as g (g.id)}
					<tr class:ocupado={ocupado === g.id}>
						<td class="nome">{g.name}</td>
						<td><span class="tag">[{g.tag}]</span></td>
						<td>{g.level}</td>
						<td><small>{g.leader_user_id}</small></td>
						<td class="btns">
							{#if g.status === 'active' || g.status === 'overflow'}
								<button class="btn-suspend" onclick={() => agir(g, 'suspender')}>Pausar</button>
							{/if}
							{#if g.status === 'suspended'}
								<button class="btn-reactivate" onclick={() => agir(g, 'reativar')}>Voltar</button>
							{/if}

							{#if role === 'broadcaster'}
								<button class="btn-ban" onclick={() => agir(g, 'banir')}>Banir</button>
								<button class="btn-transfer" onclick={() => agir(g, 'transferir')}>Líder</button>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</div>

<style>
	header { display: flex; justify-content: space-between; margin-bottom: 16px; }
	.filtros { display: flex; align-items: center; gap: 12px; }

	select {
		background: var(--sable-3);
		border: 1px solid var(--borda);
		color: var(--argent);
		padding: 4px 8px;
		font-size: 13px;
	}

	.total { font-size: 11px; color: var(--argent-fraco); text-transform: uppercase; }

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
	}

	button:hover { border-color: var(--argent); color: var(--argent); }
	.btn-ban:hover { border-color: var(--gules); color: var(--gules); }
	.btn-reactivate:hover { border-color: var(--vert); color: var(--vert); }

	.ocupado { opacity: 0.3; pointer-events: none; }
	.btn-refresh { background: none; border: 1px solid var(--borda); cursor: pointer; color: var(--argent-fraco); }
</style>
