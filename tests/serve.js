// Minimal static file server for the end-to-end tests (`npm run serve` to use it by hand).
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

function start(port = 0) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.normalize(path.join(root, p));
    if (!file.startsWith(root) || file.includes(`${path.sep}node_modules${path.sep}`)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(port, '127.0.0.1', () => resolve(server)));
}

module.exports = { start };
if (require.main === module) {
  start(+process.argv[2] || 8000).then(s => console.log(`Serving on http://127.0.0.1:${s.address().port}/`));
}
