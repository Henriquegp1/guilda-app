import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const INLINE = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const ANCHOR = 'document.currentScript.parentElement';
const ANCHOR_FIX = "document.getElementById('svelte-root')";

const corrigir = (corpo) =>
	corpo
		.replaceAll(ANCHOR, ANCHOR_FIX)
		.replace(/^(\s*)(__sveltekit_[a-z0-9]+)( = )/m, '$1window.$2$3')
		.replace(
								/(window\.__sveltekit_[a-z0-9]+ = )\{\s*base: [^\n]+\s*\};/,
				`const twitchRoute = location.pathname.match(/\\/(config|panel|overlay|mobile|live|moderacao|lab|teste-identidade)\\b/);
			if (twitchRoute) history.replaceState(history.state, '', '/' + twitchRoute[1] + '/' + location.search);
						$1{ base: '' };`
		);

async function* arquivosDe(dir, extensao) {
	for (const item of await readdir(dir, { withFileTypes: true })) {
		const caminho = join(dir, item.name);
		if (item.isDirectory()) yield* arquivosDe(caminho, extensao);
		else if (item.name.endsWith(extensao)) yield caminho;
	}
}

export async function externalize(dir = 'build') {
	const feitos = [];
	for await (const caminho of arquivosDe(dir, '.html')) {
		const html = await readFile(caminho, 'utf8');
		const scripts = [];

		const saida = html.replace(INLINE, (tagcompleta, corpo) => {
			if (tagcompleta.includes(' src=') || !corpo.includes('__sveltekit')) return tagcompleta;
			const nome = `boot${scripts.length ? `-${scripts.length}` : ''}.js`;
			scripts.push({ nome, corpo: corrigir(corpo) });
			return `<script type="module" src="./${nome}"></script>`;
		});

		if (!scripts.length) continue;
		for (const { nome, corpo } of scripts) {
			await writeFile(join(dirname(caminho), nome), corpo, 'utf8');
			feitos.push(relative(dir, join(dirname(caminho), nome)).replaceAll('\\', '/'));
		}
		await writeFile(caminho, saida, 'utf8');
	}
	return feitos;
}

if (import.meta.filename === process.argv[1]) {
	const feitos = await externalize();
	console.log(feitos.length ? `externalizado: ${feitos.join(', ')}` : 'nenhum script inline');
}
