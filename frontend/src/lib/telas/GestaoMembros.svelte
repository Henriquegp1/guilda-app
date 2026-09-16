<script lang="ts">
	import { onMount } from 'svelte';
	import {
		membros, alterarCargo, transferirLideranca, sair, expulsar, salvarSettingsGuilda,
		obterPerfil, salvarPerfil, contribuicoesXp, contribuicoesXpSemana, ErroApi,
		type Guilda, type Membro, type Cargo, type ContribuicaoMembro
	} from '$lib/api';
	import { entrarBloco } from '$lib/motion';
	import { onAuth, pedirIdentidade, viewerStore } from '$lib/twitch';
	import Brasao from '$lib/ui/Brasao.svelte';

	let { guilda, cargoAtor, aoSair, aoAtualizar }: { guilda: Guilda; cargoAtor: Cargo; aoSair: () => void; aoAtualizar: () => void } = $props();

	let lista = $state<Membro[]>([]);
	let contribuicoes = $state<Map<string, ContribuicaoMembro>>(new Map());
	let erroContribuicoes = $state('');
	let topSemana = $state<ContribuicaoMembro[]>([]);
	let erroTopSemana = $state('');
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
	let perfilAberto = $state<Membro | null>(null);
	let membroParaLiderar = $state<Membro | null>(null);
	let transferindoLideranca = $state(false);

	// Boas-vindas: banner de "acabou de chegar", só pra quem entrou há pouco
	// tempo (mesmo limiar de 2 dias usado como "recente" no resto da tela).
	const BOAS_VINDAS_HORAS = 48;
	const meuMembro = $derived(lista.find((m) => m.user_id === meuId) ?? null);
	const souRecemChegado = $derived(
		meuMembro ? (Date.now() - new Date(meuMembro.joined_at).getTime()) / 3_600_000 <= BOAS_VINDAS_HORAS : false
	);

	onMount(() => {
		const unsubViewer = viewerStore.subscribe(v => {
			meuId = v.userId || '';
			temUserId = !!v.userId && !v.userId.startsWith('U');
		});
		carregar();
		carregarContribuicoes();
		carregarTopSemana();
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

	async function carregarContribuicoes() {
		erroContribuicoes = '';
		try {
			// A rota pagina 25 por vez (máx. 50); para o tamanho atual de guilda
			// (limite bem abaixo disso) uma página cobre todo mundo.
			const res = await contribuicoesXp(guilda.id);
			contribuicoes = new Map(res.items.map((c) => [c.user_id, c]));
		} catch (e) {
			erroContribuicoes = e instanceof ErroApi ? e.message : 'Não foi possível carregar a contribuição de XP.';
		}
	}

	async function carregarTopSemana() {
		erroTopSemana = '';
		try {
			const res = await contribuicoesXpSemana(guilda.id);
			topSemana = res.items;
		} catch (e) {
			erroTopSemana = e instanceof ErroApi ? e.message : 'Não foi possível carregar o destaque da semana.';
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

	// Diferente de expulsar/mudar cargo: aqui é a própria líder abrindo mão do
	// posto, então uma confirmação simples de "sim/não" no lugar do padrão
	// motivo+auditoria dos outros modais de moderação não se aplica.
	async function acaoTransferirLideranca() {
		if (!membroParaLiderar) return;
		const m = membroParaLiderar;
		membroParaLiderar = null;
		transferindoLideranca = true;
		erro = '';
		try {
			await transferirLideranca(guilda.id, m.user_id);
			await carregar();
			aoAtualizar();
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao transferir liderança.';
		} finally {
			transferindoLideranca = false;
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

	const CARGO_LABEL: Record<Cargo, string> = {
		lider: 'Líder',
		'sub-lider': 'Sub-líder',
		comandante: 'Comandante',
		vassalo: 'Vassalo'
	};

	function tenureDias(iso: string) {
		return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
	}

	function dataFormatada(iso: string) {
		return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
	}

	// Fundador e veterano não são cargos (a escada de cargos é só vassalo →
	// comandante → sub-lider → lider, ver permissions.js). "Fundador" é quem
	// tem o joined_at mais antigo da guilda; "veterano" é tempo de casa acima
	// de um limiar. `membros()` já devolve a lista ordenada por joined_at ASC,
	// então o primeiro item da lista é sempre o fundador.
	const VETERANO_DIAS = 30;

	const fundadorId = $derived(lista[0]?.user_id ?? null);

	const eVeterano = (m: Membro) => {
		const dias = (Date.now() - new Date(m.joined_at).getTime()) / 86_400_000;
		return dias >= VETERANO_DIAS;
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
	{#if erroContribuicoes}
		<p class="erro">
			{erroContribuicoes}
			<button class="link-retry" onclick={carregarContribuicoes}>Tentar de novo</button>
		</p>
	{/if}

	{#if souRecemChegado}
		<div class="boas-vindas" in:entrarBloco>
			🎉 Bem-vindo(a) à guilda, {meuMembro?.nickname || 'aventureiro(a)'}! Dá uma olhada nos destaques da
			semana e nas missões pra já começar a somar prestígio.
		</div>
	{/if}


	{#if topSemana.length > 0}
		<div class="top-semana">
			<h4>🏆 Destaques da semana</h4>
			<div class="top-lista">
				{#each topSemana.slice(0, 3) as t, i}
					<span class="top-item">
						{['🥇', '🥈', '🥉'][i]} {lista.find(m => m.user_id === t.user_id)?.nickname || t.user_id}
						<small>{t.xp_total.toLocaleString('pt-BR')} XP</small>
					</span>
				{/each}
			</div>
		</div>
	{:else if erroTopSemana}
		<p class="erro">
			{erroTopSemana}
			<button class="link-retry" onclick={carregarTopSemana}>Tentar de novo</button>
		</p>
	{/if}

	<div class="lista">
		{#each lista as m (m.user_id)}
			<div class="membro" class:eu={m.user_id === meuId}>
				<button class="info" onclick={() => (perfilAberto = m)}>
					<span class="id">
						{m.user_id === meuId ? `🛡️ VOCÊ (${m.nickname || m.user_id})` : (m.nickname || `ID: ${m.user_id}`)}
					</span>
					<span class="selos">
						{#if m.user_id === fundadorId}
							<span class="selo selo-fundador" title="Fundador da guilda">👑 Fundador</span>
						{:else if eVeterano(m)}
							<span class="selo selo-veterano" title="Membro há {VETERANO_DIAS}+ dias">🎖️ Veterano</span>
						{/if}
					</span>
					<span class="cargo-atual">{m.role}</span>
					{#if contribuicoes.has(m.user_id)}
						<span class="contribuicao">
							{contribuicoes.get(m.user_id)!.xp_total.toLocaleString('pt-BR')} XP
							<small>(#{contribuicoes.get(m.user_id)!.rank} na guilda)</small>
						</span>
					{/if}
				</button>

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
						<button class="expulsar" onclick={() => (membroParaExpulsar = m)} title="Expulsar" aria-label={`Expulsar ${m.nickname || m.user_id}`}>🗑️</button>
						{#if cargoAtor === 'lider' && m.user_id !== meuId}
							<button class="coroar" onclick={() => (membroParaLiderar = m)} title="Tornar líder" aria-label={`Tornar ${m.nickname || m.user_id} líder da guilda`}>👑</button>
						{/if}
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

	{#if membroParaLiderar}
		<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="titulo-lideranca" in:entrarBloco>
			<div class="modal-box">
				<h4 id="titulo-lideranca">Transferir Liderança</h4>
				<p>
					Tornar <b>{membroParaLiderar.nickname || membroParaLiderar.user_id}</b> a nova líder da guilda?
					Você vira sub-líder e não pode desfazer isso sozinha depois.
				</p>
				<div class="modal-botoes">
					<button class="btn-perigo" disabled={transferindoLideranca} onclick={acaoTransferirLideranca}>
						{transferindoLideranca ? 'Transferindo...' : 'Transferir'}
					</button>
					<button class="btn-cancelar" disabled={transferindoLideranca} onclick={() => (membroParaLiderar = null)}>
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

	{#if perfilAberto}
		<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="titulo-perfil" in:entrarBloco>
			<div class="modal-box perfil-box">
				<button class="fechar-perfil" onclick={() => (perfilAberto = null)} aria-label="Fechar">✕</button>
				<h4 id="titulo-perfil">{perfilAberto.nickname || `ID: ${perfilAberto.user_id}`}</h4>

				<div class="perfil-selos">
					{#if perfilAberto.user_id === fundadorId}
						<span class="selo selo-fundador">👑 Fundador</span>
					{:else if eVeterano(perfilAberto)}
						<span class="selo selo-veterano">🎖️ Veterano</span>
					{/if}
					{#if perfilAberto.user_id === meuId}
						<span class="selo">🛡️ Você</span>
					{/if}
				</div>

				<dl class="perfil-dados">
					<div><dt>Cargo</dt><dd>{CARGO_LABEL[perfilAberto.role]}</dd></div>
					<div><dt>Na guilda desde</dt><dd>{dataFormatada(perfilAberto.joined_at)}</dd></div>
					<div><dt>Tempo de casa</dt><dd>{tenureDias(perfilAberto.joined_at)} dias</dd></div>
					{#if contribuicoes.has(perfilAberto.user_id)}
						<div>
							<dt>Contribuição de XP</dt>
							<dd>{contribuicoes.get(perfilAberto.user_id)!.xp_total.toLocaleString('pt-BR')} XP (#{contribuicoes.get(perfilAberto.user_id)!.rank} na guilda)</dd>
						</div>
					{/if}
				</dl>

				<div class="modal-botoes">
					<button class="btn-cancelar" onclick={() => (perfilAberto = null)}>Fechar</button>
				</div>
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

	.top-semana {
		background: rgba(212, 175, 55, 0.06);
		border: 1px solid var(--or);
		border-radius: 4px;
		padding: 8px 10px;
		margin-bottom: 10px;
	}
	.top-semana h4 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; color: var(--or); letter-spacing: 0.05em; }
	.top-lista { display: flex; flex-direction: column; gap: 3px; }
	.top-item { font-size: 11px; color: var(--argent); display: flex; justify-content: space-between; }
	.top-item small { color: var(--argent-fraco); }

	.link-retry {
		background: none;
		border: none;
		padding: 0;
		margin-left: 6px;
		color: var(--or);
		font-size: 11px;
		text-decoration: underline;
		cursor: pointer;
	}

	.lista { flex: 1; overflow-y: auto; overflow-x: hidden; display: flex; flex-direction: column; gap: 6px; padding-bottom: 12px; }
	.membro { display: flex; align-items: center; justify-content: space-between; padding: 10px; background: var(--sable-2); border: 1px solid var(--borda); border-radius: 4px; width: 100%; }
	.membro.eu { border-color: var(--or); background: rgba(212, 175, 55, 0.05); }

	.info { display: flex; flex-direction: column; gap: 2px; background: none; border: none; padding: 0; margin: 0; font-family: inherit; text-align: left; cursor: pointer; }
	.info:hover .id { color: var(--or); }
	.id { font-size: 10px; color: var(--argent); font-weight: bold; }
	.cargo-atual { font-size: 9px; text-transform: uppercase; color: var(--or); opacity: 0.8; }
	.selos { display: flex; }
	.selo { font-size: 9px; font-weight: bold; padding: 1px 5px; border-radius: 2px; width: fit-content; }
	.selo-fundador { color: var(--or); background: rgba(212, 175, 55, 0.12); border: 1px solid var(--or); }
	.selo-veterano { color: var(--argent); background: rgba(255, 255, 255, 0.06); border: 1px solid var(--borda); }

	.boas-vindas {
		background: rgba(212, 175, 55, 0.08);
		border: 1px solid var(--or);
		border-radius: 4px;
		padding: 10px 12px;
		font-size: 11px;
		color: var(--argent);
		line-height: 1.4;
		margin-bottom: 10px;
	}
	.contribuicao { font-size: 10px; color: var(--vert); margin-top: 2px; }
	.contribuicao small { color: var(--argent-fraco); }

	.link-retry {
		background: none;
		border: none;
		padding: 0;
		margin-left: 6px;
		color: var(--or);
		font-size: 11px;
		text-decoration: underline;
		cursor: pointer;
	}

	.acoes { display: flex; align-items: center; gap: 8px; }
	select { background: var(--sable); color: var(--argent); border: 1px solid var(--borda); font-size: 10px; padding: 3px; border-radius: 2px; outline: none; }
	.expulsar { background: none; border: none; font-size: 14px; cursor: pointer; padding: 4px; filter: grayscale(1); opacity: 0.6; }
	.expulsar:hover { filter: none; opacity: 1; }
	.coroar { background: none; border: none; font-size: 14px; cursor: pointer; padding: 4px; filter: grayscale(1); opacity: 0.6; }
	.coroar:hover { filter: none; opacity: 1; }

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

	.perfil-box { position: relative; text-align: left; }
	.fechar-perfil {
		position: absolute;
		top: 10px;
		right: 10px;
		background: none;
		border: none;
		color: var(--argent-fraco);
		font-size: 14px;
		min-height: auto;
		padding: 2px 6px;
		cursor: pointer;
	}
	.perfil-box h4 { text-align: left; padding-right: 24px; }
	.perfil-selos { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
	.perfil-dados { display: flex; flex-direction: column; gap: 8px; margin: 0 0 16px; }
	.perfil-dados div { display: flex; justify-content: space-between; gap: 8px; font-size: 11px; border-bottom: 1px solid var(--borda); padding-bottom: 6px; }
	.perfil-dados dt { color: var(--argent-fraco); text-transform: uppercase; font-size: 9px; }
	.perfil-dados dd { color: var(--argent); margin: 0; text-align: right; }

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