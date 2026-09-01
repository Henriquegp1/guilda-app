<script lang="ts">
	import { onMount } from 'svelte';
	import { listarEntregasAnuncio, ErroApi, type DeliveryLog } from '$lib/api';

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let logs = $state<DeliveryLog[]>([]);
	let cursor = $state<string | null>(null);
	let erro = $state('');

	async function carregar(proxima = false) {
		if (!proxima) estado = 'carregando';
		try {
			const res = await listarEntregasAnuncio(proxima ? cursor || undefined : undefined);
			if (proxima) {
				logs = [...logs, ...res.items];
			} else {
				logs = res.items;
			}
			cursor = res.next_cursor;
			estado = 'pronto';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao carregar histórico.';
			estado = 'erro';
		}
	}

	onMount(carregar);

	const quando = (iso: string) =>
		new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

	const statusLabel = (log: DeliveryLog) => {
		if (log.status === 'sent') return '200 OK';
		if (log.status === 'failed') return log.http_status ? `${log.http_status} Erro` : 'Falha Rede';
		if (log.status === 'suppressed') return 'Suprimido';
		if (log.status === 'expired') return 'Expirado';
		return log.status.toUpperCase();
	};
</script>

<div class="config-historico">
	<div class="header-sec">
		<div class="t-title">
			<h3>Histórico de Entregas</h3>
			<button class="btn-refresh" onclick={() => carregar()}>🔄 Atualizar</button>
		</div>
		<p class="ajuda">Últimas tentativas de envio para o seu bot.</p>
	</div>

	{#if estado === 'carregando'}
		<p class="carregando">Buscando logs...</p>
	{:else if estado === 'erro'}
		<p class="msg-erro">{erro}</p>
	{:else if !logs.length}
		<p class="vazio">Nenhuma entrega registrada ainda.</p>
	{:else}
		<table class="tabela">
			<thead>
				<tr>
					<th>Evento</th>
					<th>Status</th>
					<th>Latência</th>
					<th>Horário</th>
				</tr>
			</thead>
			<tbody>
				{#each logs as log (log.id)}
					<tr class={log.status}>
						<td class="evento">
							{#if log.dedup_key.startsWith('test:')}🧪{/if}
							{log.event_type.replace('.', ' ')}
						</td>
						<td class="status">
							<span class="badge">{statusLabel(log)}</span>
							{#if log.suppress_reason}
								<small class="reason">({log.suppress_reason})</small>
							{/if}
						</td>
						<td class="latencia num">
							{log.latency_ms ? `${log.latency_ms}ms` : '—'}
						</td>
						<td class="data">{quando(log.created_at)}</td>
					</tr>
				{/each}
			</tbody>
		</table>

		{#if cursor}
			<button class="btn-mais" onclick={() => carregar(true)}>Carregar mais registros</button>
		{/if}
	{/if}
</div>

<style>
	.config-historico { margin-top: 24px; }

	.t-title { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
	h3 { font-size: 16px; color: var(--or); }

	.btn-refresh { background: none; border: 1px solid var(--borda); font-size: 11px; padding: 2px 8px; color: var(--argent-fraco); cursor: pointer; }

	.ajuda { font-size: 12px; color: var(--argent-fraco); margin-bottom: 16px; }

	.tabela { width: 100%; border-collapse: collapse; font-size: 12px; background: var(--sable-2); border: 1px solid var(--borda); }
	th { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--borda); color: var(--argent-fraco); text-transform: uppercase; font-size: 10px; }
	td { padding: 8px 12px; border-bottom: 1px solid rgba(255, 255, 255, 0.03); }

	.evento { font-weight: bold; text-transform: capitalize; color: var(--argent); }

	.badge {
		font-size: 10px;
		font-weight: bold;
		padding: 1px 4px;
		border-radius: 2px;
		background: var(--sable-3);
	}

	tr.sent .badge { color: var(--vert); background: rgba(63, 125, 92, 0.1); }
	tr.failed .badge { color: var(--gules); background: rgba(166, 50, 50, 0.1); }
	tr.suppressed .badge { color: var(--argent-fraco); }

	.reason { display: block; font-size: 9px; color: var(--argent-fraco); margin-top: 2px; }
	.latencia { color: var(--argent-fraco); }
	.data { color: var(--argent-fraco); font-size: 11px; text-align: right; }

	.btn-mais { width: 100%; margin-top: 12px; padding: 8px; background: var(--sable-2); border: 1px solid var(--borda); color: var(--argent); cursor: pointer; font-size: 11px; }

	.carregando, .vazio { text-align: center; padding: 20px; font-size: 12px; color: var(--argent-fraco); }
	.msg-erro { color: var(--gules); font-size: 12px; margin-top: 12px; }
</style>
