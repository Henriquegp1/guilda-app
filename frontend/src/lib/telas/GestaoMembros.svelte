<script lang="ts">
	import { onMount } from 'svelte';
	import { membros, alterarCargo, ErroApi, type Guilda, type Membro, type Cargo } from '$lib/api';
	import { entrarBloco } from '$lib/motion';

	let { guilda, cargoAtor, aoSair, aoAtualizar }: { guilda: Guilda; cargoAtor: Cargo; aoSair: () => void; aoAtualizar: () => void } = $props();

	let lista = $state<Membro[]>([]);
	let ocupado = $state(false);
	let erro = $state('');

	const CARGOS: Cargo[] = ['lider', 'sub-lider', 'comandante', 'vassalo'];

	async function carregar() {
		try {
			const res = await membros(guilda.id);
			lista = res.members;
		} catch (e) {
			erro = 'Erro ao carregar membros.';
		}
	}

	async function mudarCargo(m: Membro, novo: Cargo) {
		if (ocupado) return;
		ocupado = true;
		erro = '';
		try {
			await alterarCargo(guilda.id, m.user_id, novo);
			await carregar();
			aoAtualizar();
		} catch (e) {
			erro = e instanceof ErroApi ? e.message : 'Erro ao mudar cargo.';
		} finally {
			ocupado = false;
		}
	}

	onMount(carregar);

	// Regras de UI: Lider pode mudar todos abaixo. Sub-lider pode mudar comandantes e vassalos.
	const podeMudar = (alvo: Membro) => {
		if (alvo.role === 'lider') return false;
		if (cargoAtor === 'lider') return true;
		if (cargoAtor === 'sub-lider' && (alvo.role === 'comandante' || alvo.role === 'vassalo')) return true;
		return false;
	};
</script>

<div class="gestao" in:entrarBloco>
	{#if erro}<p class="erro">{erro}</p>{/if}

	<div class="lista">
		{#each lista as m}
			<div class="membro">
				<div class="info">
					<span class="id">ID: {m.user_id}</span>
					<span class="cargo-atual">{m.role}</span>
				</div>

				<div class="acoes">
					{#if podeMudar(m)}
						<select
							value={m.role}
							disabled={ocupado}
							onchange={(e) => mudarCargo(m, e.currentTarget.value as Cargo)}
						>
							{#each CARGOS.filter(c => c !== 'lider') as c}
								<option value={c}>{c}</option>
							{/each}
						</select>
					{/if}
				</div>
			</div>
		{/each}
	</div>
</div>

<style>
	.gestao { flex: 1; display: flex; flex-direction: column; padding: 16px; min-height: 0; }
	.erro { color: var(--gules); font-size: 12px; margin-bottom: 12px; text-align: center; }
	.lista { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
	.membro { display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--sable-2); border: 1px solid var(--borda); border-radius: 4px; }
	.info { display: flex; flex-direction: column; gap: 2px; }
	.id { font-size: 11px; color: var(--argent); }
	.cargo-atual { font-size: 10px; text-transform: uppercase; color: var(--or); font-weight: bold; }
	select { background: var(--sable); color: var(--argent); border: 1px solid var(--borda); font-size: 11px; padding: 4px; border-radius: 2px; }
</style>
