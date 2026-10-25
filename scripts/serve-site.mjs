import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {extname, relative, resolve} from 'node:path';
import {buildSite, output} from './build-site.mjs';

await buildSite();
const port = Number(process.env.PORT || 4173);
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml'};
const server = createServer(async (request, response) => {
    try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        let path = resolve(output, `.${pathname}`);
        if (relative(output, path).startsWith('..')) {response.writeHead(403).end('Forbidden');return;}
        if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
        const body = await readFile(path);
        response.writeHead(200, {'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store'}).end(body);
    } catch {response.writeHead(404).end('Not found');}
});
server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
