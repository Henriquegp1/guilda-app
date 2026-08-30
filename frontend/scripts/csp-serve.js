/**
 * Serve `build/` com uma CSP equivalente à que a Twitch aplica em extensões:
 * script só do próprio pacote, fonte só local ou Google Fonts, e connect-src
 * declarado. Serve para ver a extensão falhar aqui em vez de falhar em produção.
 *
 *   node scripts/csp-serve.js [porta] [origem-do-ebs]
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const TIPOS = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.woff2': 'font/woff2',
	'.png': 'image/png',
	'.txt': 'text/plain; charset=utf-8'
};

export const csp = (ebs = 'https://localhost:3000') =>
	[
		"default-src 'self'",
		"script-src 'self' https://extension-files.twitch.tv",
		"style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
		'font-src https://fonts.gstatic.com',
		`connect-src 'self' ${ebs}`,
		"img-src 'self' data:",
		"frame-ancestors https://*.twitch.tv"
	].join('; ');

export function serve({ port = 4173, dir = 'build', ebs } = {}) {
	const politica = csp(ebs);
	const server = createServer(async (req, res) => {
		const caminho = decodeURIComponent(new URL(req.url, 'http://x').pathname);
		// normalize + prefixo travado: sem isso `../` sai do diretório servido.
		// Cada view é um diretório (`panel/index.html`), que é como a Twitch as
		// referencia no manifesto da extensão.
		const alvo = caminho.endsWith('/') ? `${caminho}index.html` : caminho;
		const rel = normalize(alvo).replace(/^([/\\])+/, '');
		const arquivo = join(dir, rel);
		if (!arquivo.startsWith(normalize(dir))) {
			res.writeHead(403).end('fora do diretório');
			return;
		}
		try {
			const corpo = await readFile(arquivo);
			res.writeHead(200, {
				'content-type': TIPOS[extname(arquivo)] ?? 'application/octet-stream',
				'content-security-policy': politica
			});
			res.end(corpo);
		} catch {
			res.writeHead(404, { 'content-security-policy': politica }).end('não encontrado');
		}
	});
	return new Promise((ok) => server.listen(port, () => ok(server)));
}

if (import.meta.filename === process.argv[1]) {
	const port = Number(process.argv[2] ?? 4173);
	await serve({ port, ebs: process.argv[3] });
	console.log(`build/ em http://localhost:${port} com a CSP da Twitch`);
}
