<script lang="ts">
	import Brasao from '$lib/ui/Brasao.svelte';
	import EditorBrasao from './EditorBrasao.svelte';
	import Conquistas from './Conquistas.svelte';
	import {
		progressao,
		posicaoDa,
		sair,
		listarTerritorios,
		carregarConquistas,
		ErroApi
	} from '$lib/api';
	import type { Guilda, Cargo, Progressao, Territory, Achievement } from '$lib/api';
	import { gsap, dur, entrarBloco } from '$lib/motion';

	let {
		guilda,
		cargo,
		aoSair,
		aoAtualizar
	}: { guilda: Guilda; cargo: Cargo; aoSair: () => void; aoAtualizar: () => void } = $props();

	let prog = $state<Progressao | null>(null);
	let posicao = $state<number | null>(null);
	let terrs = $state<Territory[]>([]);
	let medalhas = $state<Achievement[]>([]);
	let aviso = $state('');
	let barra = $state<HTMLDivElement>();
	let editando = $state(false);
	let vendoConquistas = $state(false);

	$effect(() => {
		// Falha aqui não derruba a tela: o essencial já está na prop `guilda`.
		progressao(guilda.id)
			.then((p) => (prog = p))
			.catch(() => {});
		posicaoDa(guilda.id)
			.then((r) => (posicao = r.position))
			.catch(() => {});
		listarTerritorios()
			.then((res) => (terrs = res.items.filter((t) => t.owner_guild_id === guilda.id)))
			.catch(() => {});
		carregarConquistas(guilda.id)
			.then((res) => (medalhas = res.unlocked.slice(0, 4)))
			.catch(() => {});
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

	const fracao = $derived(
		prog && prog.xp_do_nivel > 0 ? Math.min(1, prog.xp_no_nivel / prog.xp_do_nivel) : 0
	);
	const falta = $derived(prog ? Math.max(0, prog.xp_do_nivel - prog.xp_no_nivel) : null);
	const lotada = $derived(guilda.member_count >= guilda.member_limit);

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
{:else if vendoConquistas}
	<Conquistas guildaId={guilda.id} aoVoltar={() => (vendoConquistas = false)} />
{:else}
	<div class="conteudo" in:entrarBloco>
		<header>
			<Brasao
				tag={guilda.tag}
				tamanho={78}
				layers={guilda.emblem_preset ? JSON.parse(guilda.emblem_preset) : undefined}
				customUrl={guilda.custom_emblem_url}
			/>
			<h1>{guilda.name}</h1>
		<p class="linhagem">
			<span class="num">Nível {guilda.level}</span>
			{#if posicao}
				<span class="sep" aria-hidden="true">·</span>
				<span class="num">{posicao}º no ranking</span>
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
	{/if}
</div>

{#if aviso}
	<p class="nota gules" role="alert">{aviso}</p>
{/if}

<div class="acoes">
	{#if cargo === 'leader' || cargo === 'officer'}
		<button class="secundario" onclick={() => (editando = true)}>Editar Identidade</button>
	{/if}

	{#if cargo === 'leader'}
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
		padding: 2px 0 12px;
		border-bottom: 1px solid var(--borda);
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

	.editor-overlay {
		position: absolute;
		inset: 0;
		z-index: 100;
		background: var(--sable);
		display: flex;
		flex-direction: column;
	}

	.editor-header {
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 12px;
		border-bottom: 1px solid var(--borda);
		background: var(--sable-2);
		position: relative;
		min-height: 48px;
	}

	.editor-header h2 {
		margin: 0;
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: var(--argent);
		font-weight: 700;
	}

	.voltar {
		position: absolute;
		left: 8px;
		top: 50%;
		transform: translateY(-50%);
		background: none;
		border: none;
		color: var(--or);
		font-size: 24px;
		cursor: pointer;
		padding: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		transition: opacity 0.2s;
	}

	.voltar:hover { opacity: 0.7; }
</style>
