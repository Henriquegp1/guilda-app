<script lang="ts">
	import { onMount } from 'svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import { auditoria, ErroApi, type AuditLogItem } from '$lib/api';

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let logs = $state<AuditLogItem[]>([]);
	let cursor = $state<string | null>(null);
	let erro = $state('');

	async function carregar(proxima = false) {
		if (!proxima) estado = 'carregando';
		try {
			const res = await auditoria({ cursor: proxima ? cursor || undefined : undefined });
			if (proxima) {
				logs = [...logs, ...res.items];
			} else {
				logs = res.items;
			}
			cursor = res.next_cursor;
			estado = 'pronto';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao carregar auditoria.';
			estado = 'erro';
		}
	}

	onMount(carregar);

	const quando = (iso: string) =>
		new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

	const formatAction = (a: string) => a.replace('guild.', '').replace('members.', '').toUpperCase();
</script>

<div class="log-auditoria">
	{#if estado === 'carregando'}
		<Estado estado="carregando" />
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={() => carregar()} />
	{:else}
		<table class="tabela">
			<thead>
				<tr>
					<th>Data</th>
					<th>Ator</th>
					<th>Cargo</th>
					<th>Ação</th>
					<th>Alvo</th>
					<th>Detalhes</th>
				</tr>
			</thead>
			<tbody>
				{#each logs as log (log.id)}
					<tr>
						<td class="data">{quando(log.created_at)}</td>
						<td class="ator"><small>{log.actor_user_id}</small></td>
						<td class="cargo"><span class="role-tag {log.actor_role}">{log.actor_role || '—'}</span></td>
						<td class="acao"><b>{formatAction(log.action)}</b></td>
						<td class="alvo"><small>{log.target}</small></td>
						<td class="detalhes">
							{#if log.after?.reason || log.after?.reject_reason}
								<p class="motivo">"{log.after.reason || log.after.reject_reason}"</p>
							{/if}
							{#if log.action.includes('rename')}
								<small>{log.before?.name} ➔ {log.after?.name}</small>
							{:else if log.action.includes('role')}
								<small>{log.before?.role} ➔ {log.after?.role}</small>
							{:else if log.action.includes('transfer_leader')}
								<small>Líder: {log.before?.leader_user_id} ➔ {log.after?.leader_user_id}</small>
							{:else if log.before || log.after}
								<details>
									<summary>Dados</summary>
									<pre>{JSON.stringify({ antes: log.before, depois: log.after }, null, 2)}</pre>
								</details>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		{#if cursor}
			<button class="btn-mais" onclick={() => carregar(true)}>Carregar mais</button>
		{/if}

		{#if !logs.length}
			<p class="vazio">Nenhuma ação registrada ainda.</p>
		{/if}
	{/if}
</div>

<style>
	.tabela { width: 100%; border-collapse: collapse; font-size: 12px; }
	th { text-align: left; padding: 12px 8px; border-bottom: 2px solid var(--borda); color: var(--argent-fraco); text-transform: uppercase; }
	td { padding: 10px 8px; border-bottom: 1px solid var(--borda); vertical-align: top; }

	.data { white-space: nowrap; color: var(--argent-fraco); }
	.ator { color: var(--or); }

	.role-tag {
		font-size: 9px;
		padding: 1px 4px;
		border-radius: 2px;
		text-transform: uppercase;
		font-weight: bold;
	}
	.role-tag.broadcaster { background: #3b1010; color: #ff5252; }
	.role-tag.moderator { background: #10103b; color: #5252ff; }

	.motivo { margin: 0; color: var(--argent); font-style: italic; }

	.btn-mais {
		width: 100%;
		margin-top: 20px;
		padding: 10px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		color: var(--argent);
		cursor: pointer;
	}

	.vazio { text-align: center; padding: 40px; color: var(--argent-fraco); }
</style>
