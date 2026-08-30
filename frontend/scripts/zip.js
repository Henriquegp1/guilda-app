/**
 * Empacota `build/` no zip que a Twitch aceita. O zip abre na RAIZ: os caminhos
 * declarados no Developer Console são `panel/index.html` e afins, sem pasta
 * envolvendo.
 *
 *   npm run zip
 */
import JSZip from 'jszip';
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const LIMITE_MB = 25;

async function* arquivos(dir) {
	for (const item of await readdir(dir, { withFileTypes: true })) {
		const caminho = join(dir, item.name);
		if (item.isDirectory()) yield* arquivos(caminho);
		else yield caminho;
	}
}

const zip = new JSZip();
let n = 0;

for await (const caminho of arquivos('build')) {
	// Zip usa barra normal em qualquer sistema; no Windows o path vem com "\".
	const nome = relative('build', caminho).split(sep).join('/');
	zip.file(nome, await readFile(caminho));
	n++;
}

const saida = 'extensao.zip';
await writeFile(saida, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

const mb = (await stat(saida)).size / 1024 / 1024;
console.log(`${saida} — ${n} arquivos, ${mb.toFixed(2)} MB`);

if (mb > LIMITE_MB) {
	console.error(`acima do limite de ${LIMITE_MB} MB da Twitch`);
	process.exit(1);
}
