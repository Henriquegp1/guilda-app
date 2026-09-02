/** @type {import('@sveltejs/kit').Reroute} */
export function reroute({ url }) {
	const match = url.pathname.match(/\/(config|panel|overlay|mobile|live|moderacao|lab|teste-identidade)\b/);

	if (match) return `/${match[1]}`;
}