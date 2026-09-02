/** @type {import('@sveltejs/kit').Reroute} */
export function reroute({ url }) {
	// Esta regex busca por nossas rotas no meio da URL gigante da Twitch
	// Ela captura "config", "panel", "live", etc., mesmo com index.html no fim
	const match = url.pathname.match(/\/(config|panel|overlay|mobile|live|moderacao|lab|teste-identidade)\b/);

	if (match) {
		// Retornamos a rota interna "limpa" para o SvelteKit
		// Ex: /dz4lri.../config/index.html -> /config
		return `/${match[1]}`;
	}
}
