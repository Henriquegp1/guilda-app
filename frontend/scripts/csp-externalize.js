/**
 * A CSP da Twitch bloqueia <script> inline sem nonce/hash, e não há como injetar
 * nonce numa política que a Twitch serve. O SvelteKit emite um bootstrap inline
 * de ~370 bytes em cada página; este passo o move para um arquivo externo.
 *
 * O arquivo fica AO LADO da sua página, não numa pasta comum: os `import()` de
 * dentro dele são relativos ao script, e o SvelteKit já os escreveu relativos à
 * profundidade da página (`../_app/...` em `panel/index.html`).
 *
 * Roda depois do `vite build`, sobre `build/`. Se o SvelteKit parar de emitir
 * script inline, este passo vira no-op e `npm run check:csp` segue verde.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';

const INLINE = /<script>([\s\S]*?)<\/script>/g;

/** Fora de um script inline não existe `document.currentScript`. */
const ANCHOR = 'document.currentScript.parentElement';
const ANCHOR_FIX = "document.getElementById('svelte-root')";

/**
 * O bootstrap faz `__sveltekit_abc123 = {...}` sem declarar. Num script inline
 * isso cria um global pelo modo solto; num módulo, que é sempre estrito, vira
 * ReferenceError. Torna o global explícito.
 */
const GLOBAL = /^(\s*)(__sveltekit_[a-z0-9]+)( = )/m;

const corrigir = (corpo) => corpo.replaceAll(ANCHOR, ANCHOR_FIX).replace(GLOBAL, '$1window.$2$3');

async function* paginas(dir) {
	for (const item of await readdir(dir, { withFileTypes: true })) {
		const caminho = join(dir, item.name);
		if (item.isDirectory()) yield* paginas(caminho);
		else if (item.name.endsWith('.html')) yield caminho;
	}
}

export async function externalize(dir = 'build') {
	const feitos = [];

	for await (const caminho of paginas(dir)) {
		const html = await readFile(caminho, 'utf8');
		const arquivos = [];

		const saida = html.replace(INLINE, (_, corpo) => {
			if (!corpo.includes(ANCHOR)) {
				throw new Error(
					`${caminho}: script inline sem a âncora esperada. ` +
						`O bootstrap do SvelteKit mudou — reveja este passo antes de publicar.`
				);
			}
			const nome = `boot${arquivos.length ? `-${arquivos.length}` : ''}.js`;
			arquivos.push({ nome, corpo: corrigir(corpo) });
			return `<script type="module" src="./${nome}"></script>`;
		});

		if (!arquivos.length) continue;
		for (const { nome, corpo } of arquivos) {
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
