/**
 * Carrega cada view do build sob a CSP da Twitch e falha se o navegador bloquear
 * qualquer coisa. É o guarda da F0: a extensão pode passar em todo teste de
 * unidade e ainda assim não carregar dentro da Twitch por causa da política.
 *
 *   npm run check:csp
 */
import { chromium } from 'playwright';
import { serve } from './csp-serve.js';

// A CSP do teste precisa declarar exatamente a origem que o build vai chamar:
// esquema incluso. Foi assim que a F0 descobriu que http:// vs https:// bloqueia.
const EBS = process.env.VITE_EBS ?? 'http://localhost:3000';

const VIEWS = ['panel', 'overlay', 'mobile', 'config', 'live'];
const PORTA = 4199;

const ehViolacaoCsp = (t) =>
	/Content Security Policy|Refused to (load|execute|connect)/i.test(t);

const server = await serve({ port: PORTA, ebs: EBS });
const browser = await chromium.launch();
const falhas = [];

for (const view of VIEWS) {
	const page = await browser.newPage({ viewport: { width: 318, height: 496 } });
	const problemas = [];

	page.on('console', (m) => {
		if (m.type() === 'error') problemas.push(m.text());
	});
	page.on('pageerror', (e) => problemas.push(`pageerror: ${e.message}`));

	await page.route('https://extension-files.twitch.tv/**', (r) =>
		r.fulfill({
			status: 200,
			contentType: 'text/javascript',
			body: `window.Twitch = { ext: {
				onAuthorized: (fn) => fn({ token: 'stub', channelId: '1', userId: 'u1' }),
				onContext: () => {}, listen: () => {}, unlisten: () => {},
				actions: { requestIdShare: () => {} },
				bits: { getProducts: () => Promise.resolve([]) }
			} };`
		})
	);

	await page.route('**/api/v1/**', (r) =>
		r.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
	);

	await page.goto(`http://localhost:${PORTA}/${view}/`, { waitUntil: 'networkidle' });

	// Sem hidratação a página é HTML morto: a extensão carrega mas nada funciona.
	// O sinal é o cliente ter montado, não haver texto: o overlay renderiza vazio
	// de propósito quando não há guerra, e isso é o comportamento correto.
	const hidratou = await page.evaluate(() => {
		const raiz = document.getElementById('svelte-root');
		const bootou = Object.keys(window).some((k) => k.startsWith('__sveltekit_'));
		return bootou && !!raiz && raiz.childNodes.length > 0;
	});

	const csp = problemas.filter(ehViolacaoCsp);
	if (csp.length) falhas.push(`${view}: CSP bloqueou\n    ${csp.join('\n    ')}`);
	else if (problemas.length) falhas.push(`${view}: erro no console\n    ${problemas.join('\n    ')}`);
	else if (!hidratou) falhas.push(`${view}: carregou sem hidratar`);
	else console.log(`  ok  ${view}.html`);

	await page.close();
}

await browser.close();
server.close();

if (falhas.length) {
	console.error('\nCSP falhou:\n' + falhas.map((f) => '  ' + f).join('\n'));
	process.exit(1);
}
console.log(`\n${VIEWS.length} views carregam sob a CSP da Twitch.`);
