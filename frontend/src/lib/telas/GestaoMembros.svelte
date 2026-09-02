<script lang="ts">
	import { onMount } from 'svelte';
	import { membros, alterarCargo, sair, expulsar, salvarSettingsGuilda, ErroApi, type Guilda, type Membro, type Cargo } from '$lib/api';
	import { entrarBloco } from '$lib/motion';
	import { onAuth } from '$lib/twitch';

	let { guilda, cargoAtor, aoSair, aoAtualizar }: { guilda: Guilda; cargoAtor: Cargo; aoSair: () => void; aoAtualizar: () => void } = $props();

	let lista = $state<Membro[]>([]);
	let meuId = $state('');
	let ocupado = $state(false);
	let erro = $state('');
	let modoEntrada = $state(guilda.join_mode ?? 'approval');
	let alterandoModo = $state(false);

	async function mudarModoEntrada(novoModo: 'open' | 'approval' | 'closed') {
		alterandoModo = true;
		erro = '';
		try {
			await salvarSettingsGuilda(guilda.id, { join_mode: novoModo });
			modoEntrada = novoModo;
			guilda.join_mode = novoModo;
			aoAtualizar();
		} catch (e) {
			erro = 'Erro ao alterar modo de entrada.';
		} finally {
			alterandoModo = false;
		}
	}

	// Estados para modais de confirmação internos (Sem usar window.confirm/alert que a Twitch bloqueia)
	let confirmandoSair = $state(false);
	let membroParaExpulsar = $state<Membro | null>(null);

	const CARGOS: Cargo[] = ['lider', 'sub-lider', 'comandante', 'vassalo'];

	onMount(() => {
		onAuth((auth) => {
			meuId = auth.userId;
			console.log('[Gestao] Logado como:', meuId);
		});
		carregar();
	});

	async function carregar() {
		try {
			const res = await membros(guilda.id);
			lista = res.members;
		} catch (e) {
			erro = 'Erro ao carregar membros.';
		}
	}

	async function mudarCargo(m: Membro, novo: Cargo) {
		if (ocupado) return;
		ocupado = true;
		erro = '';
		try {
			await alterarCargo(guilda.id, m.user_id, novo);
			await carregar();
			aoAtualizar();
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao mudar cargo.';
		} finally {
			ocupado = false;
		}
	}

	async function acaoExpulsar() {
		if (!membroParaExpulsar) return;
		const m = membroParaExpulsar;
		membroParaExpulsar = null;
		ocupado = true;
		erro = '';
		try {
			await expulsar(guilda.id, m.user_id);
			await carregar();
			aoAtualizar();
		} catch (e) {
			erro = 'Erro ao expulsar membro.';
		} finally {
			ocupado = false;
		}
	}

	async function acaoSair() {
		confirmandoSair = false;
		ocupado = true;
		erro = '';
		try {
			await sair(guilda.id);
			aoSair();
		} catch (e) {
			erro = 'Erro ao sair da guilda.';
		} finally {
			ocupado = false;
		}
	}

	// Regras de UI: Lider pode mudar todos abaixo. Sub-lider pode mudar comandantes e vassalos.
	const podeMudar = (alvo: Membro) => {
		if (alvo.user_id === meuId) return false;
		if (alvo.role === 'lider') return false;
		if (cargoAtor === 'lider') return true;
		if (cargoAtor === 'sub-lider' && (alvo.role === 'comandante' || alvo.role === 'vassalo')) return true;
		return false;
	};
</script>

