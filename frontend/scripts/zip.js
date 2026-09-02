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

// Lista de pastas que representam páginas da extensão
const paginas = ['config', 'lab', 'live', 'mobile', 'moderacao', 'overlay', 'panel', 'teste-identidade'];

for await (const caminho of arquivos('build')) {
	const nome = relative('build', caminho).split(sep).join('/');
	const data = await readFile(caminho);

	// Adiciona o arquivo original
	zip.file(nome, data);
	n++;

	// Se for um ícone, replicamos para dentro de cada pasta de página
	// Isso garante que caminhos relativos como "icons/..." funcionem sempre
	if (nome.startsWith('icons/')) {
		const baseNome = nome.replace('icons/', '');
		for (const p of paginas) {
			zip.file(`${p}/icons/${baseNome}`, data);
			n++;
		}
	}

	// Fazemos o mesmo para o catálogo SVG
	if (nome === 'catalog.svg') {
		for (const p of paginas) {
			zip.file(`${p}/catalog.svg`, data);
			n++;
		}
	}
}

const saida = 'extensao.zip';
await writeFile(saida, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));

const mb = (await stat(saida)).size / 1024 / 1024;
console.log(`${saida} — ${n} arquivos, ${mb.toFixed(2)} MB`);

if (mb > LIMITE_MB) {
	console.error(`acima do limite de ${LIMITE_MB} MB da Twitch`);
	process.exit(1);
}
