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

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let erro = $state('');
	let salvo = $state('');

	let anuncio = $state<{ webhook_url?: string; enabled?: boolean; max_per_hour?: number }>({});
	let temporada = $state<Temporada | null>(null);

	async function carregar() {
		try {
			const [a, t] = await Promise.all([
				configAnuncio().catch(() => ({})),
				temporadaAtual().catch(() => null)
			]);
			anuncio = a as typeof anuncio;
			temporada = t;
			estado = 'pronto';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Não foi possível carregar a configuração.';
			estado = 'erro';
		}
	}

	async function salvar() {
		salvo = '';
		erro = '';
		try {
			await salvarConfigAnuncio(anuncio);
			salvo = 'Configuração salva.';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Não foi possível salvar.';
		}
	}

	onMount(() => {
		iniciar();
		return onAuth(carregar);
	});
</script>

<main>
	<h1>Twitch Guilds</h1>
	<p class="sub">Configuração do canal. As mudanças valem para todos os viewers.</p>

	{#if estado === 'carregando'}
		<Estado estado="carregando" />
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
	{:else}
		<section>
			<h2>Anúncios no chat</h2>
			<p class="ajuda">
				A extensão avisa seu bot quando algo acontece — guilda criada, mudança de líder no
				ranking, guerra encerrada. É assim que quem não abriu o painel descobre que o
				sistema existe.
			</p>

			<label class="linha">
				<input type="checkbox" bind:checked={anuncio.enabled} />
				Enviar anúncios
			</label>

			<label>
				Endereço do bot
				<input
					type="url"
					placeholder="https://seu-bot.exemplo.com/guildas"
					bind:value={anuncio.webhook_url}
				/>
				<small>Recebe um POST assinado. Deixe em branco para desligar.</small>
			</label>

			<label>
				Máximo por hora
				<input type="number" min="4" max="20" bind:value={anuncio.max_per_hour} />
				<small>Acima disso os anúncios viram ruído ao lado da live. Recomendado: 12.</small>
			</label>

			<div class="acoes">
				<button onclick={salvar}>Salvar</button>
				{#if salvo}<span class="ok">{salvo}</span>{/if}
				{#if erro}<span class="ruim">{erro}</span>{/if}
			</div>
		</section>

		<section>
			<h2>Temporada</h2>
			{#if temporada}
				<p class="ajuda">
					<b>{temporada.name}</b> — termina em
					{new Date(temporada.ends_at).toLocaleDateString('pt-BR')}. O Prestígio zera na
					virada; nome, membros, nível e conquistas permanecem.
				</p>
			{:else}
				<p class="ajuda">
					Nenhuma temporada ativa. O ranking competitivo só começa quando existir uma.
				</p>
			{/if}
		</section>

		<section>
			<h2>Territórios</h2>
			<p class="ajuda">
				Crie os locais que as guildas disputarão. Cada território rende Prestígio por dia para a
				guilda que o dominar.
			</p>
			<GerenciarTerritorios />
		</section>
	{/if}
</main>

<style>
	main {
		max-width: 640px;
		margin: 0 auto;
		padding: 22px 16px 48px;
		background: var(--sable);
		min-height: 100vh;
	}

	h1 {
		font-size: 26px;
	}

	.sub {
		margin: 4px 0 24px;
		color: var(--argent-fraco);
	}

	section {
		padding: 16px;
		margin-bottom: 14px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 2px;
	}

	h2 {
		margin: 0 0 8px;
		font-size: 16px;
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.conta {
		font-family: var(--texto);
		font-size: 12px;
		color: var(--or);
	}

	.ajuda {
		margin: 0 0 14px;
		font-size: 12px;
		color: var(--argent-fraco);
		text-wrap: pretty;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 12px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--argent-fraco);
	}

	label.linha {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}

	input[type='url'],
	input[type='number'] {
		font: inherit;
		font-size: 13px;
		text-transform: none;
		letter-spacing: 0;
		color: var(--argent);
		background: var(--sable);
		border: 1px solid var(--borda);
		border-radius: 2px;
		padding: 8px;
	}

	input:focus {
		border-color: var(--or);
		outline: none;
	}

	small {
		font-size: 11px;
		text-transform: none;
		letter-spacing: 0;
	}

	.acoes {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.ok {
		color: var(--vert);
		font-size: 12px;
	}

	.ruim {
		color: var(--gules);
		font-size: 12px;
	}

	.terrs {
		list-style: none;
		margin: 0;
		padding: 0;
		font-size: 13px;
	}

	.terrs li {
		display: flex;
		justify-content: space-between;
		padding: 6px 0;
		border-bottom: 1px solid var(--borda);
	}

	.dono {
		color: var(--or);
		font-family: var(--display);
	}
</style>
