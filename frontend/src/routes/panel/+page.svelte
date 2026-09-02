<script lang="ts">
	import { onMount } from 'svelte';
	import Estandarte from '$lib/ui/Estandarte.svelte';
	import Estado from '$lib/ui/Estado.svelte';
	import Aba from '$lib/ui/Aba.svelte';
	import Brasao from '$lib/ui/Brasao.svelte';
	import MinhaGuilda from '$lib/telas/MinhaGuilda.svelte';
	import Guildas from '$lib/telas/Guildas.svelte';
	import Ranking from '$lib/telas/Ranking.svelte';
	import Criar from '$lib/telas/Criar.svelte';
	import PainelGuerra from '$lib/telas/PainelGuerra.svelte';
	import MapaMundi from '$lib/telas/MapaMundi.svelte';
	import { iniciar, onAuth } from '$lib/twitch';
	import { entrarBloco } from '$lib/motion';
	import { minhaGuilda, obterPerfil, salvarPerfil, ErroApi, type Guilda, type Cargo } from '$lib/api';

	let { fluido = false } = $props();

	let estado = $state<'carregando' | 'pronto' | 'erro'>('carregando');
	let guilda = $state<(Guilda & { my_role: Cargo }) | null>(null);
	let erro = $state('');
	let aba = $state('minha');

	let nickname = $state<string | null>(null);
	let precisaCriarNome = $state(false);
	let novoNome = $state('');
	let salvandoNome = $state(false);
	let erroNome = $state('');

	async function carregar() {
		try {
			const [gRes, perfRes] = await Promise.all([
				minhaGuilda(),
				obterPerfil().catch(() => ({ nickname: null }))
			]);
			guilda = gRes;
			nickname = perfRes.nickname;
			if (!nickname) {
				precisaCriarNome = true;
			}
			estado = 'pronto';
			if (!guilda && (aba === 'minha' || aba === 'criar')) aba = 'guildas';
			if (guilda && (aba === 'guildas' || aba === 'criar')) aba = 'minha';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Algo deu errado. Tente de novo.';
			estado = 'erro';
		}
	}

	async function salvarPersonagem() {
		if (!novoNome.trim()) {
			erroNome = 'Digite um nome para o seu personagem.';
			return;
		}
		salvandoNome = true;
		erroNome = '';
		try {
			const res = await salvarPerfil(novoNome.trim());
			nickname = res.nickname;
			precisaCriarNome = false;
		} catch (e: any) {
			erroNome = e.message || 'Erro ao salvar nome.';
		} finally {
			salvandoNome = false;
		}
	}

	onMount(() => {
		iniciar();
		return onAuth(carregar);
	});

	const abas = $derived(
		guilda
			? [
					{ id: 'minha', rotulo: 'Minha' },
					{ id: 'mapa', rotulo: 'Mapa' },
					{ id: 'guerra', rotulo: 'Guerra' },
					{ id: 'ranking', rotulo: 'Ranking' }
				]
			: [
					{ id: 'guildas', rotulo: 'Guildas' },
					{ id: 'mapa', rotulo: 'Mapa' },
					{ id: 'ranking', rotulo: 'Ranking' },
					{ id: 'criar', rotulo: 'Criar' }
				]
	);
</script>

<Estandarte {fluido}>
	{#if estado === 'carregando'}
		<div class="centro" aria-busy="true">
			<Brasao tamanho={88} />
			<p>Carregando</p>
		</div>
	{:else if estado === 'erro'}
		<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
	{:else}
		<Aba {abas} bind:atual={aba} />

		{#key aba}
			<div class="aba-conteudo" in:entrarBloco>
				{#if aba === 'minha' && guilda}
					<MinhaGuilda {guilda} cargo={guilda.my_role} aoSair={carregar} aoAtualizar={carregar} />
				{:else if aba === 'mapa'}
					<MapaMundi />
				{:else if aba === 'guerra' && guilda}
					<PainelGuerra {guilda} cargo={guilda.my_role} />
				{:else if aba === 'guildas'}
					<Guildas aoEntrar={carregar} />
				{:else if aba === 'ranking'}
					<Ranking minhaGuildaId={guilda?.id ?? null} />
				{:else if aba === 'criar'}
					<Criar aoCriar={carregar} />
				{/if}
			</div>
		{/key}
	{/if}

	{#if precisaCriarNome}
		<div class="modal-personagem" in:entrarBloco>
			<div class="box-personagem">
				<Brasao tamanho={64} />
				<h2>Crie seu Personagem</h2>
				<p>Escolha o nome pelo qual você será conhecido no canal e entre as guildas.</p>
				<input
					type="text"
					placeholder="Ex: Sir_Lancelot"
					bind:value={novoNome}
					maxlength={20}
					disabled={salvandoNome}
				/>
				{#if erroNome}<p class="erro-p">{erroNome}</p>{/if}
				<button class="btn-salvar-p" disabled={salvandoNome || !novoNome.trim()} onclick={salvarPersonagem}>
					{salvandoNome ? 'Salvando...' : 'Confirmar Personagem'}
				</button>
			</div>
		</div>
	{/if}
</Estandarte>

<style>
	.centro {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
	}

	.centro p {
		margin: 0;
		color: var(--argent-fraco);
	}

	.aba-conteudo {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: var(--or) transparent;
	}

	.aba-conteudo::-webkit-scrollbar {
		width: 4px;
	}

	.aba-conteudo::-webkit-scrollbar-thumb {
		background: var(--or);
		border-radius: 2px;
	}

	.modal-personagem {
		position: absolute;
		inset: 0;
		background: rgba(14, 11, 19, 0.95);
		z-index: 2000;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
	}

	.box-personagem {
		background: var(--sable-2);
		border: 1px solid var(--or);
		border-radius: 8px;
		padding: 20px;
		width: 100%;
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 12px;
		box-shadow: 0 4px 20px rgba(0,0,0,0.8);
	}

	.box-personagem h2 {
		color: var(--or);
		font-size: 16px;
		margin: 0;
	}

	.box-personagem p {
		font-size: 11px;
		color: var(--argent-fraco);
		margin: 0;
		line-height: 1.4;
	}

	.box-personagem input {
		width: 100%;
		padding: 10px;
		background: var(--sable);
		border: 1px solid var(--borda);
		color: var(--argent);
		font-family: inherit;
		font-size: 13px;
		text-align: center;
		border-radius: 4px;
	}

	.erro-p {
		color: var(--gules);
		font-size: 11px;
		margin: 0;
	}

	.btn-salvar-p {
		width: 100%;
		padding: 12px;
		background: var(--or);
		color: var(--sable);
		font-weight: bold;
		border: none;
		border-radius: 4px;
		cursor: pointer;
		text-transform: uppercase;
		font-size: 12px;
	}
</style>
