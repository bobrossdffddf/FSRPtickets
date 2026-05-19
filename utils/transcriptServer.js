/**
 * Lightweight HTTP server that serves generated transcript HTML files.
 *
 * Configure `transcriptServer.port` and `transcriptServer.publicUrl` in config.json.
 * If publicUrl is left as "http://localhost:3000" the "View Transcript" button
 * won't appear in Discord (it wouldn't be reachable), but the file attachment
 * still works as a fallback.
 *
 * To expose publicly, either:
 *   • Set a real domain/IP in config.json  ("https://tickets.yourdomain.com")
 *   • Or use a tunnel like ngrok during development
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const cfg            = require('../config.json');
const TRANSCRIPT_DIR = path.join(__dirname, '../data/transcripts');

let _server = null;

function start() {
    const port = cfg.transcriptServer?.port ?? 3000;

    _server = http.createServer((req, res) => {
        // Only allow /transcripts/<filename>.html  —  no path traversal
        const match = req.url.match(/^\/transcripts\/([^/]+\.html)$/);
        if (!match) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Not found');
        }

        const filename = match[1];                       // already validated: no slashes
        const filepath = path.join(TRANSCRIPT_DIR, filename);

        if (!fs.existsSync(filepath)) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end('Transcript not found');
        }

        res.writeHead(200, {
            'Content-Type':  'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
        });
        fs.createReadStream(filepath).pipe(res);
    });

    _server.listen(port, () => {
        console.log(`[Transcripts] HTTP server listening on port ${port}`);
        const pub = cfg.transcriptServer?.publicUrl ?? `http://localhost:${port}`;
        if (pub.includes('localhost')) {
            console.log('[Transcripts] publicUrl is localhost — transcript links will only be sent as file attachments.');
            console.log('[Transcripts] Set transcriptServer.publicUrl in config.json to enable hosted links.');
        }
    });

    _server.on('error', err => {
        console.error('[Transcripts] Server error:', err.message);
    });

    return _server;
}

/**
 * Returns the full public URL for a given transcript filename.
 * @param {string} filename  e.g. "transcript-gen-username-0001-1234567890.html"
 * @returns {string}
 */
function getTranscriptUrl(filename) {
    const base = (cfg.transcriptServer?.publicUrl ?? `http://localhost:${cfg.transcriptServer?.port ?? 3000}`)
        .replace(/\/$/, '');   // strip trailing slash
    return `${base}/transcripts/${filename}`;
}

module.exports = { start, getTranscriptUrl };
