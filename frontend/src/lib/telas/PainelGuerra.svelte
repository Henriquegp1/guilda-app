<script lang="ts">
	import { wars, minhaGuerra } from '$lib/stores/warStore';
	import { onMount } from 'svelte';
	import { aceitarGuerra, recusarGuerra, type Guilda, type Cargo, type Guerra } from '$lib/api';
	import Brasao from '$lib/ui/Brasao.svelte';
	import DeclararGuerra from './DeclararGuerra.svelte';

	let { guilda, cargo }: { guilda: Guilda; cargo: Cargo } = $props();

	let guerra = minhaGuerra(guilda.id);
	let declarando = $state(false);
	let ocupado = $state(false);

	onMount(() => {
		const parar = wars.iniciar();
		return parar;
	});

	async function responder(id: number, acao: 'aceitar' | 'recusar') {
		ocupado = true;
		try {
			if (acao === 'aceitar') await aceitarGuerra(id);
			else await recusarGuerra(id);
			await wars.atualizar();
		} catch (e) {
			console.error(e);
		} finally {
			ocupado = false;
		}
	}

	function formatarTempo(iso: string | null) {
		if (!iso) return '--:--';
		const resto = Math.max(0, +new Date(iso) - Date.now());
		const segs = Math.floor(resto / 1000);
		const mins = Math.floor(segs / 60);
		const hrs = Math.floor(mins / 60);

		if (hrs > 0) return `${hrs}h ${mins % 60}m`;
		return `${mins}:${(segs % 60).toString().padStart(2, '0')}`;
	}

	let agora = $state(Date.now());
	onMount(() => {
		const t = setInterval(() => (agora = Date.now()), 1000);
		return () => clearInterval(t);
	});
</script>

<div class="painel-guerra">
	{#if $guerra}
		<div class="guerra-ativa">
			<header class="status-header">
				<span class="badge { $guerra.status }">{$guerra.status.toUpperCase()}</span>
				<span class="formato">{$guerra.format.toUpperCase()}</span>
			</header>

			<div class="combate">
				<div class="lado">
					<Brasao tag={guilda.tag} tamanho={64} />
					<span class="score num">
						{ $guerra.challenger_guild_id === guilda.id ? $guerra.score_challenger : $guerra.score_defender }
					</span>
				</div>
				<div class="vs">⚔</div>
				<div class="lado">
					<Brasao tag="???" tamanho={64} /> <!-- Precisamos carregar a tag do inimigo -->
					<span class="score num">
						{ $guerra.challenger_guild_id === guilda.id ? $guerra.score_defender : $guerra.score_challenger }
					</span>
				</div>
			</div>

			<div class="timer-box">
				{#if $guerra.status === 'pending'}
					<p>Desafio expira em: <span class="num">{formatarTempo($guerra.challenge_expires_at)}</span></p>
					{#if $guerra.defender_guild_id === guilda.id && (cargo === 'leader' || cargo === 'officer')}
						<div class="botoes-pendente">
							<button class="aceitar" disabled={ocupado} onclick={() => responder($guerra!.id, 'aceitar')}>Aceitar</button>
							<button class="recusar" disabled={ocupado} onclick={() => responder($guerra!.id, 'recusar')}>Recusar</button>
						</div>
					{/if}
				{:else if $guerra.status === 'active'}
					<p>Termina em: <span class="num">{formatarTempo($guerra.ends_at)}</span></p>
				{:else if $guerra.status === 'accepted'}
					<p>Começa em: <span class="num">{formatarTempo($guerra.starts_at)}</span></p>
				{/if}
			</div>
		</div>
	{:else if declarando}
		<DeclararGuerra {guilda} aoCancelar={() => (declarando = false)} />
	{:else}
		<div class="vazio">
			<div class="icon">⚔️</div>
			<h3>Nenhuma guerra ativa</h3>
			<p>Sua guilda está em paz por enquanto.</p>

			{#if cargo === 'leader' || cargo === 'officer'}
				<button class="declarar" onclick={() => (declarando = true)}> Declarar Guerra </button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.painel-guerra {
		height: 100%;
		display: flex;
		flex-direction: column;
		padding: 16px;
	}

	.status-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 20px;
	}

	.badge {
		font-size: 10px;
		padding: 2px 6px;
		border-radius: 2px;
		font-weight: bold;
	}

	.badge.active { background: var(--vert); color: var(--sable); }
	.badge.pending { background: var(--or); color: var(--sable); }
	.badge.accepted { background: #3498db; color: #fff; }

	.combate {
		display: flex;
		justify-content: space-around;
		align-items: center;
		margin-bottom: 24px;
	}

	.lado {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}

	.score {
		font-size: 24px;
		color: var(--or);
	}

	.vs {
		font-size: 32px;
		color: var(--gules);
		font-family: var(--display);
	}

	.timer-box {
		text-align: center;
		background: var(--sable-2);
		padding: 12px;
		border: 1px solid var(--borda);
		border-radius: 4px;
	}

	.timer-box p {
		margin: 0;
		font-size: 12px;
		color: var(--argent-fraco);
	}

	.botoes-pendente {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-top: 12px;
	}

	.aceitar { background: var(--vert); color: var(--sable); border: none; padding: 8px; font-weight: bold; }
	.recusar { background: var(--gules); color: #fff; border: none; padding: 8px; font-weight: bold; }

	.vazio {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
	}

	.icon { font-size: 48px; margin-bottom: 16px; opacity: 0.5; }
	.vazio h3 { margin: 0; color: var(--or); }
	.vazio p { font-size: 13px; color: var(--argent-fraco); margin: 8px 0 24px; }

	.declarar {
		padding: 12px 24px;
		background: var(--or);
		color: var(--sable);
		font-weight: bold;
		border: none;
		border-radius: 2px;
		cursor: pointer;
	}
</style>
