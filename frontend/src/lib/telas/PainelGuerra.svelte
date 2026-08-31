<script lang="ts">
	import { wars, minhaGuerra } from '$lib/stores/warStore';
	import { onMount } from 'svelte';
	import { aceitarGuerra, recusarGuerra, type Guilda, type Cargo, type Guerra } from '$lib/api';
	import Brasao from '$lib/ui/Brasao.svelte';
	import DeclararGuerra from './DeclararGuerra.svelte';
	import EscalacaoGuerra from './EscalacaoGuerra.svelte';
	import { warDetails, type WarRosterItem } from '$lib/api';

	let { guilda, cargo }: { guilda: Guilda; cargo: Cargo } = $props();

	let guerra = minhaGuerra(guilda.id);
	let declarando = $state(false);
	let editandoRoster = $state(false);
	let ocupado = $state(false);
	let rosterAtual = $state<WarRosterItem[]>([]);

	async function carregarRoster() {
		if ($guerra) {
			try {
				const res = await warDetails($guerra.id);
				rosterAtual = res.roster.filter((r) => r.guild_id === guilda.id);
			} catch (e) {
				console.error(e);
			}
		}
	}

	$effect(() => {
		if ($guerra && (cargo === 'leader' || cargo === 'officer')) {
			carregarRoster();
		}
	});

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
		{@const total = $guerra.score_challenger + $guerra.score_defender}
		{@const pctChallenger = total > 0 ? ($guerra.score_challenger / total) * 100 : 50}
		<div class="guerra-ativa">
			<header class="status-header">
				<span class="badge {$guerra.status}">{$guerra.status.toUpperCase()}</span>
				<span class="formato">{$guerra.format.toUpperCase()}</span>
			</header>

			<div class="combate">
				<div class="lado">
					<Brasao tag={guilda.tag} tamanho={64} />
					<span class="score num">
						{$guerra.challenger_guild_id === guilda.id
							? $guerra.score_challenger
							: $guerra.score_defender}
					</span>
				</div>
				<div class="vs">⚔</div>
				<div class="lado">
					<Brasao
						tag={$guerra.challenger_guild_id === guilda.id ? $guerra.defender.tag : $guerra.challenger.tag}
						tamanho={64}
					/>
					<span class="score num">
						{$guerra.challenger_guild_id === guilda.id
							? $guerra.score_defender
							: $guerra.score_challenger}
					</span>
				</div>
			</div>

			<div class="progresso-conflito">
				<div class="barra-total">
					<div
						class="preenche challenger"
						style:width="{pctChallenger}%"
						style:background-color={$guerra.challenger_guild_id === guilda.id
							? 'var(--vert)'
							: 'var(--gules)'}
					></div>
					<div
						class="preenche defender"
						style:width="{100 - pctChallenger}%"
						style:background-color={$guerra.defender_guild_id === guilda.id
							? 'var(--vert)'
							: 'var(--gules)'}
					></div>
				</div>
				<div class="labels-barra">
					<span>{Math.round(pctChallenger)}%</span>
					<span>{Math.round(100 - pctChallenger)}%</span>
				</div>
			</div>

			<div class="timer-box">
				{#if $guerra.status === 'pending' || $guerra.status === 'accepted'}
					{#if $guerra.status === 'pending'}
						<p>
							Desafio expira em: <span class="num">{formatarTempo($guerra.challenge_expires_at)}</span>
						</p>
					{:else}
						<p>Começa em: <span class="num">{formatarTempo($guerra.starts_at)}</span></p>
					{/if}

					{#if cargo === 'leader' || cargo === 'officer'}
						<button class="ajuste-roster" onclick={() => (editandoRoster = true)}>
							Escalar Time ({rosterAtual.length}/{$guerra.roster_size})
						</button>
						{#if $guerra.status === 'pending' && $guerra.defender_guild_id === guilda.id}
							<div class="botoes-pendente">
								<button
									class="aceitar"
									disabled={ocupado}
									onclick={() => responder($guerra!.id, 'aceitar')}>Aceitar</button
								>
								<button
									class="recusar"
									disabled={ocupado}
									onclick={() => responder($guerra!.id, 'recusar')}>Recusar</button
								>
							</div>
						{/if}
					{/if}
				{:else if $guerra.status === 'active'}
					<p>Termina em: <span class="num">{formatarTempo($guerra.ends_at)}</span></p>
				{/if}
			</div>
		</div>
	{:else if editandoRoster && $guerra}
		<EscalacaoGuerra
			war={$guerra}
			guildaId={guilda.id}
			currentRoster={rosterAtual}
			aoSucesso={() => {
				editandoRoster = false;
				carregarRoster();
			}}
			aoCancelar={() => (editandoRoster = false)}
		/>
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

	.progresso-conflito {
		margin-bottom: 24px;
	}

	.barra-total {
		height: 8px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 4px;
		display: flex;
		overflow: hidden;
	}

	.preenche {
		height: 100%;
		transition: width 0.6s cubic-bezier(0.2, 1, 0.3, 1);
	}

	.labels-barra {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		font-size: 10px;
		color: var(--argent-fraco);
		font-family: var(--texto);
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
	.ajuste-roster {
		margin-top: 10px;
		width: 100%;
		background: none;
		border: 1px solid var(--or);
		color: var(--or);
		padding: 6px;
		font-size: 11px;
		text-transform: uppercase;
		cursor: pointer;
	}
</style>
