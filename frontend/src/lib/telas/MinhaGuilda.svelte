<script lang="ts">
	import Brasao from '$lib/ui/Brasao.svelte';
	import Banner from '$lib/ui/Banner.svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import EditorBrasao from './EditorBrasao.svelte';
	import GestaoMembros from './GestaoMembros.svelte';
	import Conquistas from './Conquistas.svelte';
	import {
		progressao,
		posicaoDa,
		progressoSemanal,
		resumoSemanal,
		missoesSemanal,
		missoesDiarias,
		sair,
		reenviarGuilda,
		listarTerritorios,
		carregarConquistas,
		historicoIdentidade,
		feedAtividades,
		historicoCompras,
		estatisticasLoja,
		ErroApi
	} from '$lib/api';
	import type { Guilda, Cargo, Progressao, ProgressoSemanal, ResumoSemanal, MissaoSemanal, MissaoDiaria, Territory, Achievement, IdentityHistoryItem, AtividadeFeedItem, CompraLoja, EstatisticasLoja } from '$lib/api';
	import { gsap, dur, entrarBloco } from '$lib/motion';

	let {
		guilda,
		cargo,
		aoSair,
		aoAtualizar
	}: { guilda: Guilda; cargo: Cargo; aoSair: () => void; aoAtualizar: () => void } = $props();

	let prog = $state<Progressao | null>(null);
	let semanal = $state<ProgressoSemanal | null>(null);
	let resumo = $state<ResumoSemanal | null>(null);
	let missoesSemana = $state<MissaoSemanal[]>([]);
	let missoesDia = $state<MissaoDiaria[]>([]);
	let missoesAbertas = $state(false);
	let posicao = $state<number | null>(null);
	let terrs = $state<Territory[]>([]);
	let medalhas = $state<Achievement[]>([]);
	let aviso = $state('');
	let barra = $state<HTMLDivElement>();
	let editando = $state(false);
	let vendoConquistas = $state(false);
	let vendoMembros = $state(false);
	let historico = $state<IdentityHistoryItem[]>([]);
	let historicoAberto = $state(false);
	let historicoCarregado = $state(false);
	let feed = $state<AtividadeFeedItem[]>([]);
	let feedAberto = $state(false);
	let feedCarregado = $state(false);
	let compras = $state<CompraLoja[]>([]);
	let stats = $state<EstatisticasLoja | null>(null);
	let lojaAberta = $state(false);
	let lojaCarregada = $state(false);

	// Falha em qualquer bloco abaixo não derruba a tela: o essencial já está na
	// prop `guilda`. Mas a falha precisa aparecer — cada bloco guarda seu
	// próprio erro e oferece "tentar de novo", em vez de sumir em silêncio.
	let erroProg = $state('');
	let erroPosicao = $state('');
	let erroSemanal = $state('');
	let erroResumo = $state('');
	let erroMissoesSemana = $state('');
	let erroMissoesDia = $state('');
	let erroTerrs = $state('');
	let erroMedalhas = $state('');
	let erroHistorico = $state('');
	let erroFeed = $state('');
	let erroLoja = $state('');
	let reenviando = $state(false);
	let erroReenvio = $state('');

	const mensagemErro = (e: unknown, fallback: string) =>
		e instanceof ErroApi ? e.message : fallback;

	function carregarProgressao() {
		erroProg = '';
		progressao(guilda.id)
			.then((p) => (prog = p))
			.catch((e) => (erroProg = mensagemErro(e, 'Não foi possível carregar seu progresso.')));
	}

	function carregarPosicao() {
		erroPosicao = '';
		posicaoDa(guilda.id)
			.then((r) => (posicao = r.position))
			.catch((e) => (erroPosicao = mensagemErro(e, 'Não foi possível carregar a posição no ranking.')));
	}

	function carregarSemanal() {
		erroSemanal = '';
		progressoSemanal(guilda.id)
			.then((p) => (semanal = p))
			.catch((e) => (erroSemanal = mensagemErro(e, 'Não foi possível carregar a meta semanal.')));
	}

	function carregarResumo() {
		erroResumo = '';
		resumoSemanal(guilda.id)
			.then((r) => (resumo = r))
			.catch((e) => (erroResumo = mensagemErro(e, 'Não foi possível carregar o resumo da semana.')));
	}

	function carregarMissoesSemana() {
		erroMissoesSemana = '';
		missoesSemanal(guilda.id)
			.then((r) => (missoesSemana = r.items))
			.catch((e) => (erroMissoesSemana = mensagemErro(e, 'Não foi possível carregar as missões da semana.')));
	}

	function carregarMissoesDia() {
		erroMissoesDia = '';
		missoesDiarias()
			.then((r) => (missoesDia = r.items))
			.catch((e) => (erroMissoesDia = mensagemErro(e, 'Não foi possível carregar as missões diárias.')));
	}

	function carregarTerritoriosDaGuilda() {
		erroTerrs = '';
		listarTerritorios()
			.then((res) => (terrs = res.items.filter((t) => t.owner_guild_id === guilda.id)))
			.catch((e) => (erroTerrs = mensagemErro(e, 'Não foi possível carregar os territórios.')));
	}

	function carregarMedalhas() {
		erroMedalhas = '';
		carregarConquistas(guilda.id)
			.then((res) => (medalhas = res.unlocked.slice(0, 4)))
			.catch((e) => (erroMedalhas = mensagemErro(e, 'Não foi possível carregar as conquistas.')));
	}

	// Carregado sob demanda (só quando a seção é aberta), diferente dos blocos
	// acima: histórico de nome/TAG é consulta rara, não faz sentido puxar toda
	// vez que a tela abre.
	function carregarHistorico() {
		erroHistorico = '';
		historicoIdentidade(guilda.id)
			.then((r) => {
				historico = r.items;
				historicoCarregado = true;
			})
			.catch((e) => (erroHistorico = mensagemErro(e, 'Não foi possível carregar o histórico.')));
	}

	function alternarHistorico() {
		historicoAberto = !historicoAberto;
		if (historicoAberto && !historicoCarregado) carregarHistorico();
	}

	function carregarFeed() {
		erroFeed = '';
		feedAtividades(guilda.id)
			.then((r) => {
				feed = r.items;
				feedCarregado = true;
			})
			.catch((e) => (erroFeed = mensagemErro(e, 'Não foi possível carregar o feed de atividades.')));
	}

	function alternarFeed() {
		feedAberto = !feedAberto;
		if (feedAberto && !feedCarregado) carregarFeed();
	}

	// Etapa 9: histórico e estatísticas da loja (bits_purchase). Junta as duas
	// chamadas porque na prática quem abre uma quer ver a outra também.
	function carregarLoja() {
		erroLoja = '';
		Promise.all([historicoCompras(guilda.id), estatisticasLoja(guilda.id)])
			.then(([h, s]) => {
				compras = h.items;
				stats = s;
				lojaCarregada = true;
			})
			.catch((e) => (erroLoja = mensagemErro(e, 'Não foi possível carregar o histórico da loja.')));
	}

	function alternarLoja() {
		lojaAberta = !lojaAberta;
		if (lojaAberta && !lojaCarregada) carregarLoja();
	}

	// Fundação rejeitada trava em 'suspended' (status.js: resubmit só sai daí)
	// até alguém reenviar. Só a líder de fato (não sub-líder) pode chamar isso,
	// exatamente como o backend valida em guilds/index.js.
	async function acaoReenviar() {
		reenviando = true;
		erroReenvio = '';
		try {
			await reenviarGuilda(guilda.id);
			aoAtualizar();
		} catch (e) {
			erroReenvio = mensagemErro(e, 'Não foi possível reenviar a guilda para aprovação.');
		} finally {
			reenviando = false;
		}
	}

	const ESTADO_COMPRA_LABEL: Record<CompraLoja['state'], string> = {
		pending: 'Pendente',
		settled: 'Concluída',
		failed: 'Falhou',
		voided: 'Estornada'
	};

	// Ex: "há 3h", "há 2d" — não precisa de precisão de segundo, é feed social.
	function tempoRelativo(iso: string) {
		const diffMs = Date.now() - new Date(iso).getTime();
		const min = Math.floor(diffMs / 60_000);
		if (min < 1) return 'agora';
		if (min < 60) return `há ${min}min`;
		const h = Math.floor(min / 60);
		if (h < 24) return `há ${h}h`;
		return `há ${Math.floor(h / 24)}d`;
	}

	const ESTADO_HISTORICO_LABEL: Record<IdentityHistoryItem['state'], string> = {
		pending_review: 'Em análise',
		approved: 'Aprovado',
		rejected: 'Rejeitado',
		reverted: 'Revertido'
	};

	const CAMPO_HISTORICO_LABEL: Record<IdentityHistoryItem['field'], string> = {
		name: 'Nome',
		tag: 'TAG'
	};

	$effect(() => {
		carregarProgressao();
		carregarPosicao();
		carregarSemanal();
		carregarResumo();
		carregarMissoesSemana();
		carregarMissoesDia();
		carregarTerritoriosDaGuilda();
		carregarMedalhas();
	});

	const rendimentoTotal = $derived(terrs.reduce((sum, t) => sum + t.prestige_per_day, 0));

	// A barra cresce a partir de zero uma vez, quando o dado chega. Nada anima na
	// primeira pintura do painel (docs/MOVIMENTO.md) — isto acontece depois.
	$effect(() => {
		if (!prog || !barra) return;
		const ctx = gsap.context(() => {
			gsap.fromTo(
				barra,
				{ scaleX: 0 },
				{ scaleX: fracao, duration: dur(0.7), ease: 'power2.out' }
			);
		});
		return () => ctx.revert();
	});

	// XP acumulado necessário para o nível N: 250 * (N - 1) * N
	const xpForLevel = (n: number) => 250 * (Math.max(1, n) - 1) * Math.max(1, n);

	const xpInicioNivel = $derived(prog ? xpForLevel(prog.level) : 0);
	const xpFimNivel = $derived(prog && prog.xp_next_level ? prog.xp_next_level : xpInicioNivel);
	const xpNecessarioNoNivel = $derived(xpFimNivel - xpInicioNivel);
	const xpGanhoNoNivel = $derived(prog ? Math.max(0, prog.xp - xpInicioNivel) : 0);

	const fracao = $derived(
		xpNecessarioNoNivel > 0 ? Math.min(1, xpGanhoNoNivel / xpNecessarioNoNivel) : 1
	);

	const UNLOCK_LABELS: Record<string, string> = {
		emblem_base: 'Emblema Base',
		color_default: 'Cores Iniciais',
		description_140: 'Descrição (140 carac.)',
		description_280: 'Descrição Expandida',
		palette_6: 'Paleta de 6 Cores',
		motto: 'Lema da Guilda',
		frame_bronze: 'Moldura de Bronze',
		color_special: 'Cores Especiais',
		banner_custom: 'Banner Personalizado',
		xp_history: 'Histórico de XP',
		frame_silver: 'Moldura de Prata',
		member_badge: 'Insígnia de Membro',
		palette_12: 'Paleta de 12 Cores',
		banner_animated: 'Banner Animado',
		frame_gold: 'Moldura de Ouro',
		banner_frame: 'Moldura do Banner',
		guild_emote: 'Emote da Guilda',
		frame_platinum: 'Moldura de Platina',
		color_gradient: 'Cores em Gradiente',
		banner_glow: 'Brilho no Banner',
		frame_diamond: 'Moldura de Diamante',
		frame_legendary: 'Moldura Lendária',
		color_lv50: 'Cores de Nível Máximo',
		banner_signed: 'Banner Assinado'
	};

	const progressionFrame = $derived.by(() => {
		if (!prog) return undefined;
		const frames = [
			'frame_legendary',
			'frame_diamond',
			'frame_platinum',
			'frame_gold',
			'frame_silver',
			'frame_bronze'
		];
		return frames.find((f) => prog!.unlocks.includes(f));
	});

	const cNorm = $derived(String(cargo || '').toLowerCase());
	const podeGerenciar = $derived(['lider', 'sub-lider', 'leader', 'officer'].includes(cNorm));
	const podeEditar = $derived(['lider', 'sub-lider', 'comandante', 'leader', 'officer', 'veteran'].includes(cNorm));
	const eLider = $derived(cNorm === 'lider' || cNorm === 'leader');
	const falta = $derived(prog ? prog.xp_to_next : null);
	const lotada = $derived(guilda.member_count >= guilda.member_limit);

	// Marcos de nível sincronizados com curve.js
	const MARCOS = {
		3: ['description_280'],
		5: ['palette_6'],
		8: ['motto'],
		10: ['frame_bronze', 'color_special', 'banner_custom'],
		12: ['xp_history'],
		15: ['frame_silver'],
		18: ['member_badge'],
		20: ['palette_12', 'banner_animated'],
		25: ['frame_gold'],
		30: ['banner_frame', 'guild_emote'],
		35: ['frame_platinum'],
		40: ['color_gradient', 'banner_glow'],
		45: ['frame_diamond'],
		50: ['frame_legendary', 'color_lv50', 'banner_signed']
	};

	const proximoDesbloqueio = $derived.by(() => {
		if (!prog) return null;
		const niveis = Object.keys(MARCOS)
			.map(Number)
			.sort((a, b) => a - b);
		const nivelAlvo = niveis.find((n) => n > prog!.level);
		if (!nivelAlvo) return null;

		const chaves = (MARCOS as any)[nivelAlvo] || [];
		const nomes = chaves.map((k: string) => UNLOCK_LABELS[k]).filter(Boolean);
		return { level: nivelAlvo, label: nomes.join(', ') };
	});

	async function deixar() {
		aviso = '';
		try {
			await sair(guilda.id);
			aoSair();
		} catch (e) {
			aviso = e instanceof ErroApi ? e.message : 'Não foi possível sair.';
		}
	}
