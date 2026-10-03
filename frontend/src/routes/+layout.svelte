<script lang="ts">
	import { onMount } from 'svelte';
	import { catalog } from '$lib/catalog';
	import '../app.css';
	import '../tema-taverna.css';

	let { children } = $props();

	onMount(() => {
		catalog.load();
	});
</script>

{@render children()}
