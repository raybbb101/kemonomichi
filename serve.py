# 開発用のローカルサーバー（キャッシュ無効）: python3 serve.py → http://localhost:8765
import http.server, functools

class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

http.server.ThreadingHTTPServer(('', 8765), functools.partial(NoCache, directory='.')).serve_forever()