<div class="gestao" in:entrarBloco>
	{#if ['lider', 'sub-lider'].includes(cargoAtor)}
		<div class="secao-modo">
			<label for="select-modo">Modo de Entrada no Clã</label>
			<select
				id="select-modo"
				value={modoEntrada}
				disabled={alterandoModo}
				onchange={(e) => mudarModoEntrada(e.currentTarget.value as any)}
			>
				<option value="open">🟢 Entrada Livre (Qualquer pessoa entra)</option>
				<option value="approval">🟡 Por Aprovação (Viewer pede autorização)</option>
				<option value="closed">🔴 Fechado (Apenas por convite)</option>
			</select>
		</div>
	{/if}

	{#if erro}<p class="erro">{erro}</p>{/if}

	<div class="lista">
		{#each lista as m}
			<div class="membro" class:eu={m.user_id === meuId}>
				<div class="info">
					<span class="id">
						{m.user_id === meuId ? '🛡️ VOCÊ' : `ID: ${m.user_id}`}
					</span>
					<span class="cargo-atual">{m.role}</span>
				</div>

				<div class="acoes">
					{#if podeMudar(m)}
						<select
							value={m.role}
							disabled={ocupado}
							onchange={(e) => mudarCargo(m, e.currentTarget.value as Cargo)}
						>
							{#each CARGOS.filter(c => c !== 'lider') as c}
								<option value={c}>{c}</option>
							{/each}
						</select>
						<button class="expulsar" onclick={() => (membroParaExpulsar = m)} title="Expulsar">🗑️</button>
					{/if}
				</div>
			</div>
		{/each}
	</div>

	<div class="rodape-gestao">
		<button class="btn-sair" disabled={ocupado} onclick={() => (confirmandoSair = true)}>
			Sair da Guilda
		</button>
	</div>

	{#if confirmandoSair}
		<div class="modal-backdrop" in:entrarBloco>
			<div class="modal-box">
				<h4>Confirmar Saída</h4>
				<p>
					{#if cargoAtor === 'lider'}
						Você é o líder. Ao sair, a liderança passará automaticamente para o sub-líder.
					{:else}
						Deseja realmente sair da guilda {guilda.name}?
					{/if}
				</p>
				<div class="modal-botoes">
					<button class="btn-perigo" disabled={ocupado} onclick={acaoSair}>
						{ocupado ? 'Saindo...' : 'Sim, Sair'}
					</button>
					<button class="btn-cancelar" disabled={ocupado} onclick={() => (confirmandoSair = false)}>
						Cancelar
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if membroParaExpulsar}
		<div class="modal-backdrop" in:entrarBloco>
			<div class="modal-box">
				<h4>Expulsar Membro</h4>
				<p>Deseja expulsar o membro ID: {membroParaExpulsar.user_id}?</p>
				<div class="modal-botoes">
					<button class="btn-perigo" disabled={ocupado} onclick={acaoExpulsar}>
						{ocupado ? 'Expulsando...' : 'Expulsar'}
					</button>
					<button class="btn-cancelar" disabled={ocupado} onclick={() => (membroParaExpulsar = null)}>
						Cancelar
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.gestao { flex: 1; display: flex; flex-direction: column; padding: 12px; min-height: 0; overflow-x: hidden; position: relative; }
	.secao-modo { display: flex; flex-direction: column; gap: 4px; margin-bottom: 10px; padding: 10px; background: var(--sable-2); border: 1px solid var(--borda); border-radius: 4px; }
	.secao-modo label { font-size: 10px; text-transform: uppercase; color: var(--or); font-weight: bold; letter-spacing: 0.05em; }
	.secao-modo select { background: var(--sable); color: var(--argent); border: 1px solid var(--borda); font-size: 10px; padding: 6px; border-radius: 2px; width: 100%; outline: none; }

	.erro { color: var(--gules); font-size: 11px; margin-bottom: 8px; text-align: center; }
	.lista { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 6px; padding-bottom: 12px; }
	.membro { display: flex; align-items: center; justify-content: space-between; padding: 10px; background: var(--sable-2); border: 1px solid var(--borda); border-radius: 4px; width: 100%; }
	.membro.eu { border-color: var(--or); background: rgba(212, 175, 55, 0.05); }

	.info { display: flex; flex-direction: column; gap: 2px; }
	.id { font-size: 10px; color: var(--argent); font-weight: bold; }
	.cargo-atual { font-size: 9px; text-transform: uppercase; color: var(--or); opacity: 0.8; }

	.acoes { display: flex; align-items: center; gap: 8px; }
	select { background: var(--sable); color: var(--argent); border: 1px solid var(--borda); font-size: 10px; padding: 3px; border-radius: 2px; outline: none; }
	.expulsar { background: none; border: none; font-size: 14px; cursor: pointer; padding: 4px; filter: grayscale(1); opacity: 0.6; }
	.expulsar:hover { filter: none; opacity: 1; }

	.rodape-gestao { padding-top: 12px; border-top: 1px solid var(--borda); }
	.btn-sair { width: 100%; padding: 10px; background: rgba(255, 0, 0, 0.1); border: 1px solid var(--gules); color: #ff4d4d; font-size: 11px; font-weight: bold; text-transform: uppercase; border-radius: 4px; cursor: pointer; transition: background 0.2s; }
	.btn-sair:hover { background: rgba(255, 0, 0, 0.2); }

	.modal-backdrop {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.85);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		z-index: 200;
	}

	.modal-box {
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 6px;
		padding: 16px;
		width: 100%;
		text-align: center;
		box-shadow: 0 4px 20px rgba(0,0,0,0.8);
	}

	.modal-box h4 {
		margin: 0 0 8px;
		color: var(--or);
		font-family: var(--display);
		font-size: 15px;
	}

	.modal-box p {
		font-size: 12px;
		color: var(--argent);
		margin: 0 0 16px;
		line-height: 1.4;
	}

	.modal-botoes {
		display: flex;
		gap: 8px;
	}

	.btn-perigo {
		flex: 1;
		background: var(--gules);
		color: #fff;
		border: none;
		padding: 8px;
		font-weight: bold;
		border-radius: 4px;
		cursor: pointer;
		font-size: 11px;
	}

	.btn-cancelar {
		flex: 1;
		background: var(--sable);
		color: var(--argent-fraco);
		border: 1px solid var(--borda);
		padding: 8px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 11px;
	}
</style>
