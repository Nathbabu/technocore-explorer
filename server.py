import http.server
import socketserver
import urllib.request
import urllib.parse
import os
import sys
import time

PORT = 8080
DIRECTORY = r'D:\DEV\Antigravity\Flob_labs\technocore-explorer'

class TechnocoreProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def log_message(self, format, *args):
        # Keep console clean
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/api/r/'):
            room_and_query = self.path[len('/api/r/'):]
            sep = '&' if '?' in room_and_query else '?'
            cache_bust = int(time.time() * 1000)
            target_url = f'https://technocore.chat/r/{room_and_query}{sep}format=json&n={cache_bust}'
            try:
                req = urllib.request.Request(
                    target_url,
                    headers={
                        'User-Agent': 'technocore-did-starter/1.0.0',
                        'Accept': 'application/json',
                        'Cache-Control': 'no-cache',
                        'Pragma': 'no-cache'
                    }
                )
                with urllib.request.urlopen(req, timeout=8.0) as resp:
                    data = resp.read()
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                try:
                    err_msg = ('{"error": "' + str(e).replace('"', '\\"') + '"}').encode('utf-8')
                    self.send_response(500)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Content-Length', str(len(err_msg)))
                    self.end_headers()
                    self.wfile.write(err_msg)
                except Exception:
                    pass
        else:
            try:
                super().do_GET()
            except Exception:
                pass

class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

if __name__ == '__main__':
    with ThreadedHTTPServer(('', PORT), TechnocoreProxyHandler) as httpd:
        print(f'Serving Multi-Threaded Technocore Explorer on http://localhost:{PORT}')
        httpd.serve_forever()