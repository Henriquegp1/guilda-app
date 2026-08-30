<script lang="ts">
	import Estado from '$lib/ui/Estado.svelte';
	import { listarGuildas, entrar, meusConvites, aceitarConvite, ErroApi } from '$lib/api';
	import type { Guilda, Convite } from '$lib/api';

	let { aoEntrar }: { aoEntrar: () => void } = $props();

	let estado = $state<'carregando' | 'pronto' | 'vazio' | 'erro'>('carregando');
	let guildas = $state<Guilda[]>([]);
	let convites = $state<Convite[]>([]);
	let erro = $state('');
	let entrando = $state<number | null>(null);
	let aviso = $state('');

	async function carregar() {
		estado = 'carregando';
		try {
			const [lista, conv] = await Promise.all([
				listarGuildas(),
				// Convite exige identidade concedida; sem ela a lista some, não quebra.
				meusConvites().catch(() => ({ invites: [] as Convite[] }))
			]);
			guildas = lista.items;
			convites = conv.invites;
			estado = guildas.length || convites.length ? 'pronto' : 'vazio';
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Não foi possível carregar as guildas.';
			estado = 'erro';
		}
	}

	async function tentarEntrar(g: Guilda) {
		entrando = g.id;
		aviso = '';
		try {
			await entrar(g.id);
			aoEntrar();
		} catch (e) {
			// Guilda cheia, cooldown e identidade têm cada um sua mensagem — o
			// cliente da API já traduz o código.
			aviso = e instanceof ErroApi ? e.message : 'Não foi possível entrar.';
		} finally {
			entrando = null;
		}
	}

	async function aceitar(c: Convite) {
		aviso = '';
		try {
			await aceitarConvite(c.code);
			aoEntrar();
		} catch (e) {
			aviso = e instanceof ErroApi ? e.message : 'Não foi possível aceitar o convite.';
		}
	}

	$effect(() => {
		carregar();
	});

	const cheia = (g: Guilda) => g.member_count >= g.member_limit;
</script>

{#if estado === 'carregando'}
	<Estado estado="carregando" />
{:else if estado === 'erro'}
	<Estado estado="erro" mensagem={erro} acao="Tentar de novo" aoAgir={carregar} />
{:else if estado === 'vazio'}
	<Estado estado="vazio" mensagem="Nenhuma guilda aprovada neste canal ainda. A sua pode ser a primeira." />
{:else}
	<div class="rolagem">
	{#if aviso}
		<p class="aviso" role="alert">{aviso}</p>
	{/if}

	{#if convites.length}
		<h2>Convites</h2>
		<ul>
			{#each convites as c (c.invite_id)}
				<li>
					<span class="nome">
						<b>{c.guild.name}</b>
						<small>[{c.guild.tag}]</small>
					</span>
					<button onclick={() => aceitar(c)}>Aceitar</button>
				</li>
			{/each}
		</ul>
	{/if}

	<h2>Guildas do canal</h2>
	<ul>
		{#each guildas as g (g.id)}
			<li>
				<span class="nome">
					<b>{g.name}</b>
					<small>[{g.tag}] · Nv.{g.level} · {g.member_count}/{g.member_limit}</small>
				</span>
				<button
					disabled={cheia(g) || entrando === g.id}
					onclick={() => tentarEntrar(g)}
				>
					{cheia(g) ? 'Cheia' : entrando === g.id ? '...' : 'Entrar'}
				</button>
			</li>
		{/each}
	</ul>
	</div>
{/if}

<style>
	/* Sem min-height:0 a lista cresce em vez de rolar e escapa pelo recorte da
	   cauda de andorinha — filho de flex tem min-height auto por padrão. */
	.rolagem {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding-bottom: 6px;
		/* Diz "tem mais abaixo" em vez de parecer corte. */
		mask-image: linear-gradient(180deg, #000 calc(100% - 20px), transparent);
	}

	h2 {
		margin: 10px 0 4px;
		font-size: 10px;
		font-family: var(--texto);
		text-transform: uppercase;
		letter-spacing: 0.09em;
		color: var(--argent-fraco);
	}

	h2:first-child {
		margin-top: 0;
	}

	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}

	li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 0;
		border-bottom: 1px solid var(--borda);
	}

	.nome {
		flex: 1;
		min-width: 0;
	}

	.nome b {
		display: block;
		font-family: var(--display);
		font-size: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.nome small {
		color: var(--argent-fraco);
		font-size: 10px;
	}

	li button {
		min-height: 30px;
		padding: 5px 10px;
		font-size: 12px;
	}

	.aviso {
		margin: 0 0 8px;
		padding-left: 10px;
		border-left: 2px solid var(--gules);
		font-size: 12px;
	}
</style>
