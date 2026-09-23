/* 시험용 정적 서버 — 플랫폼을 내 PC 에서 연다 (2026-09-23).
 *
 * 왜 직접 쓰나: 이 저장소는 **브라우저 쪽 의존성 0** 이 원칙이다(package.json 설명).
 *   서버 하나 띄우자고 http-server 를 받을 이유가 없다. 스무 줄이면 된다.
 * 왜 필요한가: 에뮬레이터 스위치가 **localhost 일 때만** 켜진다(운영을 지키는 줄).
 *   file:// 로 열면 호스트 이름이 없어서 안 켜지고, 모듈 import 도 CORS 로 막힌다.
 *
 * `node test/serve.mjs` → http://localhost:5000/?emu=1
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const 뿌리 = fileURLToPath(new URL('..', import.meta.url));
const 포트 = Number(process.env.PORT || 5000);
const 종류 = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    let 길 = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (길.endsWith('/')) 길 += 'index.html';
    // 디렉터리 탈출 금지. 시험용이라도 `..%2f` 로 홈 디렉터리를 읽히게 두지 않는다.
    const 안전 = normalize(길).replace(/^([/\\]|\.\.[/\\])+/, '');
    const 파일 = join(뿌리, 안전);
    if (!파일.startsWith(뿌리)) { res.writeHead(403).end('nope'); return; }
    const 몸 = await readFile(파일);
    res.writeHead(200, {
      'Content-Type': 종류[extname(파일).toLowerCase()] || 'application/octet-stream',
      // 시험 중엔 캐시가 방해만 된다 — 고친 것이 바로 보여야 한다.
      'Cache-Control': 'no-store',
    }).end(몸);
  } catch (e) {
    res.writeHead(e.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain; charset=utf-8' })
      .end(e.code === 'ENOENT' ? '없는 파일: ' + req.url : String(e.message));
  }
}).listen(포트, () => {
  console.log(`정적 서버 → http://localhost:${포트}/?emu=1   (뿌리 ${뿌리})`);
  console.log('  ⚠ ?emu=1 이 없으면 **진짜 회사 Firestore** 를 본다. 화면 아래 보라색 띠로 구분한다.');
});
