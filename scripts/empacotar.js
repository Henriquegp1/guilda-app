/**
 * Empacota o repositório para levar ao git: só fonte, docs e arquivos de deploy.
 * Fica de fora tudo que se regenera (node_modules, build, capturas) e tudo que
 * é segredo (.env).
 *
 *   node scripts/empacotar.js
 */
import JSZip from '../frontend/node_modules/jszip/dist/jszip.min.js';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const IGNORAR = new Set([
	'node_modules',
	'.git',
	'.svelte-kit',
	'build',
	'.olhar',
	'.telas',
	'caddy_data',
	'caddy_config'
]);

/** Segredo e artefato nunca entram, mesmo que alguém tenha commitado antes. */
const ehSegredo = (nome) => nome === '.env' || (nome.startsWith('.env.') && !nome.endsWith('.example'));
const ehArtefato = (nome) => nome === 'extensao.zip' || nome === 'repositorio.zip';

async function* arquivos(dir, raiz = dir) {
	for (const item of await readdir(dir, { withFileTypes: true })) {
		if (IGNORAR.has(item.name) || ehSegredo(item.name) || ehArtefato(item.name)) continue;
		const caminho = join(dir, item.name);
		if (item.isDirectory()) yield* arquivos(caminho, raiz);
		else yield caminho;
	}
}

const zip = new JSZip();
const dentro = [];

for await (const caminho of arquivos('.')) {
	const nome = relative('.', caminho).split(sep).join('/');
	zip.file(nome, await readFile(caminho));
	dentro.push(nome);
}

const saida = 'repositorio.zip';
await writeFile(saida, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

const kb = (await stat(saida)).size / 1024;
console.log(`${saida} — ${dentro.length} arquivos, ${kb.toFixed(0)} KB`);

// Conferência: nenhum segredo escapou.
const suspeitos = dentro.filter((n) => /(^|\/)\.env$/.test(n) || /\.env\.[^/]*$/.test(n));
const vazados = suspeitos.filter((n) => !n.endsWith('.example'));
if (vazados.length) {
	console.error('SEGREDO no pacote:', vazados.join(', '));
	process.exit(1);
}
console.log(`sem segredos; exemplos incluídos: ${suspeitos.join(', ') || 'nenhum'}`);
