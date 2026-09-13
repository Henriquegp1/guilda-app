<script lang="ts">
	import { onMount } from 'svelte';
	import {
		membros, alterarCargo, sair, expulsar, salvarSettingsGuilda,
		obterPerfil, salvarPerfil, ErroApi, type Guilda, type Membro, type Cargo
	} from '$lib/api';
	import { entrarBloco } from '$lib/motion';
	import { onAuth, pedirIdentidade, viewerStore } from '$lib/twitch';
	import Brasao from '$lib/ui/Brasao.svelte';

	let { guilda, cargoAtor, aoSair, aoAtualizar }: { guilda: Guilda; cargoAtor: Cargo; aoSair: () => void; aoAtualizar: () => void } = $props();

	let lista = $state<Membro[]>([]);
	let meuId = $state('');
	let meuNick = $state<string | null>(null);
	let meuNickStatus = $state<string | null>(null);
	let temUserId = $state(false);

	let ocupado = $state(false);
	let erro = $state('');
	let modoEntrada = $state(guilda.join_mode ?? 'approval');
	let alterandoModo = $state(false);

	// Estados para modais
	let confirmandoSair = $state(false);
	let membroParaExpulsar = $state<Membro | null>(null);
	let editandoMeuPerfil = $state(false);
	let novoNomeInput = $state('');
	let salvandoPerfil = $state(false);

	onMount(() => {
		const unsubViewer = viewerStore.subscribe(v => {
			meuId = v.userId || '';
			temUserId = !!v.userId && !v.userId.startsWith('U');
		});
		carregar();
		carregarMeuPerfil();
		return () => unsubViewer();
	});

	async function carregarMeuPerfil() {
		try {
			const res = await obterPerfil();
			meuNick = res.nickname;
			meuNickStatus = res.status;
			novoNomeInput = meuNick || '';
		} catch (e) {}
	}

	async function salvarMeuPerfil() {
		if (!novoNomeInput.trim()) return;
		salvandoPerfil = true;
		try {
			const res = await salvarPerfil(novoNomeInput.trim());
			meuNick = res.nickname;
			meuNickStatus = res.status;
			editandoMeuPerfil = false;
			await carregar(); // Atualiza a lista para mostrar o nome novo
		} catch (e: any) {
			erro = e.message || 'Erro ao salvar perfil.';
		} finally {
			salvandoPerfil = false;
		}
	}

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

	const CARGOS: Cargo[] = ['lider', 'sub-lider', 'comandante', 'vassalo'];

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
	<!-- Perfil do Jogador RPG -->
	<div class="meu-perfil-rpg">
		<div class="header-perfil">
			<span>⚔️ Meu Personagem</span>
			{#if meuNickStatus === 'pending_review'}
				<span class="status-tag pendente">Em Análise</span>
			{:else if meuNickStatus === 'approved'}
				<span class="status-tag aprovado">Aprovado</span>
			{:else if meuNickStatus === 'rejected'}
				<span class="status-tag rejeitado">Rejeitado</span>
			{/if}
		</div>

		<div class="corpo-perfil">
			<span class="nick-exibicao">{meuNick || 'Sem Nome de Personagem'}</span>
			<button class="btn-editar-perfil" onclick={() => (editandoMeuPerfil = true)}>
				{meuNick ? 'Alterar' : 'Criar Personagem'}
			</button>
		</div>
	</div>

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
						{m.user_id === meuId ? `🛡️ VOCÊ (${m.nickname || m.user_id})` : (m.nickname || `ID: ${m.user_id}`)}
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
		<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="titulo-sair" in:entrarBloco>
			<div class="modal-box">
				<h4 id="titulo-sair">Confirmar Saída</h4>
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
		<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="titulo-expulsar" in:entrarBloco>
			<div class="modal-box">
				<h4 id="titulo-expulsar">Expulsar Membro</h4>
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

	{#if editandoMeuPerfil}
		<div class="modal-backdrop" role="dialog" aria-modal="true" in:entrarBloco>
			<div class="modal-box">
				<Brasao tamanho={48} />
				<h4>Nome do Personagem</h4>
				<p>Escolha como você quer ser chamado nas listas de membros.</p>

				{#if !temUserId}
					<p class="nota gules">⚠️ Autorize a identidade para o clã salvar seu nome.</p>
					<button class="btn-perigo" onclick={pedirIdentidade}>Autorizar Twitch</button>
				{:else}
					<input
						type="text"
						class="input-nick"
						bind:value={novoNomeInput}
						placeholder="Ex: Sir_Lancelot"
						maxlength={20}
					/>
					<div class="modal-botoes">
						<button class="btn-perigo" disabled={salvandoPerfil || !novoNomeInput.trim()} onclick={salvarMeuPerfil}>
							{salvandoPerfil ? 'Salvando...' : 'Salvar Nome'}
						</button>
						<button class="btn-cancelar" onclick={() => (editandoMeuPerfil = false)}>Fechar</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.gestao { flex: 1; display: flex; flex-direction: column; padding: 12px; min-height: 0; overflow-x: hidden; position: relative; }

	.meu-perfil-rpg { background: var(--sable-2); border: 1px solid var(--borda); border-radius: 4px; padding: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
	.header-perfil { display: flex; justify-content: space-between; align-items: center; font-size: 10px; font-weight: bold; color: var(--or); text-transform: uppercase; letter-spacing: 0.05em; }
	.status-tag { padding: 2px 6px; border-radius: 2px; font-size: 8px; color: white; }
	.status-tag.pendente { background: #3b3b10; color: #ffeb3b; }
	.status-tag.aprovado { background: #103b10; color: #4caf50; }
	.status-tag.rejeitado { background: var(--gules); }

	.corpo-perfil { display: flex; justify-content: space-between; align-items: center; }
	.nick-exibicao { font-size: 14px; font-family: var(--display); color: var(--argent); font-weight: bold; }
	.btn-editar-perfil { background: none; border: 1px solid var(--borda); color: var(--or); font-size: 10px; padding: 4px 10px; min-height: auto; border-radius: 2px; }

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

	.input-nick {
		width: 100%;
		padding: 10px;
		background: var(--sable);
		border: 1px solid var(--borda);
		color: var(--argent);
		font-family: inherit;
		text-align: center;
		margin-bottom: 16px;
		border-radius: 4px;
	}
</style>
