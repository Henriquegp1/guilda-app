<script lang="ts">
	import { declararGuerra, listarTerritorios, type Guilda, type WarFormat, type Territory } from '$lib/api';
	import { wars } from '$lib/stores/warStore';

	let { guilda, aoCancelar }: { guilda: Guilda; aoCancelar: () => void } = $props();

	let tagInimiga = $state('');
	let formato = $state<WarFormat>('skirmish');
	let stakeId = $state<number | null>(null);
	let territóriosDisponíveis = $state<Territory[]>([]);
	let ocupado = $state(false);
	let erro = $state('');

	async function carregarTerritorios() {
		if (formato !== 'special' || tagInimiga.length < 2) return;
		try {
			const res = await listarTerritorios();
			// Apenas territórios da guilda alvo que NÃO estão protegidos
			territóriosDisponíveis = res.items.filter(t =>
				t.owner_tag?.toUpperCase() === tagInimiga.toUpperCase() &&
				(!t.protected_until || +new Date(t.protected_until) < Date.now())
			);
		} catch (e) {
			console.error(e);
		}
	}

	$effect(() => {
		if (formato === 'special') carregarTerritorios();
	});

	async function enviar() {
		if (tagInimiga.length < 2) {
			erro = 'TAG inválida.';
			return;
		}
		if (formato === 'special' && !stakeId) {
			erro = 'Selecione um território para disputar.';
			return;
		}

		ocupado = true;
		erro = '';
		try {
			await declararGuerra({
				defender_tag: tagInimiga,
				format: formato,
				stake_territory_id: stakeId || undefined
			});
			await wars.atualizar();
			aoCancelar();
		} catch (e) {
			erro = e instanceof Error ? e.message : 'Falha ao declarar guerra.';
		} finally {
			ocupado = false;
		}
	}
</script>

<div class="declarar-guerra">
	<header>
		<button class="voltar" onclick={aoCancelar}>← Voltar</button>
		<h3>Novo Desafio</h3>
	</header>

	<div class="campo">
		<label for="tag">TAG da Guilda Inimiga</label>
		<input
			id="tag"
			bind:value={tagInimiga}
			oninput={carregarTerritorios}
			placeholder="Ex: VOID"
			maxlength="5"
			style="text-transform: uppercase"
		/>
	</div>

	<div class="campo">
		<label for="formato">Formato</label>
		<select id="formato" bind:value={formato}>
			<option value="skirmish">Skirmish (6h - Rápido)</option>
			<option value="campaign">Campaign (7 dias - Épico)</option>
			<option value="special">Special (Personalizado + Stake)</option>
		</select>
	</div>

	{#if formato === 'special'}
		<div class="campo">
			<label for="stake">Território Alvo (O vencedor leva)</label>
			{#if territóriosDisponíveis.length > 0}
				<select id="stake" bind:value={stakeId}>
					<option value={null}>Selecione um território...</option>
					{#each territóriosDisponíveis as t}
						<option value={t.id}>{t.name} (+{t.prestige_per_day} PPD)</option>
					{/each}
				</select>
			{:else}
				<p class="aviso-stake">Nenhum território atacável encontrado para esta TAG.</p>
			{/if}
		</div>
	{/if}

	{#if erro}<p class="erro">{erro}</p>{/if}

	<button class="confirmar" disabled={ocupado || !tagInimiga} onclick={enviar}>
		{ocupado ? 'Enviando...' : 'Lançar Desafio'}
	</button>

	<p class="nota">
		O desafio ficará pendente até a guilda inimiga aceitar ou o tempo expirar.
	</p>
</div>

<style>
	.declarar-guerra {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	header {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.voltar {
		background: none;
		border: none;
		color: var(--or);
		font-size: 12px;
		cursor: pointer;
	}

	h3 { margin: 0; font-family: var(--display); color: var(--or); }

	.campo {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	label {
		font-size: 11px;
		text-transform: uppercase;
		color: var(--argent-fraco);
	}

	input, select {
		padding: 10px;
		background: var(--sable-2);
		border: 1px solid var(--borda);
		color: var(--argent);
		border-radius: 2px;
		font: inherit;
		width: 100%;
	}

	.aviso-stake {
		font-size: 11px;
		color: var(--gules);
		margin: 0;
	}

	.erro { color: var(--gules); font-size: 12px; margin: 0; }

	.confirmar {
		padding: 12px;
		background: var(--gules);
		color: #fff;
		font-weight: bold;
		border: none;
		border-radius: 2px;
		cursor: pointer;
	}

	.confirmar:disabled { opacity: 0.5; }

	.nota { font-size: 11px; color: var(--argent-fraco); text-align: center; margin: 0; }
</style>
