// SJ 메신저 W2 화면 실검 — 가짜 Firestore 시험대(test/messenger-harness.html)를 헤드리스 크롬에 띄워
// 폰(375×812)·데스크톱(1280×800) 시나리오를 돌고 PASS/FAIL/MEMO 를 찍는다. pwa-live-check.mjs 의 골격 그대로.
//   node test/messenger-ui-check.mjs
// 정적 서버(python -m http.server)는 알아서 띄우고 끈다. 이미 떠 있으면 그걸 쓴다.
// 환경변수: CHROME=크롬경로  PORT=8098  BASE=주소(시험대가 같은 오리진에 있어야 함)
//           SHOTS=스크린샷 폴더(기본 test/shots — .gitignore)  CDP_PORT=9334
// 인터넷 필요: Firebase SDK 모듈은 gstatic 에서 받는다(데이터는 전부 부모의 가짜 fb — fake.writes 에 남는다).
// FAIL 이 나면 메모(셀렉터·기대·실제)로 (a) 시험대·시드 문제인지 (b) 메신저 코드 문제인지 가른다. MEMO 는 미구현 표시(실패 아님).
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const 뿌리 = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8098);
const 기준 = (process.env.BASE || `http://127.0.0.1:${PORT}`).replace(/\/$/, '');
const 시험대URL = `${기준}/test/messenger-harness.html`;
const 디버그포트 = Number(process.env.CDP_PORT || 9334);
const SHOTS = process.env.SHOTS || join(뿌리, 'test', 'shots');

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
if (!process.env.BASE && !(await 살아있나(`${기준}/index.html`))) {
  const 파이썬 = process.platform === 'win32' ? 'python' : 'python3';
  서버 = spawn(파이썬, ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'],
    { cwd: 뿌리, stdio: 'ignore' });
  for (let i = 0; i < 40 && !(await 살아있나(`${기준}/index.html`)); i++) await 잠깐(250);
}

