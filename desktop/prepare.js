// Copies the published page into app/ for the desktop build, with three.js served locally instead of from the CDN,
// so the game runs offline. The page itself is unchanged: no ROM data, the player still loads their own.
const fs = require('fs'), path = require('path');
const out = path.join(__dirname, 'app');
fs.mkdirSync(out, { recursive: true });
let html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const cdn = /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/three\.js\/r128\/three\.min\.js"[^>]*><\/script>/;
if (!cdn.test(html)) throw new Error('index.html no longer loads three.js r128 from cdnjs: update desktop/prepare.js');
html = html.replace(cdn, '<script src="three.min.js"></script>');
// (the page relies on the server's UTF-8 header; a local file needs it said)
if (!/<meta charset/i.test(html)) html = '<!doctype html>\n<meta charset="utf-8">\n' + html;
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.copyFileSync(require.resolve('three/build/three.min.js'), path.join(out, 'three.min.js'));
console.log('desktop/app ready');
