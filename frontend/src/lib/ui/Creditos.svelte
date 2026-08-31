<script lang="ts">
	type Atribuicao = {
		id: string;
		autor: string;
		fonte: string;
		licenca: string;
		url: string;
	};

	const creditos: Atribuicao[] = [
		{
			id: 'game-icons-base',
			autor: 'Lorc, Delapouite e outros',
			fonte: 'Game-icons.net',
			licenca: 'CC BY 3.0',
			url: 'https://game-icons.net'
		},
		{
			id: 'rpg-filled-set',
			autor: 'Skoll',
			fonte: 'SVG Repo / Game-icons',
			licenca: 'CC BY 4.0',
			url: 'https://www.svgrepo.com/collection/rpg-game-filled-icons/'
		}
	];
</script>

<div class="creditos">
	<h3>Créditos e Atribuições</h3>
	<p class="intro">
		Esta extensão utiliza ícones de alta qualidade fornecidos pela comunidade de código aberto.
	</p>

	<div class="lista">
		{#each creditos as c}
			<div class="item">
				<div class="meta">
					<b>{c.fonte}</b>
					<span>Autor: {c.autor}</span>
					<small>Licença: {c.licenca}</small>
				</div>
				<a href={c.url} target="_blank" rel="noopener noreferrer">Ver Fonte ↗</a>
			</div>
		{/each}
	</div>

	<p class="nota">
		Todos os direitos pertencem aos seus respectivos autores. Se você é um autor e acredita que
		deveríamos ajustar sua menção, entre em contato.
	</p>
</div>

<style>
	.creditos {
		padding: 1.5rem;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		border-radius: 4px;
		font-family: var(--texto);
		font-size: 13px;
		color: var(--argent-fraco);
	}

	h3 {
		margin: 0 0 0.5rem;
		color: var(--or);
		text-transform: uppercase;
		font-size: 14px;
		letter-spacing: 0.1em;
	}

	.intro {
		margin-bottom: 1.5rem;
		line-height: 1.4;
	}

	.lista {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.item {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding-bottom: 0.8rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.05);
	}

	.meta {
		display: flex;
		flex-direction: column;
	}

	.meta b { color: var(--argent); }
	.meta small { font-size: 11px; opacity: 0.7; }

	a {
		color: var(--or);
		text-decoration: none;
		font-size: 12px;
		font-weight: bold;
	}

	a:hover { text-decoration: underline; }

	.nota {
		margin-top: 1.5rem;
		font-size: 11px;
		font-style: italic;
		opacity: 0.6;
	}
</style>