// ── 크롬 ──
const 프로필 = mkdtempSync(join(tmpdir(), 'sjmsg-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${디버그포트}`, `--user-data-dir=${프로필}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--hide-scrollbars', 'about:blank',
], { stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.n = 0; this.대기 = new Map(); this.사건 = []; ws.onmessage = (m) => this.받기(m); }
  받기(m) {
    const d = JSON.parse(m.data);
    if (d.method) { this.사건.push(d); return; }          // 이벤트(예외·콘솔·load)는 모아 두고 끝에 본다
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
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
}

const 결과 = [];
const 확인 = (이름, 참, 메모 = '') => { 결과.push([참 ? 'PASS' : 'FAIL', 이름, 메모]); };
const 메모 = (이름, 글) => { 결과.push(['MEMO', 이름, 글]); };
const 오염 = new Set();   // 본문에 새어 나온 undefined / NaN / pu_

try {
  mkdirSync(SHOTS, { recursive: true });
  let 탭 = null;
  for (let i = 0; i < 40 && !탭; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${디버그포트}/json/new?about:blank`, { method: 'PUT' });
      if (r.ok) 탭 = await r.json();
    } catch (e) { await 잠깐(250); }
  }
  if (!탭) throw new Error('크롬 디버깅 포트가 안 열린다');

  const ws = new WebSocket(탭.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const cdp = new CDP(ws);
  await cdp.보내기('Page.enable');
  await cdp.보내기('Runtime.enable');                                     // 같은 오리진 iframe 의 예외·콘솔도 여기로 온다
  await cdp.보내기('Emulation.setFocusEmulationEnabled', { enabled: true });   // 헤드리스에서 focus()/키 입력이 먹게

  // ── iframe 안을 다루는 도우미 ──
  const 앞 = `const f=document.getElementById('f'), d=f.contentDocument, w=f.contentWindow,
    $=(s,r=d)=>r.querySelector(s), $$=(s,r=d)=>Array.from(r.querySelectorAll(s)), txt=(s)=>{const e=$(s);return e?e.textContent.trim():null};`;
  const 안 = (식) => cdp.평가(앞 + 식);
  const 기다리기 = async (식, ms = 3000) => {
    const 끝 = Date.now() + ms;
    while (Date.now() < 끝) { try { if (await 안(식)) return true; } catch (e) { /* 아직 문서가 없다 */ } await 잠깐(100); }
    return false;
  };
  const 클릭 = async (sel, ms = 400) => {
    const ok = await 안(`const el=$(${JSON.stringify(sel)}); if(!el) return false; el.click(); return true;`);
    await 잠깐(ms);
    return ok;
  };
  // 진짜 타이핑(CDP Input.insertText). 안 먹으면 value 로 넣고 MEMO 로 남긴다 — 검사는 이어 간다.
  const 치기 = async (sel, text, ms = 350) => {
    const 초점 = await 안(`const el=$(${JSON.stringify(sel)}); if(!el) return false; el.focus(); return d.activeElement===el;`);
    if (!초점) return false;
    await cdp.보내기('Input.insertText', { text });
    await 잠깐(80);
    const 들어감 = await 안(`return $(${JSON.stringify(sel)}).value.endsWith(${JSON.stringify(text)});`);
    if (!들어감) {
      메모(`입력 ${sel}`, 'Input.insertText 가 iframe 입력창에 안 들어가 value 로 대신 넣었다');
      await 안(`const el=$(${JSON.stringify(sel)}); el.value+=${JSON.stringify(text)}; el.dispatchEvent(new Event('input',{bubbles:true})); return true;`);
    }
    await 잠깐(ms);
    return true;
  };
  const 지우기 = (sel) => 안(`const el=$(${JSON.stringify(sel)}); if(!el) return false; el.value=''; el.dispatchEvent(new Event('input',{bubbles:true})); return true;`);
  const 엔터 = async () => {
    for (const type of ['keyDown', 'keyUp']) {
      await cdp.보내기('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    }
  };
  const 찍기 = async (name) => {
    const r = await cdp.보내기('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  const 본문수집 = async () => { for (const k of await 안(`const t=d.body.innerText; return ['undefined','NaN','pu_'].filter(k=>t.includes(k));`)) 오염.add(k); };
  const 열기 = async (폭, 높이, 폰) => {
    await cdp.보내기('Emulation.setDeviceMetricsOverride', { width: 폭, height: 높이, deviceScaleFactor: 폰 ? 2 : 1, mobile: 폰 });
    const 사건수 = cdp.사건.length;
    await cdp.보내기('Page.navigate', { url: 시험대URL });
    for (let i = 0; i < 300 && !cdp.사건.slice(사건수).some((e) => e.method === 'Page.loadEventFired'); i++) await 잠깐(100);
    const 떴다 = await 기다리기(`return !!(w.SJM && $('.sjm'));`, 20000);   // 첫 로드는 gstatic SDK 다운로드 포함
    const t0 = Date.now();
    const 목록 = await 기다리기(`return $$('.sjm-chat').length > 0;`, 3000);
    const 목록ms = Date.now() - t0;
    const 자료 = await 기다리기(`return !!$('.sjm-chat[data-cid="g1"]');`, 3000);   // 가짜 fb 스냅샷이 도착해 g1 줄이 그려질 때까지
    return { 떴다, 목록, 목록ms, 자료 };
  };

  // ═══════════════════════ ① 375×812 (폰) ═══════════════════════
  const 부팅 = await 열기(375, 812, true);
  확인('375 부팅: 메신저 모듈 살아남(SJM)', 부팅.떴다);
  const 기본 = await 안(`return { layout: $('.sjm')?.dataset.layout, tabs: $$('.sjm-tabbar [data-tab]').length,
    관문: d.body.innerText.includes('회사 계정(@sejong-21c.com)'), me: w.SJM && w.SJM.me() };`);
  확인('375 루트 .sjm[data-layout="phone"]', 기본.layout === 'phone', String(기본.layout));
  확인('375 하단 탭바 [data-tab] 4개', 기본.tabs === 4, `${기본.tabs}개`);
  확인('375 관문 문구 없음(iframe)', !기본.관문);
  확인('375 SJM.me() === u_kim', 기본.me === 'u_kim', String(기본.me));
  확인('375 3초 안에 .sjm-chat 1개 이상', 부팅.목록, `${부팅.목록ms}ms`);
  확인('375 가짜 fb 스냅샷 도착(g1 줄 그려짐)', 부팅.자료);

  // ② 친구 탭
  await 클릭('.sjm-tabbar [data-tab="friends"]');
  await 본문수집(); await 찍기('375-friends');
  // 숨은 화면(hidden)도 DOM 에 남아 있으므로 반드시 보이는 화면 안에서만 센다 — 검색 화면의 옛 결과가 섞여 들어온 적이 있다.
  const 친구 = await 안(`
    const F = $('.sjm-screen[data-screen="friends"]'), rows = $$('.sjm-user[data-uid]', F);
    return { n: rows.length, ㄱ: $$('.sjm-sec[data-key="ㄱ"] .sjm-user-name', F).map(e=>e.textContent.trim()),
      kangImg: !!$('.sjm-user[data-uid="u_kang_dh"] .sjm-avatar img', F), siwon: $('.sjm-user[data-uid="u_kimsw"] .sjm-avatar', F)?.textContent.trim(),
      index: $$('.sjm-index [data-key]', F).length, 부서: !!$('.sjm-sec[data-key="부서"]', F),
      deptRows: $$('.sjm-sec[data-key="부서"] .sjm-deptrow[data-act="open"][data-cid]', F).map(e=>e.dataset.cid) };`);
  확인('친구: 사람 줄 13(나 제외) 또는 14', 친구.n === 13 || 친구.n === 14, `${친구.n}명 · disabled 제외${친구.n === 13 ? ' · 나 제외' : 친구.n === 14 ? ' · 나 포함' : ''}`);
  확인('친구: ㄱ 섹션에 김·강 4명 이상', 친구.ㄱ.filter((s) => /^[김강]/.test(s)).length >= 4, 친구.ㄱ.join(','));
  확인('친구: 색인 레일 .sjm-index [data-key]', 친구.index > 0, `${친구.index}칸`);
  확인('친구: 강대헌 아바타 사진 img (t_userProfile)', 친구.kangImg, 친구.kangImg ? '' : '.sjm-user[data-uid="u_kang_dh"] .sjm-avatar img 없음 — 코드가 t_userProfile 대신 t_userPhotos 를 읽는지 볼 것');
  확인('친구: 김시원 아바타 이니셜 "시원"', 친구.siwon === '시원', String(친구.siwon));
  if (친구.부서) 확인('친구: 부서 섹션에 dept_quality 줄', 친구.deptRows.includes('dept_quality'), 친구.deptRows.join(','));
  else 메모('친구: 부서 섹션 .sjm-sec[data-key="부서"]', '없음 — 미구현');

  // ③ 검색
  await 클릭('[data-act="search-open"]');
  const 검색 = async (q) => { await 지우기('#searchInput'); await 치기('#searchInput', q); return 안(`return $$('.sjm-sres[data-kind="friends"] .sjm-user .sjm-user-name').map(e=>e.textContent.trim());`); };
  const 김 = await 검색('김');
  확인('검색 "김" → 김○○ 3~4명', 김.length >= 3 && 김.length <= 4 && 김.every((s) => s.startsWith('김')), 김.join(','));
  const 강 = await 검색('강');
  확인('검색 "강" → 강대헌·강문환 이 앞에', 강.slice(0, 2).sort().join(',') === '강대헌,강문환', 강.join(',') + (강.length > 2 ? ' — 뒤는 부분 일치(김강일)' : ''));
  const ㄱㅊ = await 검색('ㄱㅊ');
  if (ㄱㅊ.includes('김철우')) 확인('검색 초성 "ㄱㅊ" → 김철우', true);
  else if (ㄱㅊ.length === 0) 메모('검색 초성 "ㄱㅊ"', '0명 — 본인(김철우) 제외 규칙');
  else 확인('검색 초성 "ㄱㅊ" → 김철우', false, ㄱㅊ.join(','));
  const ㄱㅅ = await 검색('ㄱㅅ');
  확인('검색 초성 "ㄱㅅ" → 김시원(본인 아닌 사람으로 초성 확인)', ㄱㅅ.includes('김시원'), ㄱㅅ.join(','));
  await 클릭('[data-act="search-close"]');
  확인('검색 닫기 → 검색 화면 hidden', await 안(`return $('.sjm-screen[data-screen="search"]')?.hidden === true;`));

  // ④ 채팅 탭
  await 클릭('.sjm-tabbar [data-tab="chats"]');
  await 본문수집(); await 찍기('375-chats');
  const 채팅 = await 안(`
    const C = $('.sjm-screen[data-screen="chats"]'), rows = $$('.sjm-chat[data-cid]', C), cids = rows.map(r=>r.dataset.cid), g1 = $('.sjm-chat[data-cid="g1"]', C);
    const empties = rows.filter(r => !r.querySelector('.sjm-chat-last')?.textContent.trim() || !r.querySelector('.sjm-chat-time')?.textContent.trim()).map(r=>r.dataset.cid);
    return { cids, first: cids[0], g1pin: !!g1?.querySelector('.sjm-pin'), g1badge: g1?.querySelector('.sjm-badge')?.textContent.trim(), empties,
      p1time: $('.sjm-chat[data-cid="proj_p1"] .sjm-chat-time', C)?.textContent.trim(), chips: $$('.sjm-chips .sjm-chip[data-act="chip"][data-chip]', C).map(e=>e.dataset.chip),
      opened: [...(w.SJM.ui?.opened || [])], readDocs: [...(w.SJM.state.readDocs || [])] };`);
  확인('채팅: dept_quality(내 부서) 있음', 채팅.cids.includes('dept_quality'), 채팅.cids.join(','));
  const 남의부서 = 채팅.cids.filter((c) => c.startsWith('dept_') && c !== 'dept_quality');
  확인('채팅: 내 부서 외 부서 방 없음(임원 아님)', 남의부서.length === 0, 남의부서.length ? `보임 ${남의부서} · opened[${채팅.opened}] · readDocs[${채팅.readDocs}]` : '');
  확인('채팅: dept_sales(남의 부서) 없음', !채팅.cids.includes('dept_sales'));
  확인('채팅: qa-calibration-alert(system) 없음', !채팅.cids.includes('qa-calibration-alert'));
  확인('채팅: proj_p2(메시지·고정·읽음문서 없음) 없음', !채팅.cids.includes('proj_p2'),
    채팅.cids.includes('proj_p2') ? '보임 — 코드가 아직 "members 에 내가 있으면 보임" 규칙(p2 pm=u_kim)' : '');
  확인('채팅: proj_p1(메시지 있음) 있음', 채팅.cids.includes('proj_p1'));
  확인('채팅: 첫 줄 g1(고정) + .sjm-pin', 채팅.first === 'g1' && 채팅.g1pin, `첫 줄 ${채팅.first} · pin ${채팅.g1pin}`);
  확인('채팅: g1 .sjm-badge "2"', 채팅.g1badge === '2', String(채팅.g1badge));
  확인('채팅: 모든 줄에 마지막 말·시각 있음', 채팅.empties.length === 0, 채팅.empties.length ? '빈 줄: ' + 채팅.empties.join(',') : `${채팅.cids.length}줄`);
  확인('채팅: 2024년만 있는 방(proj_p1) 시각 "2024. " 시작', String(채팅.p1time).startsWith('2024. '), String(채팅.p1time));
  if (채팅.chips.length) 확인('채팅: 필터 칩 all/dept/project/personal', ['all', 'dept', 'project', 'personal'].every((c) => 채팅.chips.includes(c)), 채팅.chips.join(','));
  else 메모('채팅: 필터 칩 .sjm-chips', `없음 — 방 ${채팅.cids.length}개(8개 미만이면 없어도 됨)`);

  // ⑤ 방 g1
  const 스크롤전 = await 안(`const el=$('.sjm-screen[data-screen="chats"]'); el.scrollTop=200; return el.scrollTop;`);
  const g1수 = await 안(`return fake.all('messages').filter(m=>m.channel==='g1' && typeof m.createdAt==='number').length;`);
  await 클릭('.sjm-screen[data-screen="chats"] .sjm-chat[data-cid="g1"]', 600);
  await 본문수집(); await 찍기('375-room');
  const 방 = await 안(`
    const first = (tag) => { const el = $('#roomBody .sjm-msg[data-mid$="_'+tag+'"]'); return el ? el.classList.contains('is-first') : null; };
    const ws = fake.writes.filter(x => x.op==='set' && x.col==='channelReads' && x.id==='g1_u_kim');
    return { open: !!$('.sjm-room[data-cid="g1"].is-open'), n: $$('#roomBody .sjm-msg').length, days: $$('#roomBody .sjm-day').length,
      me: $$('#roomBody .sjm-msg.is-me').length, you: $$('#roomBody .sjm-msg:not(.is-me)').length, sys: $$('#roomBody .sjm-msg.is-system').length,
      grp: [first('grp1'), first('grp2'), first('grp3')], readWrite: ws.length, readData: ws[0]?.data || null };`);
  확인('방 g1: .sjm-room[data-cid="g1"].is-open', 방.open);
  확인(`방 g1: 말풍선 수 == g1 메시지 수(${g1수})`, 방.n === g1수, `${방.n}개`);
  확인('방 g1: 날짜선 .sjm-day 1개 이상', 방.days >= 1, `${방.days}개`);
  확인('방 g1: 내 말풍선·상대 말풍선 둘 다', 방.me > 0 && 방.you > 0, `나 ${방.me} · 상대 ${방.you}`);
  확인('방 g1: 같은 분 연속 3건 중 첫 것만 .is-first', 방.grp[0] === true && 방.grp[1] === false && 방.grp[2] === false, JSON.stringify(방.grp));
  확인('방 g1: 시스템 캡슐 .sjm-msg.is-system', 방.sys >= 1, `${방.sys}개`);
  확인('방 g1: 읽음 처리 setDoc channelReads/g1_u_kim (부모 fb 로 씀)',
    방.readWrite >= 1 && 방.readData?.channel === 'g1' && 방.readData?.uid === 'u_kim' && typeof 방.readData?.lastRead === 'number', JSON.stringify(방.readData));
  await 클릭('[data-act="back"]');
  const 뒤 = await 안(`const el=$('.sjm-screen[data-screen="chats"]'); return { open: !!$('.sjm-room.is-open'), scroll: el.scrollTop, hidden: el.hidden };`);
  확인('방 g1: ‹ 뒤로 → .sjm-room.is-open 사라짐', !뒤.open);
  확인('방 g1: 돌아오면 채팅 목록 스크롤 유지', 뒤.scroll === 스크롤전 && !뒤.hidden, 스크롤전 ? `${스크롤전}px 유지` : '목록이 짧아 스크롤 0 — 자명');

  // ⑥ dm1 — 내 마지막 말풍선의 '1'
  await 클릭('.sjm-screen[data-screen="chats"] .sjm-chat[data-cid="dm1"]', 600);
  const dm = await 안(`const mine = $$('#roomBody .sjm-msg.is-me'), last = mine[mine.length-1];
    return { open: !!$('.sjm-room[data-cid="dm1"].is-open'), n: mine.length, unread: last?.querySelector('.sjm-msg-unread')?.textContent.trim(), roomReads: JSON.stringify(w.SJM.state.roomReads) };`);
  확인('방 dm1: 열림', dm.open);
  확인('방 dm1: 내 마지막 말풍선 .sjm-msg-unread "1"', dm.unread === '1', `실제 "${dm.unread}" · roomReads ${dm.roomReads}`);

  // ⑦ 전송(폰 = 버튼)
  const 입력됨 = await 치기('#msgInput', '시험 메시지');
  확인('전송: #msgInput 포커스·입력', 입력됨 && await 안(`return $('#msgInput').value === '시험 메시지';`));
  await 클릭('[data-act="send"]', 600);
  const 전송 = await 안(`
    const ws = fake.writes.filter(x => x.col==='messages' && x.op==='set'), last = ws[ws.length-1] || null;
    const ch = fake.writes.filter(x => x.col==='channels' && (x.op==='set'||x.op==='update') && x.data && 'lastText' in x.data);
    return { last, mine: $$('#roomBody .sjm-msg.is-me').length, pending: $$('#roomBody .sjm-msg.is-pending').length, chWrites: ch.length };`);
  const p = 전송.last?.data || {};
  확인('전송: messages setDoc — id msg_<clientId> · author u_kim · type text · channel dm1 · createdAt 숫자',
    !!전송.last && 전송.last.id.startsWith('msg_') && p.author === 'u_kim' && p.type === 'text' && !!p.clientId && 전송.last.id === 'msg_' + p.clientId
      && p.channel === 'dm1' && p.text === '시험 메시지' && typeof p.createdAt === 'number',
    JSON.stringify(전송.last ? { id: 전송.last.id, ...p } : null));
  확인('전송: 내 말풍선 1개 늘고 전송 중 표시 없음', 전송.mine === dm.n + 1 && 전송.pending === 0, `${dm.n} → ${전송.mine} · pending ${전송.pending}`);
  if (전송.chWrites) 확인('전송: channels.lastText 갱신', true, `${전송.chWrites}건`);
  else 메모('전송: channels.lastText 갱신', '없음 — 미구현(목록은 메시지 창 500건에서 계산)');

  // ⑧ 방 안 검색(g1 에 '도면' 3건)
  await 클릭('[data-act="back"]');
  await 클릭('.sjm-screen[data-screen="chats"] .sjm-chat[data-cid="g1"]', 500);
  await 클릭('[data-act="room-search"]');
  await 치기('#roomSearchInput', '도면');
  const rs = await 안(`return { marks: $$('#roomBody mark.sjm-mark').length, count: txt('.sjm-rs-count'), cur: $$('#roomBody mark.sjm-mark.is-current').length };`);
  확인('방 검색 "도면": mark.sjm-mark 1개 이상', rs.marks >= 1, `${rs.marks}개 · 현재 ${rs.cur}`);
  확인('방 검색: .sjm-rs-count n/m', /^\d+\/\d+$/.test(rs.count || ''), String(rs.count));
  await 클릭('[data-act="rs-close"]');
  const 닫힘 = await 안(`return { marks: $$('#roomBody mark.sjm-mark').length, searching: $('.sjm-room').classList.contains('is-searching') };`);
  확인('방 검색 닫기 → .is-searching 해제', !닫힘.searching);
  확인('방 검색 닫기 → mark.sjm-mark 없음', 닫힘.marks === 0, 닫힘.marks ? `${닫힘.marks}개 남음 — rs-close 가 renderMessages(강제=false) 로 가서 같은 id 면 다시 안 그린다` : '');

  // ⑨ 프로젝트 탭
  await 클릭('.sjm-tabbar [data-tab="projects"]');
  await 본문수집(); await 찍기('375-projects');
  const 프 = await 안(`const P = $('.sjm-screen[data-screen="projects"]'); return { pids: $$('.sjm-proj[data-pid]', P).map(e=>e.dataset.pid), groups: $$('.sjm-proj-group[data-status]', P).map(e=>e.dataset.status) };`);
  확인('프로젝트: 카드 3개(p4 숨김 제외)', 프.pids.length === 3 && !프.pids.includes('p4'), 프.pids.join(','));
  확인('프로젝트: 그룹 순서 active → pre-close → done', 프.groups.join(',') === 'active,pre-close,done', 프.groups.join(','));
  await 클릭('.sjm-proj[data-pid="p1"]');
  const 프1 = await 안(`return { rooms: $$('.sjm-proj-rooms .sjm-chat[data-cid]').map(e=>e.dataset.cid), add: !!$('.sjm-proj-rooms [data-act="proj-new-room"][data-pid="p1"]') };`);
  확인('프로젝트 p1: 방 목록에 proj_p1 + g2', 프1.rooms.includes('proj_p1') && 프1.rooms.includes('g2'), 프1.rooms.join(','));
  확인('프로젝트 p1: [data-act="proj-new-room"]', 프1.add);

  // ⑩ 나 탭
  await 클릭('.sjm-tabbar [data-tab="me"]');
  await 본문수집(); await 찍기('375-me');
  const 나 = await 안(`return { xl: !!$('.sjm-profile .sjm-avatar.is-xl'), name: !!$('.sjm-profile')?.textContent.includes('김철우'), photo: !!$('#photoInput'), ver: txt('.sjm-version'), logout: !!$('[data-act="logout"]') };`);
  확인('나: 큰 아바타 .sjm-profile .sjm-avatar.is-xl', 나.xl);
  확인('나: 이름 김철우', 나.name);
  확인('나: #photoInput 존재', 나.photo);
  확인('나: .sjm-version 표시', !!나.ver, String(나.ver));
  확인('나: iframe 에서는 [data-act="logout"] 없음', !나.logout);

  // ═══════════════════════ ⑪ 1280×800 (데스크톱) ═══════════════════════
  const 데스크 = await 열기(1280, 800, false);
  확인('1280 부팅(SJM + g1 줄)', 데스크.떴다 && 데스크.자료);
  const dk = await 안(`const tb = $('.sjm-tabbar'), empty = $('.sjm-room-empty');
    return { layout: $('.sjm')?.dataset.layout, rail: $$('.sjm-rail [data-tab]').length, tabbar: tb && w.getComputedStyle(tb).display,
      empty: empty && w.getComputedStyle(empty).display, emptyW: empty ? empty.getBoundingClientRect().width : 0, roomOpen: !!$('.sjm-room.is-open') };`);
  확인('1280 루트 .sjm[data-layout="desk"]', dk.layout === 'desk', String(dk.layout));
  확인('1280 레일 .sjm-rail [data-tab] 4개', dk.rail === 4, `${dk.rail}개`);
  확인('1280 하단 탭바 display:none', dk.tabbar === 'none', String(dk.tabbar));
  확인('1280 방 안 고름 → .sjm-room-empty 보임(flex)', dk.empty === 'flex' && dk.emptyW > 0 && !dk.roomOpen, `${dk.empty} ${Math.round(dk.emptyW)}px`);
  for (const t of ['friends', 'chats', 'projects', 'me']) { await 클릭(`.sjm-rail [data-tab="${t}"]`); await 본문수집(); await 찍기(`1280-${t}`); }
  await 클릭('.sjm-rail [data-tab="chats"]');
  const 전 = await 안(`return fake.writes.filter(x=>x.col==='messages'&&x.op==='set').length;`);
  await 클릭('.sjm-screen[data-screen="chats"] .sjm-chat[data-cid="g1"]', 600);
  await 본문수집(); await 찍기('1280-room');
  const 폭 = await 안(`const r=$('.sjm-room.is-open'), p=$('.sjm-pane'); return { room: r ? r.getBoundingClientRect().width : 0, pane: p ? p.getBoundingClientRect().width : 0 };`);
  확인('1280 g1 열림: .sjm-room.is-open 과 .sjm-pane 둘 다 폭 > 0', 폭.room > 0 && 폭.pane > 0, `방 ${Math.round(폭.room)}px · 목록 ${Math.round(폭.pane)}px`);
  const 입력2 = await 치기('#msgInput', '데스크톱 엔터 시험');
  await 엔터(); await 잠깐(600);
  const 후 = await 안(`const ws = fake.writes.filter(x=>x.col==='messages'&&x.op==='set'), last = ws[ws.length-1];
    return { n: ws.length, last: last ? { id: last.id, ...last.data } : null, input: $('#msgInput').value };`);
  확인('1280 Enter 전송 → messages setDoc 추가(channel g1) · 입력창 비움',
    입력2 && 후.n === 전 + 1 && 후.last?.channel === 'g1' && 후.last?.text === '데스크톱 엔터 시험' && 후.input === '',
    `${전} → ${후.n} · ${JSON.stringify(후.last)} · 입력창 "${후.input}"`);

  // ═══════════════════════ ⑫ 회귀 ═══════════════════════
  const 예외 = cdp.사건.filter((e) => e.method === 'Runtime.exceptionThrown')
    .map((e) => { const x = e.params.exceptionDetails; return (x.exception && (x.exception.description || x.exception.value)) || x.text; });
  const 콘솔 = cdp.사건.filter((e) => e.method === 'Runtime.consoleAPICalled');
  const 콘솔오류 = 콘솔.filter((e) => e.params.type === 'error').map((e) => e.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  const 시드로그 = 콘솔.filter((e) => e.params.type === 'log' && String(e.params.args[0]?.value || '').startsWith('[harness] seeded'));
  확인('시험대: 콘솔에 [harness] seeded 찍힘(폭마다 1회)', 시드로그.length === 2, 시드로그.map((e) => e.params.args[0].value).join(' | '));
  확인('회귀: Runtime.exceptionThrown 0건(iframe 포함)', 예외.length === 0, 예외.length ? `${예외.length}건 · 첫 오류: ${String(예외[0]).slice(0, 220)}` : '');
  확인('회귀: 콘솔 error 0건', 콘솔오류.length === 0, 콘솔오류.length ? `${콘솔오류.length}건 · 첫 오류: ${콘솔오류[0].slice(0, 220)}` : '');
  확인('회귀: 본문에 undefined/NaN/pu_ 없음(두 폭 · 모든 탭)', 오염.size === 0, [...오염].join(','));

  ws.close();
} catch (e) {
  결과.push(['FAIL', '실행', String(e.stack || e.message || e)]);
} finally {
  chrome.kill();
  if (서버) 서버.kill();
  try { rmSync(프로필, { recursive: true, force: true }); } catch (e) { /* 크롬이 아직 잡고 있을 수 있다 */ }
}

for (const [s, n, m] of 결과) console.log(`${s.padEnd(4)}  ${n}${m ? '  — ' + m : ''}`);
const 실패 = 결과.filter((r) => r[0] === 'FAIL').length;
const 통과 = 결과.filter((r) => r[0] === 'PASS').length;
const 메모수 = 결과.filter((r) => r[0] === 'MEMO').length;
console.log(`\nPASS ${통과} / FAIL ${실패} / MEMO ${메모수}  · 스크린샷 ${SHOTS}`);
process.exit(실패 ? 1 : 0);
