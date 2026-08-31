<script lang="ts">
	import { memberEligibility, editarRoster, type Guerra, type MemberEligibility } from '$lib/api';
	import { onMount } from 'svelte';

	let { war, aoSucesso }: { war: Guerra; aoSucesso: () => void } = $props();

	let membros = $state<MemberEligibility[]>([]);
	let selecionados = $state<Set<string>>(new Set());
	let ocupado = $state(false);
	let erro = $state('');

	onMount(async () => {
		try {
			const res = await memberEligibility(war.challenger_guild_id === war.challenger_guild_id ? war.challenger_guild_id : war.defender_guild_id);
			// Na verdade precisamos saber qual é a NOSSA guilda. Passaremos como prop.
		} catch (e) {
			console.error(e);
		}
	});
</script>

<!-- Vou ajustar as props para receber a guildaId e o cargo -->
