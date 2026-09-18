// SJ 메신저 PWA 실검 — 헤드리스 크롬으로 "진짜 되는지"를 본다.
//   node test/pwa-live-check.mjs
// 정적 서버(python -m http.server)는 알아서 띄우고 끈다. 이미 떠 있으면 그걸 쓴다.
// 환경변수: CHROME=크롬경로  PORT=8098
//
// 확인하는 것 (W1):
//   설치 조건(매니페스트 오류 0) · 서비스워커 활성 · 껍데기+SDK 캐시 · 데이터 API 는 캐시 안 함
//   비행기 모드에서 재열림 · 앱으로 열면 로그인 관문 · 플랫폼 iframe 안에서는 관문 없음
// 폰 실물(홈 화면 설치·iOS 동작)은 이걸로 대신할 수 없다 — 사람이 한 번 봐야 한다.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8098);
const 기준 = `http://127.0.0.1:${PORT}`;
const 메신저URL = `${기준}/modules/messenger/messenger.html`;
const 시험대URL = `${기준}/test/w1-iframe-harness.html`;
const 디버그포트 = Number(process.env.CDP_PORT || 9333);

const 크롬후보 = [
  process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);
const CHROME = 크롬후보.find((p) => existsSync(p));
if (!CHROME) { console.error('크롬을 못 찾았다. CHROME=경로 로 알려줄 것.'); process.exit(2); }

const 잠깐 = (ms) => new Promise((r) => setTimeout(r, ms));
const 살아있나 = async (u) => { try { return (await fetch(u)).ok; } catch (e) { return false; } };

// ── 정적 서버 ──
let 서버 = null;
if (!(await 살아있나(`${기준}/index.html`))) {
  const 파이썬 = process.platform === 'win32' ? 'python' : 'python3';
  서버 = spawn(파이썬, ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
    { cwd: 뿌리, stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await 살아있나(`${기준}/index.html`)); i++) await 잠깐(250);
}

// ── 크롬 ──
const 프로필 = mkdtempSync(join(tmpdir(), 'sjpwa-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${디버그포트}`, `--user-data-dir=${프로필}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank',
], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.n = 0; this.대기 = new Map(); ws.onmessage = (m) => this.받기(m); }
  받기(m) {
    const d = JSON.parse(m.data);
    const p = this.대기.get(d.id);
    if (p) { this.대기.delete(d.id); d.error ? p.reject(new Error(JSON.stringify(d.error))) : p.resolve(d.result); }
  }
  보내기(method, params = {}) {
    const id = ++this.n;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.대기.set(id, { resolve, reject }));
  }
  async 평가(식) {
    const r = await this.보내기('Runtime.evaluate',
      { expression: `(async()=>{${식}})()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  그물(켬) {
    return this.보내기('Network.emulateNetworkConditions', {
      offline: !켬, latency: 0,
      downloadThroughput: 켬 ? -1 : 0, uploadThroughput: 켬 ? -1 : 0,
    });
  }
}

const 결과 = [];
const 확인 = (이름, 참, 메모 = '') => { 결과.push([참 ? 'PASS' : 'FAIL', 이름, 메모]); };

try {
  let 탭 = null;
  for (let i = 0; i < 40 && !탭; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${디버그포트}/json/new?${encodeURIComponent(메신저URL)}`,
        { method: 'PUT' });
      if (r.ok) 탭 = await r.json();
    } catch (e) { await 잠깐(250); }
  }
  if (!탭) throw new Error('크롬 디버깅 포트가 안 열린다');

  const ws = new WebSocket(탭.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const cdp = new CDP(ws);
  await cdp.보내기('Page.enable');
  await cdp.보내기('Runtime.enable');
  await cdp.보내기('Network.enable');
  await 잠깐(2500); // 첫 로드 + 서비스워커 설치

  const 기본 = await cdp.평가(`
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise(r=>setTimeout(()=>r(null),8000))]);
    const keys = await caches.keys();
    let urls = [];
    if (keys.length) { const c = await caches.open(keys[0]); urls = (await c.keys()).map(r=>r.url); }
    return { sw: !!reg, state: reg&&reg.active&&reg.active.state, scope: reg&&reg.scope, keys, urls,
             gate: document.body.innerText.includes('로그인') };
  `);
  확인('서비스워커 활성', 기본.sw && 기본.state === 'activated', `${기본.scope} ${기본.state}`);
  확인('캐시 생성', 기본.keys.some((k) => k.startsWith('sj-msg-')), 기본.keys.join(','));
  확인('껍데기 캐시', ['messenger.html', 'manifest.json', 'icon-192.png']
    .every((f) => 기본.urls.some((u) => u.includes(f))), `${기본.urls.length}개`);
  확인('Firebase SDK 캐시', 기본.urls.filter((u) => u.includes('gstatic.com/firebasejs')).length === 4,
    기본.urls.filter((u) => u.includes('firebasejs')).length + '개');
  확인('데이터 API 는 캐시에 없음', !기본.urls.some((u) => u.includes('firestore.googleapis.com')));
  확인('앱으로 열면 로그인 관문', 기본.gate);

  // ── 비행기 모드 ──
  await cdp.그물(false);
  await cdp.보내기('Page.reload', { ignoreCache: false });
  await 잠깐(3000);
  const 오프 = await cdp.평가(`
    return { html: document.documentElement.outerHTML.length, title: document.title, fb: !!window.fb,
             err: document.body.innerText.includes('오류') };
  `);
  확인('비행기 모드에서 재열림', 오프.title.includes('메신저') && 오프.html > 20000 && !오프.err,
    `${오프.html}바이트`);
  확인('오프라인에서도 Firebase SDK 살아있음', 오프.fb);

  // ── 설치 조건 ──
  await cdp.그물(true);
  await cdp.보내기('Page.navigate', { url: 메신저URL });
  await 잠깐(2000);
  const mf = await cdp.보내기('Page.getAppManifest');
  확인('매니페스트 치명 오류 없음', (mf.errors || []).filter((e) => e.critical).length === 0,
    (mf.errors || []).map((e) => e.message).join(' | ') || '0건');
  확인('standalone + 192/512 아이콘',
    /"display"\s*:\s*"standalone"/.test(mf.data || '') && /192x192/.test(mf.data || '')
    && /512x512/.test(mf.data || ''));

  // ── 플랫폼 iframe 안 ──
  await cdp.보내기('Page.navigate', { url: 시험대URL });
  await 잠깐(3000);
  const 안 = await cdp.평가(`
    const f = document.getElementById('f'), d = f.contentDocument, t = d.body.innerText;
    return { 관문: t.includes('회사 계정(@sejong-21c.com)'), 화면: !!d.querySelector('.msg-ch, .side-scroll'),
             나: f.contentWindow.getCurrentUserUid && f.contentWindow.getCurrentUserUid() };
  `);
  확인('iframe 안에서는 관문 없음', !안.관문);
  확인('iframe 안에서 부모 로그인 이어받음', 안.나 === 'uid_test', String(안.나));
  확인('iframe 안에서 메신저 화면 그려짐', 안.화면);

  ws.close();
} catch (e) {
  결과.push(['FAIL', '실행', String(e.message || e)]);
} finally {
  chrome.kill();
  if (서버) 서버.kill();
  try { rmSync(프로필, { recursive: true, force: true }); } catch (e) {}
}

for (const [s, n, m] of 결과) console.log(`${s}  ${n}${m ? '  — ' + m : ''}`);
const 실패 = 결과.filter((r) => r[0] === 'FAIL').length;
console.log(`\n${결과.length - 실패}/${결과.length} 통과`);
process.exit(실패 ? 1 : 0);
