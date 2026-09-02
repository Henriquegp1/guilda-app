<script lang="ts">
	import { catalog, assetsByLayer, assetsById } from '$lib/catalog';
	import Brasao from '$lib/ui/Brasao.svelte';
	import { type EmblemLayers, type Asset } from '$lib/api';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';

	let modo = $state<'designer' | 'simulacao'>('designer');
	let nivelSimulado = $state(1);
	let grade = $state<Partial<EmblemLayers>[]>([]);
	let favoritos = $state<Partial<EmblemLayers>[]>([]);
	let inspecionando = $state<Partial<EmblemLayers> | null>(null);

	// Filtros manuais para testar camadas específicas
	let filtros = $state<Record<string, string>>({
		shape: '',
		background: '',
		palette: '',
		border: '',
		symbol: '',
		effect: ''
	});

	onMount(() => {
		const salvos = localStorage.getItem('guilda_lab_favoritos');
		if (salvos) favoritos = JSON.parse(salvos);
		gerarAleatorios(20);
	});

	$effect(() => {
		// Re-gerar quando mudar o modo ou nível na simulação
		if (modo === 'simulacao' || Object.values(filtros).some(v => v !== '')) {
			// apenas se a grade já tiver algo
			if (grade.length > 0 && !Object.values(filtros).some(v => v !== '')) {
				gerarAleatorios(grade.length);
			}
		}
	});

	function salvarFavoritos() {
		localStorage.setItem('guilda_lab_favoritos', JSON.stringify(favoritos));
	}

	function rand<T>(arr: T[]): T {
		return arr[Math.floor(Math.random() * arr.length)];
	}

	function itemDisponivel(a: Asset) {
		if (modo === 'designer') return true;
		if (a.tier === 'free') return true;
		if (a.tier === 'level') return nivelSimulado >= (a.unlock_level || 0);
		return false;
	}

	function gerarBrasao(curado = false): Partial<EmblemLayers> {
		const camadas: Partial<EmblemLayers> = {};
		const layers: (keyof EmblemLayers)[] = ['shape', 'background', 'palette', 'border', 'symbol', 'effect'];

		for (const l of layers) {
			// Se houver um filtro manual fixo, usa ele
			if (filtros[l]) {
				camadas[l] = filtros[l] as any;
				continue;
			}

			const opcoes = get(assetsByLayer)[l].filter(itemDisponivel);
			if (opcoes.length === 0) continue;

			if (curado) {
				if ((l === 'border' || l === 'effect') && Math.random() < 0.3) {
					camadas[l] = (l === 'border' ? 'border.none' : 'effect.none') as any;
					continue;
				}
			}
			camadas[l] = rand(opcoes).id as any;
		}
		return camadas;
	}

	function gerarAleatorios(n: number, curado = false) {
		const novos = [];
		for (let i = 0; i < n; i++) novos.push(gerarBrasao(curado));
		grade = novos;
	}

	function toggleFavorito(b: Partial<EmblemLayers>) {
		const json = JSON.stringify(b);
		const index = favoritos.findIndex((f) => JSON.stringify(f) === json);
		if (index >= 0) {
			favoritos = favoritos.filter((_, i) => i !== index);
		} else {
			favoritos = [...favoritos, b];
		}
		salvarFavoritos();
	}

	let feedback = $state('');

	function copiarJson(b: Partial<EmblemLayers>) {
		navigator.clipboard.writeText(JSON.stringify(b, null, 2));
		feedback = 'JSON copiado!';
		setTimeout(() => { feedback = ''; }, 3000);
	}
</script>

