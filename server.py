import http.server
import socketserver
import urllib.request
import urllib.parse
import os
import sys

PORT = 8080
DIRECTORY = r'D:\DEV\Antigravity\Flob_labs\technocore-explorer'

class TechnocoreProxyHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def do_GET(self):
        if self.path.startswith('/api/r/'):
            room_and_query = self.path[len('/api/r/'):]
            sep = '&' if '?' in room_and_query else '?'
            target_url = f'https://technocore.chat/r/{room_and_query}{sep}format=json'
            try:
                req = urllib.request.Request(
                    target_url,
                    headers={
                        'User-Agent': 'technocore-did-starter/1.0.0',
                        'Accept': 'application/json'
                    }
                )
                with urllib.request.urlopen(req, timeout=10.0) as resp:
                    data = resp.read()
                    self.send_response(resp.status)
                    self.send_header('Content-Type', 'application/json')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
            except Exception as e:
                err_msg = ('{\"error\": \"' + str(e) + '\"}').encode('utf-8')
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Content-Length', str(len(err_msg)))
                self.end_headers()
                self.wfile.write(err_msg)
        else:
            super().do_GET()

if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', PORT), TechnocoreProxyHandler) as httpd:
        print(f'Serving Technocore Explorer on http://localhost:{PORT}')
        httpd.serve_forever()