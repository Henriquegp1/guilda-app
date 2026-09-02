<script lang="ts">
	import { onMount } from 'svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import { iniciar, onAuth } from '$lib/twitch';
	import {
		configAnuncio,
		salvarConfigAnuncio,
		temporadaAtual,
		ErroApi,
		type Temporada
	} from '$lib/api';
	import GerenciarTerritorios from '$lib/telas/GerenciarTerritorios.svelte';
	import ConfigSeguranca from '$lib/telas/ConfigSeguranca.svelte';
	import ConfigTemplates from '$lib/telas/ConfigTemplates.svelte';
	import ConfigHistorico from '$lib/telas/ConfigHistorico.svelte';

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let erro = $state('');
	let salvo = $state('');
	let ocupado = $state(false);

	let anuncio = $state<any>({});
	let temporada = $state<Temporada | null>(null);

	async function carregar() {
		try {
			const [a, t] = await Promise.all([
				configAnuncio(),
				temporadaAtual().catch(() => null)
			]);
			anuncio = a;
			temporada = t;
			estado = 'pronto';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Não foi possível carregar a configuração.';
			estado = 'erro';
		}
	}

	async function salvarGeral() {
		salvo = '';
		erro = '';
		ocupado = true;
		try {
			await salvarConfigAnuncio({
				enabled: anuncio.enabled,
				webhook_url: anuncio.webhook_url,
				hourly_cap: anuncio.hourly_cap,
				quiet_from: anuncio.quiet_from,
				quiet_to: anuncio.quiet_to,
				timezone: anuncio.timezone
			});
			salvo = 'Configuração salva.';
			setTimeout(() => (salvo = ''), 3000);
			// Recarrega para ver se o circuit breaker limpou
			if (anuncio.fail_streak >= 10) carregar();
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Não foi possível salvar.';
		} finally {
			ocupado = false;
		}
	}

	import { base } from '$app/paths';
	import { mutarAnuncios, desmutarAnuncios } from '$lib/api';
	let minutosMute = $state(30);

	async function mutar(m: number) {
		try {
			await mutarAnuncios(m, 'Manual via Painel');
			await carregar();
		} catch (e) {
			alert('Erro ao mutar.');
		}
	}

	async function desmutar() {
		try {
			await desmutarAnuncios();
			await carregar();
		} catch (e) {
			alert('Erro ao desmutar.');
		}
	}

	onMount(() => {
		iniciar();
		return onAuth(carregar);
	});
</script>

