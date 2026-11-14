#!/usr/bin/env node
// Inlines vendor + src scripts into one self-contained HTML file: dist/stickman-studio.html
const fs = require('fs');
const path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<script>/* ' + src + ' */\n' + code + '\n</script>';
});
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'stickman-studio.html'), html);
console.log('dist/stickman-studio.html', (html.length / 1024).toFixed(0) + ' KB');
