<script lang="ts">
	import { onMount } from 'svelte';
	import { catalog } from '$lib/catalog';
	import '../app.css';

	let { children } = $props();

	onMount(() => {
		catalog.load();
	});
</script>

{@render children()}
