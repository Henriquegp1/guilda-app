<script lang="ts">
	import {
		listarTerritorios,
		criarTerritorio,
		atualizarTerritorio,
		excluirTerritorio,
		type Territory
	} from '$lib/api';
	import { onMount } from 'svelte';

	let territories = $state<Territory[]>([]);
	let loading = $state(true);
	let error = $state('');
	let editingId = $state<number | null>(null);

	let form = $state<Partial<Territory>>({
		name: '',
		prestige_per_day: 10,
		map_x: 500,
		map_y: 500,
		enabled: true
	});

	async function load() {
		try {
			const res = await listarTerritorios();
			territories = res.items;
		} catch (e) {
			error = 'Falha ao carregar territórios.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function validarDistancia() {
		const x = Number(form.map_x) || 0;
		const y = Number(form.map_y) || 0;
		for (const t of territories) {
			if (editingId && t.id === editingId) continue;
			const dx = t.map_x - x;
			const dy = t.map_y - y;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist < 100) {
				return `Muito próximo de "${t.name}" (distância mínima de 100px exigida).`;
			}
		}
		return null;
	}

	async function save() {
		error = '';
		const avisoDistancia = validarDistancia();
		if (avisoDistancia) {
			error = avisoDistancia;
			return;
		}

		try {
			if (editingId) {
				await atualizarTerritorio(editingId, form);
			} else {
				await criarTerritorio(form);
			}
			reset();
			await load();
		} catch (e: any) {
			error = e.message || 'Erro ao salvar.';
		}
	}

	async function remove(id: number) {
		if (!confirm('Excluir este território?')) return;
		try {
			await excluirTerritorio(id);
			await load();
		} catch (e: any) {
			error = e.message || 'Erro ao excluir.';
		}
	}

	function edit(t: Territory) {
		editingId = t.id;
		form = {
			name: t.name,
			prestige_per_day: t.prestige_per_day,
			map_x: t.map_x,
			map_y: t.map_y,
			enabled: t.enabled
		};
	}

	function reset() {
		editingId = null;
		form = {
			name: '',
			prestige_per_day: 10,
			map_x: 500,
			map_y: 500,
			enabled: true
		};
	}
</script>

<div class="gerenciar">
	<div class="form-secao">
		<h3>{editingId ? 'Editar Território' : 'Novo Território'}</h3>
		<div class="grade-form">
			<label>
				Nome
				<input bind:value={form.name} placeholder="Ex: Floresta Sombria" />
			</label>
			<label>
				Prestígio/Dia
				<input type="number" bind:value={form.prestige_per_day} min="0" max="25" />
			</label>
			<label>
				Posição X (0-1000)
				<input type="number" bind:value={form.map_x} min="0" max="1000" />
			</label>
			<label>
				Posição Y (0-1000)
				<input type="number" bind:value={form.map_y} min="0" max="1000" />
			</label>
			<label class="checkbox">
				<input type="checkbox" bind:checked={form.enabled} />
				Habilitado
			</label>
		</div>

		{#if error}<p class="erro">{error}</p>{/if}

		<div class="acoes-form">
			<button class="primario" onclick={save}>{editingId ? 'Atualizar' : 'Criar'}</button>
			{#if editingId}
				<button class="fantasma" onclick={reset}>Cancelar</button>
			{/if}
		</div>
	</div>

	<div class="lista-secao">
		<header>
			<h3>Existentes</h3>
			<span class="conta num">{territories.length} / 12</span>
		</header>

		{#if loading}
			<p>Carregando...</p>
		{:else if territories.length === 0}
			<p class="vazio">Nenhum território criado ainda.</p>
		{:else}
			<ul class="lista">
				{#each territories as t (t.id)}
					<li class:desabilitado={!t.enabled}>
						<div class="info">
							<b>{t.name}</b>
							<small>+{t.prestige_per_day} PPD · Pos: {t.map_x}, {t.map_y}</small>
						</div>
						<div class="btns">
							<button class="icon-btn" onclick={() => edit(t)} title="Editar">✏️</button>
							<button class="icon-btn ruim" onclick={() => remove(t.id)} title="Excluir">🗑️</button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
</div>

<style>
	.gerenciar {
		display: flex;
		flex-direction: column;
		gap: 24px;
	}

	h3 {
		margin: 0 0 16px;
		font-size: 14px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--or);
	}

	.grade-form {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 11px;
		color: var(--argent-fraco);
		text-transform: uppercase;
	}

	label.checkbox {
		flex-direction: row;
		align-items: center;
		grid-column: 1 / -1;
		margin-top: 4px;
	}

	input {
		padding: 8px;
		background: var(--sable);
		border: 1px solid var(--borda);
		color: var(--argent);
		border-radius: 2px;
		font: inherit;
	}

	.acoes-form {
		margin-top: 16px;
		display: flex;
		gap: 12px;
	}

	button.primario {
		background: var(--or);
		color: var(--sable);
		border: none;
		padding: 8px 24px;
		font-weight: bold;
		cursor: pointer;
	}

	button.fantasma {
		background: none;
		border: 1px solid var(--borda);
		color: var(--argent-fraco);
		padding: 8px 16px;
		cursor: pointer;
	}

	.lista-secao header {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
	}

	.conta {
		font-size: 12px;
		color: var(--or);
	}

	.lista {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lista li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px;
		background: var(--sable);
		border: 1px solid var(--borda);
		border-radius: 2px;
	}

	.desabilitado {
		opacity: 0.5;
	}

	.info b {
		display: block;
		font-size: 14px;
	}

	.info small {
		font-size: 11px;
		color: var(--argent-fraco);
	}

	.btns {
		display: flex;
		gap: 8px;
	}

	.icon-btn {
		background: none;
		border: 1px solid var(--borda);
		cursor: pointer;
		padding: 4px 8px;
		border-radius: 2px;
	}

	.icon-btn.ruim:hover {
		border-color: var(--gules);
	}

	.erro {
		color: var(--gules);
		font-size: 12px;
		margin-top: 12px;
	}

	.vazio {
		color: var(--argent-fraco);
		font-size: 12px;
		font-style: italic;
	}
</style>
