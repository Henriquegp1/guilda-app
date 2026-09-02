<script lang="ts">
	import { memberEligibility, editarRoster, type Guerra, type MemberEligibility, type WarRosterItem } from '$lib/api';
	import { onMount } from 'svelte';

	let { war, guildaId, currentRoster, aoSucesso, aoCancelar }: {
		war: Guerra;
		guildaId: number;
		currentRoster: WarRosterItem[];
		aoSucesso: () => void;
		aoCancelar: () => void;
	} = $props();

	let membros = $state<MemberEligibility[]>([]);
	let selecionados = $state<Set<string>>(new Set());
	let ocupado = $state(false);
	let erro = $state('');

	onMount(async () => {
		selecionados = new Set(currentRoster.map(r => r.user_id));
		try {
			const res = await memberEligibility(guildaId);
			membros = res.items;

			// Se o roster estiver vazio (primeira vez), auto-preencher com os mais ativos
			if (selecionados.size === 0) {
				membros
					.filter(m => m.is_eligible)
					.slice(0, war.roster_size)
					.forEach(m => selecionados.add(m.user_id));
			}
		} catch (e) {
			console.error(e);
			erro = 'Falha ao carregar elegibilidade.';
		}
	});

	function alternar(uid: string, eligible: boolean) {
		if (!eligible) return;
		if (selecionados.has(uid)) {
			selecionados.delete(uid);
		} else if (selecionados.size < war.roster_size) {
			selecionados.add(uid);
		}
	}

	async function salvar() {
		if (selecionados.size !== war.roster_size) {
			erro = `Escolha exatamente ${war.roster_size} membros.`;
			return;
		}

		ocupado = true;
		erro = '';
		try {
			await editarRoster(war.id, Array.from(selecionados));
			aoSucesso();
		} catch (e) {
			erro = e instanceof Error ? e.message : 'Falha ao salvar roster.';
		} finally {
			ocupado = false;
		}
	}
</script>

<div class="escalacao">
	<header>
		<button class="voltar" onclick={aoCancelar}>← Voltar</button>
		<h3>Escalando Time</h3>
		<span class="conta num">{selecionados.size}/{war.roster_size}</span>
	</header>

	<p class="instrucao">
		Escolha os membros que representarão a guilda. Apenas membros ativos nos últimos 7 dias são elegíveis.
	</p>

	<ul class="lista-membros">
		{#each membros as m}
			<button
				type="button"
				class="membro-btn-escalacao"
				class:selecionado={selecionados.has(m.user_id)}
				class:inativo={!m.is_eligible}
				onclick={() => alternar(m.user_id, m.is_eligible)}
			>
				<div class="check">{selecionados.has(m.user_id) ? '✓' : ''}</div>
				<div class="info">
					<b>{m.user_id}</b>
					<small>{m.role} · {m.events} eventos</small>
				</div>
				{#if !m.is_eligible}
					<span class="tag-erro">Inativo</span>
				{/if}
			</button>
		{/each}
	</ul>

	{#if erro}<p class="erro">{erro}</p>{/if}

	<div class="acoes">
		<button class="confirmar" disabled={ocupado || selecionados.size !== war.roster_size} onclick={salvar}>
			{ocupado ? 'Salvando...' : 'Confirmar Escalagem'}
		</button>
	</div>
</div>

<style>
	.escalacao {
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: 12px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.voltar { background: none; border: none; color: var(--or); cursor: pointer; font-size: 12px; }
	h3 { margin: 0; flex: 1; font-family: var(--display); font-size: 16px; }
	.conta { color: var(--or); }

	.instrucao { font-size: 11px; color: var(--argent-fraco); margin: 0; }

	.lista-membros {
		flex: 1;
		list-style: none;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.membro-btn-escalacao {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 2px;
		cursor: pointer;
		width: 100%;
		min-height: auto;
		font: inherit;
		color: inherit;
	}

	.membro-btn-escalacao.selecionado { border-color: var(--or); background: rgba(212, 175, 55, 0.1); }
	.membro-btn-escalacao.inativo { opacity: 0.4; cursor: not-allowed; }

	.check {
		width: 18px;
		height: 18px;
		border: 1px solid var(--borda);
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--or);
		font-weight: bold;
	}

	.selecionado .check { border-color: var(--or); }

	.info { flex: 1; }
	.info b { display: block; font-size: 13px; }
	.info small { font-size: 10px; color: var(--argent-fraco); }

	.tag-erro { font-size: 9px; color: var(--gules); text-transform: uppercase; border: 1px solid var(--gules); padding: 1px 4px; }

	.erro { color: var(--gules); font-size: 12px; margin: 0; }

	.acoes { margin-top: auto; padding-top: 10px; }
	.confirmar {
		width: 100%;
		padding: 12px;
		background: var(--or);
		color: var(--sable);
		font-weight: bold;
		border: none;
		border-radius: 2px;
	}
	.confirmar:disabled { opacity: 0.5; }
</style>