<div class="lab">
	<header class="lab-header">
		<h1>Laboratório de Brasões</h1>
		<div class="controles-globais">
			<select bind:value={modo}>
				<option value="designer">Modo Designer (Tudo)</option>
				<option value="simulacao">Modo Simulação (Viewer)</option>
			</select>
			{#if modo === 'simulacao'}
				<div class="nivel-pick">
					<label for="nv">Nível:</label>
					<input id="nv" type="range" min="1" max="50" bind:value={nivelSimulado} />
					<span class="num">{nivelSimulado}</span>
				</div>
			{/if}
		</div>
		<div class="botoes">
			<button class="primario" onclick={() => gerarAleatorios(20)}>🎲 Gerar 20</button>
			<button class="primario" onclick={() => gerarAleatorios(100)}>🎲 Gerar 100</button>
			<button class="especial" onclick={() => gerarAleatorios(20, true)}>✨ Curados</button>
		</div>
	</header>

	<main class="viewport">
		<aside class="controles-manuais">
			<h2>Mixer Manual</h2>
			{#each Object.keys(filtros) as layer}
				<div class="grupo-filtro">
					<label>{layer}</label>
					<select bind:value={filtros[layer]} onchange={() => gerarAleatorios(grade.length)}>
						<option value="">🎲 Aleatório</option>
						{#each get(assetsByLayer)[layer].filter(itemDisponivel) as a}
							<option value={a.id}>{a.id.split('.')[1]}</option>
						{/each}
					</select>
				</div>
			{/each}
			<button class="reset" onclick={() => { filtros = { shape: '', background: '', palette: '', border: '', symbol: '', effect: '' }; gerarAleatorios(20); }}>Limpar Mixer</button>
		</aside>

		<section class="secao-grade">
			<div class="grade">
				{#each grade as b}
					<button
						type="button"
						class="item-brasao"
						onmouseenter={() => (inspecionando = b)}
						onclick={() => toggleFavorito(b)}
					>
						<Brasao layers={b} tamanho={80} />
						{#if favoritos.some((f) => JSON.stringify(f) === JSON.stringify(b))}
							<span class="fav-badge">⭐</span>
						{/if}
					</button>
				{/each}
			</div>
		</section>

		<aside class="painel-inspecao">
			<div class="sticky">
				<h2>Inspeção</h2>
				{#if inspecionando}
					<div class="preview-focado">
						<Brasao layers={inspecionando} tamanho={160} />
					</div>
					<div class="detalhes">
						{#each Object.entries(inspecionando) as [camada, id]}
							<div class="linha-detalhe">
								<span class="label">{camada}:</span>
																	{id}
									{#if get(assetsById).get(id as string)?.author}
										<small class="autor-ins">({get(assetsById).get(id as string)?.author})</small>
									{/if}
							</div>
						{/each}
					</div>
					<div class="acoes-inspecao">
						<button onclick={() => copiarJson(inspecionando!)}>Copiar JSON</button>
						<button class="btn-fav" onclick={() => toggleFavorito(inspecionando!)}>
							{favoritos.some((f) => JSON.stringify(f) === JSON.stringify(inspecionando)) ? 'Remover Favorito' : 'Favoritar'}
						</button>
					</div>
				{:else}
					<p class="vazio">Passe o mouse sobre um brasão para ver detalhes.</p>
				{/if}

				{#if favoritos.length > 0}
					<div class="favoritos-lista">
						<h3>Favoritos ({favoritos.length})</h3>
						<div class="mini-grade">
							{#each favoritos as f}
								<button class="mini-item" onclick={() => (inspecionando = f)}>
									<Brasao layers={f} tamanho={40} />
								</button>
							{/each}
						</div>
					</div>
				{/if}
			</div>
		</aside>
	</main>
</div>

<style>
	.lab {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0f111a;
		color: #e6e6e6;
		font-family: sans-serif;
	}

	.lab-header {
		display: flex;
		align-items: center;
		padding: 1rem 2rem;
		background: #1a1d2e;
		border-bottom: 1px solid #2d324d;
		gap: 2rem;
	}

	h1 { margin: 0; font-size: 1.25rem; color: #d4af37; text-transform: uppercase; letter-spacing: 0.1em; }

	.controles-globais { display: flex; gap: 1rem; align-items: center; }
	select { background: #0f111a; color: white; border: 1px solid #2d324d; padding: 0.4rem; border-radius: 4px; }
	.nivel-pick { display: flex; gap: 0.5rem; align-items: center; font-size: 0.9rem; }

	.botoes { display: flex; gap: 0.5rem; }
	button {
		background: #2d324d;
		color: white;
		border: none;
		padding: 0.5rem 1rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.9rem;
	}
	button:hover { background: #3d4466; }
	button.primario { background: #3498db; }
	button.especial { background: #9b59b6; }

	.viewport {
		flex: 1;
		display: flex;
		overflow: hidden;
	}

	.controles-manuais {
		width: 220px;
		background: #1a1d2e;
		border-right: 1px solid #2d324d;
		padding: 1.5rem;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.grupo-filtro {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.grupo-filtro label {
		font-size: 0.75rem;
		text-transform: uppercase;
		color: #888;
		letter-spacing: 0.05em;
	}

	.controles-manuais select {
		width: 100%;
		font-size: 0.85rem;
	}

	.reset {
		margin-top: 1rem;
		background: none;
		border: 1px solid #e74c3c;
		color: #e74c3c;
		font-size: 0.75rem;
	}

	.secao-grade {
		flex: 1;
		overflow-y: auto;
		padding: 2rem;
	}

	.grade {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
		gap: 1.5rem;
	}

	.item-brasao {
		background: #1a1d2e;
		border: 1px solid #2d324d;
		padding: 10px;
		border-radius: 8px;
		display: flex;
		justify-content: center;
		align-items: center;
		cursor: crosshair;
		position: relative;
		transition: transform 0.1s;
	}
	.item-brasao:hover {
		transform: scale(1.05);
		border-color: #d4af37;
	}

	.fav-badge {
		position: absolute;
		top: -5px;
		right: -5px;
		font-size: 1.2rem;
	}

	.painel-inspecao {
		width: 300px;
		background: #1a1d2e;
		border-left: 1px solid #2d324d;
		padding: 2rem;
		overflow-y: auto;
	}

	.sticky { position: sticky; top: 0; }

	h2 { margin: 0 0 1.5rem; font-size: 1.1rem; text-transform: uppercase; color: #888; }

	.preview-focado {
		display: flex;
		justify-content: center;
		margin-bottom: 2rem;
		background: #0f111a;
		padding: 1.5rem;
		border-radius: 12px;
	}

	.detalhes {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		margin-bottom: 2rem;
	}

	.linha-detalhe {
		display: flex;
		justify-content: space-between;
		font-size: 0.8rem;
		border-bottom: 1px solid #2d324d;
		padding-bottom: 4px;
	}

	.label { color: #888; }
	.valor { color: #d4af37; font-weight: bold; }
	.autor-ins { font-size: 9px; font-weight: normal; color: #666; margin-left: 4px; }

	.acoes-inspecao {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.vazio { color: #555; text-align: center; margin-top: 4rem; font-style: italic; }

	.favoritos-lista {
		margin-top: 3rem;
		border-top: 1px solid #2d324d;
		padding-top: 2rem;
	}

	h3 { font-size: 0.9rem; color: #888; margin-bottom: 1rem; }

	.mini-grade {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.5rem;
	}

	.mini-item {
		background: #0f111a;
		border: 1px solid #2d324d;
		padding: 4px;
		border-radius: 4px;
		cursor: pointer;
	}
</style>
