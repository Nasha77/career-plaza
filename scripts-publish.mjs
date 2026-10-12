// Builds one self-contained HTML file (CSS and JS inlined) for publishing as a single page.
import { build } from 'vite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

await build({ logLevel: 'warn', build: { outDir: 'dist-single', rollupOptions: { output: { inlineDynamicImports: true } } } });
const dir = 'dist-single/assets/';
const files = readdirSync(dir);
const css = readFileSync(dir + files.find((f) => f.endsWith('.css')), 'utf8');
const js = readFileSync(dir + files.find((f) => f.endsWith('.js')), 'utf8').replace(/<\/script/gi, '<\/script');
const html = readFileSync('dist-single/index.html', 'utf8');
const fonts = html.match(/<link href="https:\/\/fonts\.googleapis[^>]+>/)[0];
const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
const out = `<title>Career Plaza</title>
<meta name="description" content="Try four workplaces for a few minutes each and see what you used, enjoyed and could try next." />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
${fonts}
<style>${css}</style>
${body.trim()}
<script>document.body.dataset.screen = 'title';</script>
<script type="module">${js}</script>
`;
writeFileSync('dist-single/career-plaza.html', out);
console.log('wrote dist-single/career-plaza.html', (out.length / 1024).toFixed(0) + ' KB');