<main>
	<header class="main-header">
		<div>
			<h1>Twitch Guilds</h1>
			<p class="sub">Painel do Streamer: Controle de Anúncios e Territórios.</p>
		</div>
		<a href="{base}/moderacao" class="btn-mod">🛡️ Moderação</a>
	</header>

	{#if estado === 'carregando'}
		<Estado estado="carregando" />
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
	{:else}
		<!-- ALERTA DE CIRCUIT BREAKER -->
		{#if anuncio.fail_streak > 0}
			<div class="alerta-streak" class:critico={anuncio.fail_streak >= 10}>
				<div class="streak-info">
					<span class="icone">{anuncio.fail_streak >= 10 ? '🛑' : '⚠️'}</span>
					<div>
						<b>{anuncio.fail_streak >= 10 ? 'Anúncios Desativados Automaticamente' : 'Instabilidade Detectada'}</b>
						<p>
							O bot falhou {anuncio.fail_streak} vezes consecutivas.
							{#if anuncio.fail_streak >= 10}
								O sistema foi desligado para evitar spam de erros. Verifique seu bot e salve a configuração novamente para religar.
							{:else}
								Verifique se a URL do Webhook está correta. No 10º erro o sistema será desligado.
							{/if}
						</p>
					</div>
				</div>
			</div>
		{/if}

		<!-- SEÇÃO 1: CONEXÃO -->
		<section>
			<h2>Conexão com o Chat</h2>
			<div class="grade">
				<label class="linha switch">
					<input type="checkbox" bind:checked={anuncio.enabled} />
					Habilitar anúncios automáticos
				</label>

				<label>
					URL do Webhook (HTTPS)
					<input
						type="url"
						placeholder="https://seu-bot.com/guildas"
						bind:value={anuncio.webhook_url}
					/>
					<small>Onde seu bot recebe os dados dos eventos.</small>
				</label>

				<label>
					Teto de mensagens por hora
					<input type="number" min="4" max="20" bind:value={anuncio.hourly_cap} />
					<small>Limite anti-spam recomendado: 12.</small>
				</label>
			</div>

			<div class="acoes-geral">
				<button class="btn-principal" disabled={ocupado} onclick={salvarGeral}>
					{ocupado ? 'Salvando...' : 'Salvar Configuração'}
				</button>
				{#if salvo}<span class="msg-ok">{salvo}</span>{/if}
				{#if erro}<span class="msg-erro">{erro}</span>{/if}
			</div>
		</section>

		<!-- SEÇÃO 2: HORÁRIO DE SILÊNCIO / MUTE -->
		<section>
			<h2>Silêncio e Mute</h2>
			<div class="bloco-mute">
				<div class="mute-status">
					{#if anuncio.muted_until && new Date(anuncio.muted_until) > new Date()}
						<span class="bad-mute">🔇 MUTADO ATÉ {new Date(anuncio.muted_until).toLocaleTimeString('pt-BR')}</span>
						<button class="btn-micro" onclick={desmutar}>Desativar Mute</button>
					{:else}
						<span class="ok-mute">🔊 Anúncios em tempo real habilitados</span>
					{/if}
				</div>

				<div class="controles-mute">
					<label for="mute-select">Mute Rápido (Raid/Spam)</label>
					<div class="linha-btn">
						<select id="mute-select" bind:value={minutosMute}>
							<option value={10}>10 minutos</option>
							<option value={30}>30 minutos</option>
							<option value={60}>1 hora</option>
							<option value={240}>4 horas</option>
						</select>
						<button class="btn-secundario" onclick={() => mutar(minutosMute)}>Silenciar Agora</button>
					</div>
				</div>
			</div>

			<hr class="divisor" />

			<p class="ajuda">
				<b>Agendamento:</b> Defina um período em que os anúncios serão suprimidos automaticamente (ex: madrugada).
			</p>
			<div class="grade tempo">
				<label>
					Início
					<input type="time" bind:value={anuncio.quiet_from} />
				</label>
				<label>
					Fim
					<input type="time" bind:value={anuncio.quiet_to} />
				</label>
				<label>
					Fuso Horário
					<select bind:value={anuncio.timezone}>
						<option value="America/Sao_Paulo">Brasília (GMT-3)</option>
						<option value="America/Manaus">Manaus (GMT-4)</option>
						<option value="UTC">UTC / GMT</option>
					</select>
				</label>
			</div>
			<button class="btn-secundario" disabled={ocupado} onclick={salvarGeral}>Salvar Agendamento</button>
		</section>

		<!-- SEÇÃO 3: SEGURANÇA -->
		<ConfigSeguranca />

		<!-- SEÇÃO 4: EVENTOS E TEMPLATES -->
		<ConfigTemplates events={anuncio.events} />

		<!-- SEÇÃO 5: HISTÓRICO -->
		<ConfigHistorico />

		<!-- SEÇÃO 6: TERRITÓRIOS (Vindo da fase anterior) -->
		<section class="territorios">
			<h2>Gestão de Territórios</h2>
			<p class="ajuda">Crie os locais que as guildas disputarão no Mapa Mundi.</p>
			<GerenciarTerritorios />
		</section>

		<!-- INFO TEMPORADA -->
		<section class="temporada">
			<h2>Temporada Atual</h2>
			{#if temporada}
				<div class="tag-temporada">
					<b>{temporada.name}</b> • Finaliza em {new Date(temporada.ends_at).toLocaleDateString('pt-BR')}
				</div>
			{:else}
				<p class="vazio">Nenhuma temporada ativa no momento.</p>
			{/if}
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 800px;
		margin: 0 auto;
		padding: 24px 16px 80px;
		background: var(--sable);
		min-height: 100vh;
	}

	.main-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 32px;
	}

	h1 { font-size: 28px; color: var(--or); margin: 0; }
	.sub { margin: 4px 0 0; color: var(--argent-fraco); font-size: 14px; }

	.btn-mod {
		background: none;
		border: 1px solid var(--or);
		color: var(--or);
		text-decoration: none;
		padding: 8px 16px;
		font-size: 13px;
		font-weight: bold;
		border-radius: 4px;
	}
	.btn-mod:hover { background: var(--or); color: var(--sable); }

	section {
		background: var(--sable-2);
		border: 1px solid var(--borda);
		padding: 24px;
		border-radius: 4px;
		margin-bottom: 16px;
	}

	h2 { font-size: 18px; margin-bottom: 16px; color: var(--argent); border-left: 3px solid var(--or); padding-left: 12px; }
	.ajuda { font-size: 13px; color: var(--argent-fraco); margin-bottom: 20px; line-height: 1.5; }

	.grade { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
	.grade.tempo { grid-template-columns: 1fr 1fr 2fr; }

	label { display: flex; flex-direction: column; gap: 6px; font-size: 11px; text-transform: uppercase; color: var(--argent-fraco); letter-spacing: 0.05em; }

	input[type='url'], input[type='number'], input[type='time'], select {
		background: var(--sable);
		border: 1px solid var(--borda);
		color: #fff;
		padding: 10px;
		font-size: 14px;
		border-radius: 2px;
	}
	input:focus, select:focus { border-color: var(--or); outline: none; }

	.switch { flex-direction: row; align-items: center; gap: 10px; font-size: 13px; color: #fff; text-transform: none; grid-column: span 2; margin-bottom: 10px; }
	.switch input { width: 18px; height: 18px; cursor: pointer; }

	.acoes-geral { display: flex; align-items: center; gap: 16px; margin-top: 24px; }

	.btn-principal { background: var(--or); color: var(--sable); font-weight: bold; border: none; padding: 12px 24px; }
	.btn-secundario { background: none; border: 1px solid var(--borda); color: var(--argent); font-size: 12px; padding: 8px 16px; margin-top: 12px; }
	.btn-secundario:hover { border-color: var(--or); color: var(--or); }

	.msg-ok { color: var(--vert); font-size: 13px; }
	.msg-erro { color: var(--gules); font-size: 13px; }

	.tag-temporada { background: var(--sable-3); padding: 12px; border-radius: 4px; color: var(--or); font-size: 14px; text-align: center; }
	.vazio { color: var(--argent-fraco); font-style: italic; text-align: center; }

	small { font-size: 11px; text-transform: none; letter-spacing: 0; opacity: 0.8; margin-top: 2px; }

	.alerta-streak { background: rgba(200, 160, 46, 0.1); border: 1px solid var(--or); padding: 16px; border-radius: 4px; margin-bottom: 24px; }
	.alerta-streak.critico { background: rgba(166, 50, 50, 0.1); border-color: var(--gules); }
	.streak-info { display: flex; gap: 16px; align-items: flex-start; }
	.streak-info .icone { font-size: 24px; }
	.streak-info p { margin: 4px 0 0; font-size: 12px; color: var(--argent); line-height: 1.4; }

	.bloco-mute { display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px; }
	.mute-status { display: flex; align-items: center; gap: 12px; font-weight: bold; font-size: 13px; }
	.ok-mute { color: var(--vert); }
	.bad-mute { color: var(--gules); }
	.btn-micro { padding: 2px 8px; font-size: 10px; min-height: auto; }

	.controles-mute { background: var(--sable); padding: 12px; border-radius: 2px; }
	.linha-btn { display: flex; gap: 10px; margin-top: 8px; }
	.divisor { border: none; border-top: 1px solid var(--borda); margin: 24px 0; }
</style>
