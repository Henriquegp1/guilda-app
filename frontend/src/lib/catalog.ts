import { writable, derived } from 'svelte/store';
import { fetchCatalog, type Catalog, type Asset } from './api';

function createCatalogStore() {
	const { subscribe, set, update } = writable<Catalog | null>(null);
	let loading = false;

	return {
		subscribe,
		async load() {
			if (loading) return;
			loading = true;
			try {
				const data = await fetchCatalog();
				set(data);
			} catch (e) {
				console.error('Falha ao carregar catálogo:', e);
			} finally {
				loading = false;
			}
		}
	};
}

export const catalog = createCatalogStore();

export const assetsById = derived(catalog, ($catalog) => {
	if (!$catalog) return new Map<string, Asset>();
	return new Map($catalog.assets.map((a) => [a.id, a]));
});

export const assetsByLayer = derived(catalog, ($catalog) => {
	const layers: Record<string, Asset[]> = {
		shape: [],
		background: [],
		palette: [],
		border: [],
		symbol: [],
		effect: []
	};
	if (!$catalog) return layers;
	for (const a of $catalog.assets) {
		layers[a.layer].push(a);
	}
	return layers;
});
