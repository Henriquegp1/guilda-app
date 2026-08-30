<script lang="ts">
	import { onMount } from 'svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import Brasao from '$lib/ui/Brasao.svelte';
	import { iniciar, onAuth } from '$lib/twitch';
	import {
		filaModeracao,
		aprovarGuilda,
		rejeitarGuilda,
		auditoria,
		ErroApi,
		type GuildaPendente
	} from '$lib/api';

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let fila = $state<GuildaPendente[]>([]);
	let log = $state<{ id: number; actor_user_id: string; action: string; created_at: string }[]>([]);
	let erro = $state('');
	let ocupado = $state<number | null>(null);
	let motivos = $state<Record<number, string>>({});

	async function carregar() {
		try {
			const [f, a] = await Promise.all([filaModeracao(), auditoria().catch(() => ({ items: [] }))]);
			fila = f.items;
			log = a.items.slice(0, 12);
			estado = 'pronto';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Não foi possível carregar a fila.';
			estado = 'erro';
		}
	}

	async function agir(g: GuildaPendente, acao: 'aprovar' | 'rejeitar') {
		ocupado = g.id;
		erro = '';
		try {
			if (acao === 'aprovar') await aprovarGuilda(g.id);
			else await rejeitarGuilda(g.id, motivos[g.id].trim());
			await carregar();
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Ação não concluída.';
		} finally {
			ocupado = null;
		}
	}

	onMount(() => {
		iniciar();
		return onAuth(carregar);
	});

	const quando = (iso: string) =>
		new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
</script>

<main>
	<h1>Moderação de guildas</h1>

	{#if estado === 'carregando'}
		<Estado estado="carregando" />
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
	{:else}
		{#if erro}<p class="erro" role="alert">{erro}</p>{/if}

		<section>
			<h2>Aguardando aprovação <span class="conta num">{fila.length}</span></h2>

			{#if !fila.length}
				<p class="vazio">Nenhuma guilda na fila. Novas criações aparecem aqui.</p>
			{:else}
				<ul>
					{#each fila as g (g.id)}
						<li>
							<Brasao tag={g.tag} tamanho={56} />
							<div class="dados">
								<b>{g.name}</b>
								<small>[{g.tag}] · criada por {g.creator_user_id} · {quando(g.created_at)}</small>
								{#if g.description}<p class="desc">{g.description}</p>{/if}
								<input
									placeholder="Motivo da rejeição (vai para quem pagou)"
									bind:value={motivos[g.id]}
								/>
							</div>
							<div class="botoes">
								<button
									class="aprovar"
									disabled={ocupado === g.id}
									onclick={() => agir(g, 'aprovar')}>Aprovar</button
								>
								<button
									class="rejeitar"
									disabled={ocupado === g.id || !motivos[g.id]?.trim()}
									onclick={() => agir(g, 'rejeitar')}>Rejeitar</button
								>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<h2>Auditoria</h2>
			{#if !log.length}
				<p class="vazio">Nenhuma ação registrada ainda.</p>
			{:else}
				<ol class="log">
					{#each log as l (l.id)}
						<li>
							<span class="quando num">{quando(l.created_at)}</span>
							<span class="acao">{l.action}</span>
							<span class="quem">{l.actor_user_id}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 860px;
		margin: 0 auto;
		padding: 20px 16px 40px;
		background: var(--sable);
		min-height: 100vh;
	}

	h1 {
		font-size: 24px;
		margin-bottom: 18px;
	}

	h2 {
		font-family: var(--texto);
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--argent-fraco);
		margin: 22px 0 8px;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.conta {
		color: var(--or);
		font-size: 13px;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	ul li {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		padding: 12px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 2px;
	}

	.dados {
		flex: 1;
		min-width: 0;
	}

	.dados b {
		font-family: var(--display);
		font-size: 17px;
	}

	.dados small {
		display: block;
		color: var(--argent-fraco);
		font-size: 11px;
		margin-top: 2px;
	}

	.desc {
		margin: 6px 0;
		font-size: 12px;
		color: var(--argent-fraco);
	}

	input {
		width: 100%;
		font: inherit;
		font-size: 12px;
		margin-top: 6px;
		padding: 6px 8px;
		color: var(--argent);
		background: var(--sable);
		border: 1px solid var(--borda);
		border-radius: 2px;
	}

	input:focus {
		border-color: var(--or);
		outline: none;
	}

	.botoes {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.botoes button {
		min-width: 100px;
		font-size: 12px;
		min-height: 34px;
	}

	.aprovar:hover:not(:disabled) {
		border-color: var(--vert);
		color: var(--vert);
	}

	.rejeitar:hover:not(:disabled) {
		border-color: var(--gules);
		color: var(--gules);
	}

	.vazio {
		color: var(--argent-fraco);
		font-size: 13px;
		margin: 0;
	}

	.log {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 12px;
	}

	.log li {
		display: grid;
		grid-template-columns: 110px 1fr auto;
		gap: 10px;
		padding: 5px 0;
		border-bottom: 1px solid var(--borda);
	}

	.quando,
	.quem {
		color: var(--argent-fraco);
	}

	.acao {
		color: var(--or);
	}

	.erro {
		padding-left: 10px;
		border-left: 2px solid var(--gules);
	}
</style>
