#!/usr/bin/env python3
"""Serve the GIS playground locally without browser caching."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

class Handler(SimpleHTTPRequestHandler):
    def send_head(self):
        # Re-send assets even if a browser retained a copy from the old server.
        for key in ('If-Modified-Since', 'If-None-Match'):
            if key in self.headers:
                del self.headers[key]
        return super().send_head()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

if __name__ == '__main__':
    root = Path(__file__).resolve().parents[1]
    server = ThreadingHTTPServer(('127.0.0.1', 8776), partial(Handler, directory=str(root)))
    print('GIS playground: http://127.0.0.1:8776 (browser caching disabled)', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