</script>

{#if editando}
	<div class="editor-overlay" in:entrarBloco>
		<header class="editor-header">
			<button class="voltar" onclick={() => (editando = false)} aria-label="Voltar">←</button>
			<h2>Identidade</h2>
		</header>
		<EditorBrasao {guilda} aoSalvar={() => { editando = false; aoAtualizar(); }} />
	</div>
{:else if vendoMembros}
	<div class="editor-overlay" in:entrarBloco>
		<header class="editor-header">
			<button class="voltar" onclick={() => (vendoMembros = false)} aria-label="Voltar">←</button>
			<h2>Membros</h2>
		</header>
		<GestaoMembros {guilda} cargoAtor={cargo} aoSair={aoSair} aoAtualizar={aoAtualizar} />
	</div>
{:else if vendoConquistas}
	<Conquistas guildaId={guilda.id} aoVoltar={() => (vendoConquistas = false)} />
{:else}
	<div class="conteudo" in:entrarBloco>
		<header>
			<Banner
				url={guilda.banner_url}
				nivel={guilda.level}
				unlocks={prog?.unlocks || []}
				corPri={guilda.color_primary}
				corSec={guilda.color_secondary}
			/>
			<div class="header-brasao-pos">
				<Brasao
					tag={guilda.tag}
					tamanho={82}
					layers={guilda.emblem_preset ? JSON.parse(guilda.emblem_preset) : undefined}
					customUrl={guilda.custom_emblem_url}
					{progressionFrame}
				/>
			</div>
			<h1>{guilda.name}</h1>
		<p class="linhagem">
			<span class="num">Nível {guilda.level}</span>
			{#if posicao}
				<span class="sep" aria-hidden="true">·</span>
				<span class="num">{posicao}º no ranking</span>
			{:else if erroPosicao}
				<span class="sep" aria-hidden="true">·</span>
				<button class="link-retry" onclick={carregarPosicao} title={erroPosicao}>Posição indisponível — tentar de novo</button>
			{/if}
		</p>
	</header>

	{#if guilda.motto}
		<p class="lema">“{guilda.motto}”</p>
	{/if}

	{#if medalhas.length > 0}
		<button class="conquistas-resumo" onclick={() => (vendoConquistas = true)}>
			{#each medalhas as m}
				<span class="medalha-mini" title={m.name}>🏅</span>
			{/each}
			{#if medalhas.length >= 4}<span>+</span>{/if}
		</button>
	{:else if erroMedalhas}
		<div class="bloco-erro">
			<Estado estado="erro" mensagem={erroMedalhas} acao="Tentar de novo" aoAgir={carregarMedalhas} />
		</div>
	{/if}

	{#if prog}
		<div class="xp">
			<div class="trilho">
				<div class="preenche" bind:this={barra}></div>
			</div>
			<p class="legenda">
				{#if falta !== null && falta > 0}
					<span class="num">{falta.toLocaleString('pt-BR')}</span> XP para o nível
					<span class="num">{guilda.level + 1}</span>
				{:else}
					Nível máximo
				{/if}
			</p>
		</div>
	{:else if erroProg}
		<div class="bloco-erro">
			<Estado estado="erro" mensagem={erroProg} acao="Tentar de novo" aoAgir={carregarProgressao} />
		</div>
	{/if}

	{#if semanal}
		<section class="progresso-semanal" aria-label="Progresso semanal">
			<div class="semana-topo">
				<strong>Meta da semana</strong>
				<span class:concluida={semanal.completed}>{semanal.completed ? 'Concluída' : `+${semanal.points} Poder`}</span>
			</div>
			<p>{semanal.description}</p>
			<div class="metas">
				<span class:atingida={semanal.members >= semanal.target_members}>{semanal.members}/{semanal.target_members} membros</span>
				<span class:atingida={semanal.days >= semanal.target_days}>{semanal.days}/{semanal.target_days} dias</span>
			</div>
		</section>
	{:else if erroSemanal}
		<div class="bloco-erro">
			<Estado estado="erro" mensagem={erroSemanal} acao="Tentar de novo" aoAgir={carregarSemanal} />
		</div>
	{/if}

	{#if resumo && (resumo.xp_gained || resumo.prestige_gained || resumo.wars_won || resumo.new_members || resumo.territories_conquered)}
		<section class="resumo-semanal" aria-label="Resumo da semana">
			<strong>Resumo da semana</strong>
			<div class="resumo-grade">
				<span>⚡ {resumo.xp_gained.toLocaleString('pt-BR')} XP</span>
				<span>👑 {resumo.prestige_gained.toLocaleString('pt-BR')} Prestígio</span>
				<span>⚔️ {resumo.wars_won} {resumo.wars_won === 1 ? 'vitória' : 'vitórias'}</span>
				<span>🛡️ {resumo.new_members} {resumo.new_members === 1 ? 'novo membro' : 'novos membros'}</span>
				<span>🏰 {resumo.territories_conquered} {resumo.territories_conquered === 1 ? 'território' : 'territórios'}</span>
			</div>
		</section>
	{:else if erroResumo}
		<div class="bloco-erro">
			<Estado estado="erro" mensagem={erroResumo} acao="Tentar de novo" aoAgir={carregarResumo} />
		</div>
	{/if}

	{#if missoesDia.length > 0 || missoesSemana.length > 0 || erroMissoesDia || erroMissoesSemana}
		<div class="missoes-wrapper">
			<button class="missoes-toggle" onclick={() => (missoesAbertas = !missoesAbertas)}>
				<span>🎯 Missões</span>
				<span class="chevron" class:aberto={missoesAbertas}>▸</span>
			</button>

			{#if missoesAbertas}
				{#if missoesDia.length > 0}
					<section class="missoes" aria-label="Missões diárias">
						<strong>Missões de hoje</strong>
						{#each missoesDia as m}
							<div class="missao-linha" class:completa={m.completed}>
								<span>{m.completed ? '✅' : '⬜'} {m.label}</span>
								<span class="num">{m.progress}/{m.target}</span>
							</div>
						{/each}
					</section>
				{:else if erroMissoesDia}
					<div class="bloco-erro">
						<Estado estado="erro" mensagem={erroMissoesDia} acao="Tentar de novo" aoAgir={carregarMissoesDia} />
					</div>
				{/if}

				{#if missoesSemana.length > 0}
					<section class="missoes" aria-label="Missões da semana">
						<strong>Missões da semana</strong>
						{#each missoesSemana as m}
							{#if 'progress_members' in m}
								<div class="missao-linha" class:completa={m.completed}>
									<span>{m.completed ? '✅' : '⬜'} {m.label}</span>
									<span class="num">{m.progress_members}/{m.target} membros · {m.progress_days}/{m.target} dias</span>
								</div>
							{:else}
								<div class="missao-linha" class:completa={m.completed}>
									<span>{m.completed ? '✅' : '⬜'} {m.label}</span>
									<span class="num">{m.progress}/{m.target}</span>
								</div>
							{/if}
						{/each}
					</section>
				{:else if erroMissoesSemana}
					<div class="bloco-erro">
						<Estado estado="erro" mensagem={erroMissoesSemana} acao="Tentar de novo" aoAgir={carregarMissoesSemana} />
					</div>
				{/if}
			{/if}
		</div>
	{/if}

	{#if proximoDesbloqueio}
		<p class="proximo-desbloqueio">
			Próximo desbloqueio: <b>Nível {proximoDesbloqueio.level} — {proximoDesbloqueio.label}</b>
		</p>
	{/if}

	{#if prog && prog.unlocks.length > 0}
		<div class="beneficios-resumo">
			<strong>Benefícios Desbloqueados</strong>
			<div class="lista-tags">
				{#each prog.unlocks as key}
					{#if UNLOCK_LABELS[key]}
						<span class="tag-beneficio">✓ {UNLOCK_LABELS[key]}</span>
					{/if}
				{/each}
			</div>
		</div>
	{/if}

	<dl class="quadro">
		<div>
			<dt>Prestígio</dt>
			<dd class="num ouro">{guilda.prestige.toLocaleString('pt-BR')}</dd>
		</div>
		<div>
			<dt>Membros</dt>
			<dd class="num" class:aviso={lotada}>{guilda.member_count}/{guilda.member_limit}</dd>
		</div>
		{#if terrs.length > 0}
			<div class="rendimento">
				<dt>Rendimento Territorial</dt>
				<dd class="num verde">+{rendimentoTotal} Prestígio / dia</dd>
				<small>{terrs.length} territórios sob domínio</small>
			</div>
		{:else if erroTerrs}
			<div class="rendimento">
				<dt>Rendimento Territorial</dt>
				<dd class="num aviso">—</dd>
				<small class="erro-inline">
					{erroTerrs}
					<button class="link-retry" onclick={carregarTerritoriosDaGuilda}>Tentar de novo</button>
				</small>
			</div>
		{/if}
	</dl>

	{#if guilda.status === 'pending'}
		<p class="nota">Aguardando aprovação do streamer.</p>
	{:else if guilda.status === 'overflow'}
		<p class="nota">
			Acima do limite de vagas. Ninguém foi removido, mas novas entradas estão fechadas até
			subir de nível.
		</p>
	{:else if guilda.status === 'suspended' && guilda.reject_reason}
		<p class="nota gules">{guilda.reject_reason}</p>
		{#if eLider}
			<p class="nota">Ajuste o que causou a rejeição e reenvie para uma nova análise.</p>
			{#if erroReenvio}<p class="nota gules">{erroReenvio}</p>{/if}
			<button class="reenviar-btn" disabled={reenviando} onclick={acaoReenviar}>
				{reenviando ? 'Reenviando...' : 'Reenviar para Aprovação'}
			</button>
		{/if}
	{/if}
</div>

<div class="historico-wrapper">
	<button class="missoes-toggle" onclick={alternarFeed}>
		<span>📰 Feed de Atividades</span>
		<span class="chevron" class:aberto={feedAberto}>▸</span>
	</button>

	{#if feedAberto}
		{#if feed.length > 0}
			<section class="feed-atividades" aria-label="Feed de atividades da guilda">
				{#each feed as f (f.id)}
					<div class="feed-linha">
						<span class="feed-msg">{f.message}</span>
						<span class="feed-tempo">{tempoRelativo(f.created_at)}</span>
					</div>
				{/each}
			</section>
		{:else if erroFeed}
			<div class="bloco-erro">
				<Estado estado="erro" mensagem={erroFeed} acao="Tentar de novo" aoAgir={carregarFeed} />
			</div>
		{:else if feedCarregado}
			<p class="nota">Nenhuma atividade recente.</p>
		{/if}
	{/if}
</div>

{#if podeEditar}
	<div class="historico-wrapper">
		<button class="missoes-toggle" onclick={alternarLoja}>
			<span>🛒 Loja: histórico e estatísticas</span>
			<span class="chevron" class:aberto={lojaAberta}>▸</span>
		</button>

		{#if lojaAberta}
			{#if erroLoja}
				<div class="bloco-erro">
					<Estado estado="erro" mensagem={erroLoja} acao="Tentar de novo" aoAgir={carregarLoja} />
				</div>
			{:else if lojaCarregada}
				{#if stats}
					<dl class="loja-stats">
						<div><dt>Compras concluídas</dt><dd>{stats.purchases}</dd></div>
						<div><dt>Bits gastos</dt><dd>{stats.bits_spent.toLocaleString('pt-BR')}</dd></div>
						<div><dt>Crédito usado</dt><dd>{stats.credit_used.toLocaleString('pt-BR')}</dd></div>
					</dl>
					{#if stats.top_skus.length > 0}
						<div class="loja-top-skus">
							{#each stats.top_skus as ts (ts.sku)}
								<span class="loja-sku-tag">{ts.sku} <small>×{ts.purchases}</small></span>
							{/each}
						</div>
					{/if}
				{/if}

				{#if compras.length > 0}
					<section class="loja-historico" aria-label="Histórico de compras">
						{#each compras as c (c.id)}
							<div class="loja-linha">
								<span class="loja-sku">{c.sku}</span>
								<span class="loja-valor">
									{#if c.bits_amount > 0}{c.bits_amount.toLocaleString('pt-BR')} bits{/if}
									{#if c.bits_amount > 0 && c.credit_amount > 0} + {/if}
									{#if c.credit_amount > 0}{c.credit_amount.toLocaleString('pt-BR')} crédito{/if}
								</span>
								<span class="loja-estado" class:ok={c.state === 'settled'} class:ruim={c.state === 'failed' || c.state === 'voided'}>
									{ESTADO_COMPRA_LABEL[c.state]}
								</span>
							</div>
						{/each}
					</section>
				{:else}
					<p class="nota">Nenhuma compra ainda.</p>
				{/if}
			{/if}
		{/if}
	</div>
{/if}

{#if podeEditar}
	<div class="historico-wrapper">
		<button class="missoes-toggle" onclick={alternarHistorico}>
			<span>📜 Histórico de Identidade</span>
			<span class="chevron" class:aberto={historicoAberto}>▸</span>
		</button>

		{#if historicoAberto}
			{#if historico.length > 0}
				<section class="historico-identidade" aria-label="Histórico de alterações de nome e TAG">
					{#each historico as h (h.id)}
						<div class="historico-linha">
							<span class="historico-campo">{CAMPO_HISTORICO_LABEL[h.field]}</span>
							<span class="historico-valores">{h.old_value} → {h.new_value}</span>
							<span class="historico-estado" class:aprovado={h.state === 'approved'} class:rejeitado={h.state === 'rejected' || h.state === 'reverted'}>
								{ESTADO_HISTORICO_LABEL[h.state]}
							</span>
						</div>
					{/each}
				</section>
			{:else if erroHistorico}
				<div class="bloco-erro">
					<Estado estado="erro" mensagem={erroHistorico} acao="Tentar de novo" aoAgir={carregarHistorico} />
				</div>
			{:else if historicoCarregado}
				<p class="nota">Nenhuma alteração de nome ou TAG ainda.</p>
			{/if}
		{/if}
	</div>
{/if}

{#if aviso}
	<p class="nota gules" role="alert">{aviso}</p>
{/if}

<div class="acoes">
	{#if podeGerenciar}
		<button class="primario" onclick={() => (vendoMembros = true)}>Gestão de Membros</button>
	{/if}

	{#if podeEditar}
		<button class="secundario" onclick={() => (editando = true)}>Editar Identidade</button>
	{/if}

	{#if eLider}
		<!-- Líder não sai sem transferir (fase 02, R17): o servidor recusa, e a
		     interface não oferece a ação para não prometer o que não entrega. -->
		<p class="nota">Como líder, transfira a liderança antes de sair.</p>
	{:else}
		<button onclick={deixar}>Sair da guilda</button>
	{/if}
</div>
{/if}

<style>
	.conteudo {
		margin-block: auto;
	}

	header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 0 0 12px;
		border-bottom: 1px solid var(--borda);
		position: relative;
	}

	.header-brasao-pos {
		margin-top: -50px;
		z-index: 10;
		filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));
	}

	h1 {
		font-size: 21px;
		line-height: 1.12;
		text-align: center;
		text-wrap: balance;
	}

	.linhagem {
		margin: -4px 0 0;
		color: var(--or);
		font-family: var(--display);
		font-size: 13px;
		letter-spacing: 0.04em;
	}

	.sep {
		margin: 0 4px;
		opacity: 0.6;
	}

	.lema {
		margin: 12px 0 0;
		text-align: center;
		font-family: var(--display);
		font-size: 14px;
		text-wrap: balance;
	}

	.conquistas-resumo {
		display: flex;
		justify-content: center;
		gap: 6px;
		margin-top: 10px;
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px;
	}

	.medalha-mini {
		font-size: 16px;
		filter: drop-shadow(0 2px 4px rgba(0,0,0,0.5));
	}

	.xp {
		margin: 14px 0 0;
	}

	.trilho {
		height: 6px;
		background: var(--sable);
		border: 1px solid var(--borda);
		border-radius: 1px;
		overflow: hidden;
	}

	.preenche {
		height: 100%;
		background: linear-gradient(90deg, var(--vert), var(--or));
		transform-origin: left center;
		/* Escala em vez de largura: só transform anima (docs/MOVIMENTO.md). */
		transform: scaleX(0);
	}

	.legenda {
		margin: 5px 0 0;
		font-size: 11px;
		color: var(--argent-fraco);
	}

	.quadro {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		margin: 14px 0 0;
	}

	dt {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--argent-fraco);
	}

	dd {
		margin: 2px 0 0;
		font-size: 19px;
	}

	.ouro {
		color: var(--or);
	}

	dd.aviso {
		color: var(--gules);
	}

	.verde {
		color: var(--vert);
	}

	.rendimento {
		grid-column: 1 / -1;
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--borda);
	}

	.rendimento small {
		font-size: 10px;
		color: var(--argent-fraco);
	}

	.progresso-semanal {
		margin-top: 14px;
		padding: 10px;
		border: 1px solid var(--borda);
		background: var(--sable-2);
	}

	.semana-topo, .metas {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}

	.semana-topo strong { color: var(--or); font-size: 12px; }
	.semana-topo span, .metas span { color: var(--argent-fraco); font-size: 10px; }
	.semana-topo span.concluida, .metas span.atingida { color: var(--vert); }
	.progresso-semanal p { margin: 7px 0; color: var(--argent-fraco); font-size: 11px; }

	.resumo-semanal {
		margin-top: 10px;
		padding: 10px;
		border: 1px solid var(--borda);
		background: var(--sable-2);
	}

	.resumo-semanal strong { color: var(--or); font-size: 12px; display: block; margin-bottom: 6px; }

	.resumo-grade {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px 12px;
	}

	.resumo-grade span { color: var(--argent); font-size: 11px; }

	.missoes {
		margin-top: 10px;
		padding: 10px;
		border: 1px solid var(--borda);
		background: var(--sable-2);
	}

	.missoes strong { color: var(--or); font-size: 12px; display: block; margin-bottom: 6px; }

	.missao-linha {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		padding: 4px 0;
		font-size: 11px;
		color: var(--argent-fraco);
	}

	.missao-linha.completa { color: var(--vert); }
	.missao-linha .num { color: var(--argent-fraco); font-size: 10px; }
	.missao-linha.completa .num { color: var(--vert); }

	.missoes-wrapper { margin-top: 10px; }

	.missoes-toggle {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		color: var(--or);
		font-size: 12px;
		padding: 8px 10px;
		cursor: pointer;
	}

	.missoes-toggle .chevron {
		transition: transform 0.15s ease;
		font-size: 10px;
	}

	.missoes-toggle .chevron.aberto { transform: rotate(90deg); }

	.missoes-wrapper .missoes {
		margin-top: 6px;
		border-top: none;
	}

	.historico-wrapper { margin-top: 10px; }

	.historico-identidade {
		margin-top: 6px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 4px;
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.historico-linha {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		flex-wrap: wrap;
	}

	.historico-campo { color: var(--or); font-weight: bold; text-transform: uppercase; font-size: 9px; }
	.historico-valores { color: var(--argent); flex: 1; }
	.historico-estado { font-size: 9px; text-transform: uppercase; color: var(--argent-fraco); }
	.historico-estado.aprovado { color: var(--vert); }
	.historico-estado.rejeitado { color: var(--gules); }

	.feed-atividades {
		margin-top: 6px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 4px;
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 240px;
		overflow-y: auto;
	}

	.feed-linha {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
	}

	.feed-msg { color: var(--argent); }
	.feed-tempo { color: var(--argent-fraco); font-size: 9px; white-space: nowrap; }

	.loja-stats {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
		margin-top: 6px;
	}
	.loja-stats div { background: var(--sable-2); border: 1px solid var(--borda); border-radius: 4px; padding: 6px; text-align: center; }
	.loja-stats dt { font-size: 8px; text-transform: uppercase; color: var(--argent-fraco); margin: 0; }
	.loja-stats dd { font-size: 13px; color: var(--or); margin: 2px 0 0; font-weight: bold; }

	.loja-top-skus { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
	.loja-sku-tag { font-size: 10px; color: var(--argent); background: var(--sable-2); border: 1px solid var(--borda); border-radius: 10px; padding: 2px 8px; }
	.loja-sku-tag small { color: var(--argent-fraco); }

	.loja-historico {
		margin-top: 8px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 4px;
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-height: 200px;
		overflow-y: auto;
	}
	.loja-linha { display: flex; align-items: center; gap: 8px; font-size: 11px; }
	.loja-sku { color: var(--argent); flex: 1; }
	.loja-valor { color: var(--or); white-space: nowrap; }
	.loja-estado { font-size: 9px; text-transform: uppercase; color: var(--argent-fraco); white-space: nowrap; }
	.loja-estado.ok { color: var(--vert); }
	.loja-estado.ruim { color: var(--gules); }

	.proximo-desbloqueio { margin: 10px 0 0; color: var(--argent-fraco); font-size: 11px; }
	.proximo-desbloqueio b { color: var(--or); }

	.beneficios-resumo {
		margin-top: 14px;
		padding: 10px;
		border: 1px solid var(--borda);
		background: var(--sable-2);
	}

	.beneficios-resumo strong {
		color: var(--or);
		font-size: 12px;
		display: block;
		margin-bottom: 8px;
	}

	.lista-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.tag-beneficio {
		font-size: 9px;
		text-transform: uppercase;
		color: var(--vert);
		background: rgba(63, 125, 92, 0.1);
		padding: 2px 6px;
		border-radius: 2px;
		border: 1px solid rgba(63, 125, 92, 0.3);
	}

	.nota {
		margin: 12px 0 0;
		padding-left: 10px;
		border-left: 2px solid var(--or);
		color: var(--argent-fraco);
		font-size: 12px;
		text-wrap: pretty;
	}

	.nota.gules {
		border-left-color: var(--gules);
		color: var(--argent);
	}

	.reenviar-btn {
		margin-top: 10px;
		width: 100%;
		padding: 10px;
		background: var(--or);
		color: var(--sable);
		border: none;
		font-weight: bold;
		border-radius: 2px;
		cursor: pointer;
	}
	.reenviar-btn:disabled { opacity: 0.6; cursor: default; }

	.bloco-erro {
		margin: 4px 0;
		min-height: 0;
	}

	.bloco-erro :global(.estado) {
		padding: 6px 0;
		align-items: flex-start;
		text-align: left;
	}

	.erro-inline {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--argent-fraco);
	}

	.link-retry {
		background: none;
		border: none;
		padding: 0;
		color: var(--or);
		font-size: 11px;
		text-decoration: underline;
		cursor: pointer;
		text-align: left;
	}

	.acoes {
		margin-top: auto;
		padding-top: 10px;
		display: grid;
	}

	.acoes button.secundario {
		background: none;
		border: 1px solid var(--borda);
		color: var(--argent);
		margin-bottom: 8px;
	}

	.acoes button.primario {
		background: var(--or);
		color: var(--sable);
		font-weight: bold;
		border: none;
		margin-bottom: 8px;
	}

	.editor-overlay {
		position: absolute;
		inset: 0;
		z-index: 1000;
		background: var(--sable);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.editor-header {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 12px;
		border-bottom: 1px solid var(--borda);
		background: var(--sable-2);
		position: relative;
		min-height: 54px;
	}

	.editor-header h2 {
		margin: 0;
		font-size: 16px;
		text-transform: uppercase;
		letter-spacing: 0.2em;
		color: var(--argent);
		font-weight: 800;
		text-align: center;
	}

	.voltar {
		position: absolute;
		left: 12px;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: var(--or);
		font-size: 32px;
		cursor: pointer;
		padding: 4px;
		line-height: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: transform 0.2s;
	}

	.voltar:hover { transform: translateY(-50%) scale(1.1); }
</style>