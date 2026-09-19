/* SJ 메신저 W2 — 카톡 + 전화번호부 느낌으로 다시 짠 화면.
 *
 * 구조(SJ메신저/W2-UI-스펙.md):
 *   - 데이터는 그대로: channels · messages · channelReads · users (+ t_userProfile 은 사진·전화 전용)
 *   - 화면은 넷: 연락처 · 채팅 · 프로젝트(폴더) · 나. 방은 그 위에 올라오는 별도 화면.
 *   - 900px 이상(플랫폼 iframe)은 카톡 PC 처럼 레일 + 목록 + 방 세 칸.
 *   - 부분 렌더: 스냅샷이 와도 보이는 영역만 다시 그린다. 방은 새 메시지만 뒤에 붙인다.
 *   - 인라인 onclick 없음. 모든 동작은 data-act 위임 하나로. 그래서 ES 모듈이 된다.
 *
 * 부모(index.html) 안에서 열리면 부모의 fb·state 를 빌려 쓰고, 홈 화면 앱으로 열리면 자기 fb 로 로그인부터 한다.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, onSnapshot, query, where, orderBy, limit,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
// ?v= 를 꼭 붙인다. 안 붙이면 messenger.js 만 새로 받고 lib.js·ai.js 는 브라우저 캐시(깃허브 페이지 10분)의
// 옛 파일이 그대로 쓰인다 — 2026-09-18 실제로 그랬다(AI 제공자 목록을 고쳤는데 옛 오류가 계속 나왔다).
// import 는 정적이라 import.meta 로 만들 수 없어 숫자를 손으로 맞춘다. 어긋나면 test/pwa-w1.test.mjs 가 잡는다.
import * as L from './lib.js?v=b45';
import { AI_CID, AI_UID, AI_컬렉션, 답하기, 사내문서 } from './ai.js?v=b45';

// ───────────────────────────── Firebase ─────────────────────────────
// W1 함정: 예전 window.fb 에 updateDoc·deleteDoc 이 없어서 홈 화면 앱에서는 나가기·삭제가 조용히 죽었다. 이제 다 넣는다.
const firebaseConfig = {
  apiKey: 'AIzaSyCmGyObjPd20Qf1MX0XAijYzSR4VitrjRg',
  authDomain: 'sejong-platform.firebaseapp.com',
  projectId: 'sejong-platform',
  storageBucket: 'sejong-platform.firebasestorage.app',
  messagingSenderId: '884301297710',
  appId: '1:884301297710:web:82b2e065119f7c5d9d87bf',
  measurementId: 'G-8LJDWYVJ5G',
};
const fbApp = initializeApp(firebaseConfig);
// 영속 캐시 — 재접속 때 바뀐 것만 받는다. 이유는 index.html 의 같은 줄 주석 참고(무료 하루 5만 읽기).
// 여기 db 는 **새 창·홈화면 앱으로 띄웠을 때만** 쓰인다(플랫폼 안에서는 getFB 가 부모 fb 를 쓴다).
const fbDb = initializeFirestore(fbApp, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
window.fb = {
  auth: getAuth(fbApp), db: fbDb, storage: getStorage(fbApp),
  onAuthStateChanged, signOut,
  doc, getDoc, setDoc, updateDoc, deleteDoc, getDocs, collection, onSnapshot, query, where, orderBy, limit,
  ref, uploadBytes, getDownloadURL,
};

// 서비스워커가 같은 출처 정적 파일을 ignoreSearch 로 맞추기 때문에, 캐시에서 온 응답의 URL 에는 ?v= 가 없다.
// 그래서 import.meta.url 만 믿으면 '나' 탭에 버전이 'dev' 로 찍힌다(실제로 그랬다). 아래 상수를 먼저 쓴다.
// 이 숫자도 캐시 버스터와 같이 올려야 한다 — test/pwa-w1.test.mjs 가 어긋나면 잡는다.
const 빌드 = 'b45';
const 버전 = new URL(import.meta.url).searchParams.get('v') || 빌드;
const 독립실행 = (window.parent === window);   // iframe 이 아니면 홈 화면 앱 또는 직접 열기
const MSG_FILE_MAX_MB = 25;
const 메시지창 = 500;                          // 부팅 때 읽는 최근 메시지 수(전체 방 합산). 이 밖의 옛 방은 창 밖이다.
const 프로필컬렉션 = 't_userProfile';           // {uid, photo(dataURL), phone, updatedAt} — users 문서를 무겁게 하지 않으려고 따로 둔다

// 부모 index.html 과 같은 부서 id 표 — 부서 방 문서 id 는 dept_<id> 다(ensureDeptChannel).
const DEPTS = [
  ['sales', '영업부'], ['design', '기술부'], ['purchase', '구매부'], ['production', '생산부'], ['quality', '품질관리부'],
  ['construction', '현장시공'], ['safety', '안전관리부'], ['general', '총무부'], ['finance', '재무부'],
  ['nuclear', '원자력사업부'], ['overseas', '해외사업부'],
];
const DEPT_ID = Object.fromEntries(DEPTS.map(([id, name]) => [name, id]));
const DEPT_NAMES = DEPTS.map(([, name]) => name);

// ───────────────────────────── 아이콘(인라인 SVG, 의존성 0) ─────────────────────────────
const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  ai: I('<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z"/><path d="M18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/>'),
  friends: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  chat: I('<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>'),
  folder: I('<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>'),
  user: I('<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  search: I('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
  plus: I('<path d="M5 12h14M12 5v14"/>'),
  back: I('<path d="m15 18-6-6 6-6"/>'),
  menu: I('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  send: I('<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>'),
  camera: I('<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>'),
  image: I('<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'),
  file: I('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>'),
  clip: I('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
  phone: I('<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>'),
  mail: I('<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>'),
  pin: I('<path d="M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'),
  trash: I('<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  copy: I('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  logout: I('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'),
  x: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  down: I('<path d="m6 9 6 6 6-6"/>'),
  up: I('<path d="m18 15-6-6-6 6"/>'),
  arrowDown: I('<path d="M12 5v14M19 12l-7 7-7-7"/>'),
  info: I('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>'),
  download: I('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>'),
  userPlus: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6M22 11h-6"/>'),
  users: I('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
  refresh: I('<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>'),
  building: I('<rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>'),
  edit: I('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
};

// ───────────────────────────── 상태 ─────────────────────────────
const state = {
  aiMsgs: [],          // AI 방 대화(t_aiChat). messages 와 섞지 않는다 — 이유는 ai.js 머리말
  me: null,            // uid
  users: [],           // users 문서 [{id, name, email, dept, title, grade, disabled}]
  pendingUsers: [],    // 부모가 갖고 있으면 복사(pu_ id 이름 풀기용)
  photos: {},          // uid → data URL (t_userProfile.photo)
  phones: {},          // uid → 전화번호 (t_userProfile.phone)
  channels: [],        // channels 문서
  projects: [],        // projects 문서
  messages: [],        // 최근 500건, createdAt 오름차순
  reads: {},           // cid → 내 lastRead(ms)
  pins: {},            // cid → true (channelReads.pinned)
  hidden: {},          // cid → 숨긴 시각(ms) — 1:1 방 "나가기" 는 숨기기다(카톡처럼 새 메시지가 오면 다시 뜬다)
  readDocs: new Set(), // 내 channelReads 문서가 있는 방(= 한 번이라도 들어가 본 방) → 목록에 영구히 남긴다
  roomReads: {},       // 열린 방: uid → lastRead(ms)  (다른 사람 읽음 — 말풍선 '1' 계산)
  pending: [],         // 전송 중/실패한 낙관적 메시지
  loaded: { messages: false, channels: false },
};
const ui = {
  layout: 'phone',     // 'phone' | 'desk'
  tab: 'chats',        // friends | chats | projects | me
  cid: null,           // 열린 방
  chip: 'all',         // 채팅 탭 필터 칩
  search: { open: false, q: '', stab: 'all' },
  rs: { open: false, q: '', hits: [], idx: 0 },   // 방 안 검색
  projOpen: {},        // pid → true (펼침)
  projCollapsed: { done: true },
  opened: new Set(),   // 이 세션에 들어가 본 방
  scroll: {},          // 화면별 스크롤 위치
  readMark: 0,         // 방 진입 시점의 내 lastRead — "여기까지 읽으셨습니다" 자리
  pushed: false,       // 독립실행에서 방 진입을 history 에 쌓았나
  uploading: false,
  suppressClick: 0,    // 길게 누르기 뒤 따라오는 click 무시
  lastReadWrite: {},   // cid → 마지막 서버 읽음 기록 시각(1초 스로틀)
};
const 구독 = { 기본: [], 방: null };
let byCh = new Map();         // cid → 메시지 오름차순
let userMap = new Map();      // uid → user
let roomDom = { cid: null, ids: [] };   // 방 본문에 그려진 메시지 id (부분 렌더 판단)

// ───────────────────────────── 공용 도우미 ─────────────────────────────
function getFB() {
  try { if (!독립실행 && window.parent && window.parent.fb) return window.parent.fb; } catch (e) { /* 크로스오리진 */ }
  return window.fb;
}
function 부모상태() { try { return (!독립실행 && window.parent && window.parent.state) || null; } catch (e) { return null; } }
// iframe 안에서 만든 객체를 부모 Firestore 에 넘기면 "custom Object" 오류가 난다 → 실제로 쓰는 fb 가 사는 realm 의 JSON 으로 다시 만든다.
// (부모에 fb 가 없어 자기 fb 를 쓸 때 부모 JSON 으로 만들면 거꾸로 같은 오류가 난다 — W1 시험대에서 잡힘)
function plain(obj) {
  try { if (getFB() !== window.fb && window.parent && window.parent.JSON) return window.parent.JSON.parse(JSON.stringify(obj)); } catch (e) { /* 무시 */ }
  return JSON.parse(JSON.stringify(obj));
}
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const me = () => state.me;
const 활성사용자 = () => state.users.filter((u) => !u.disabled && !u.pending);
function getU(id) {
  if (!id) return { id: '', name: '알 수 없음' };
  if (id === 'SYSTEM') return { id, name: '시스템', system: true };
  if (id === AI_UID) return { id, name: 'AI 비서', title: '', ai: true };
  const u = userMap.get(id);
  if (u) return u;
  if (String(id).startsWith('pu_')) {
    const p = state.pendingUsers.find((x) => 'pu_' + x.id === id || x.id === id.slice(3));
    return { id, name: p ? p.name : '대기 계정', dept: p?.dept || '', title: p?.title || '', pending: true };
  }
  return { id, name: '알 수 없음' };
}
const 나 = () => getU(me());
function 이름직급(u) { return u.title ? `${u.name} ${u.title}` : (u.name || ''); }
function 토스트(msg, ms = 2400) {
  const t = $('#toast'); if (!t) return;
  t.textContent = msg; t.classList.add('is-show');
  clearTimeout(t._tm); t._tm = setTimeout(() => t.classList.remove('is-show'), ms);
}
function nowStamp() {
  const n = new Date(), p = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}`;
}
const 새clientId = (ts) => ts + '_' + Math.random().toString(36).slice(2, 7);
function 링크달기(escapedText) {
  return escapedText.replace(/(https?:\/\/[^\s<]+)/g, (u) => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);
}

// ───────────────────────────── 아바타 ─────────────────────────────
function 아바타(u, cls = '', act = true) {
  if (!u) return `<div class="sjm-avatar ${cls}">?</div>`;
  if (u.system) return `<div class="sjm-avatar is-system ${cls}">${ICON.info}</div>`;
  if (u.ai) return `<div class="sjm-avatar is-ai ${cls}">${ICON.ai}</div>`;
  const photo = state.photos[u.id];
  const style = `style="--av:${L.아바타색(u.id || u.name || '?')}"`;
  const tap = act && u.id && !u.pending ? `data-act="user" data-uid="${esc(u.id)}"` : '';
  if (photo) return `<div class="sjm-avatar ${cls}" ${style} ${tap}><img src="${esc(photo)}" alt=""></div>`;
  return `<div class="sjm-avatar ${cls}" ${style} ${tap}>${esc(L.이니셜(u.name))}</div>`;
}
function 타일(text, key, cls = '') {
  return `<div class="sjm-avatar is-tile ${cls}" style="--av:${L.아바타색(key)}">${esc(text)}</div>`;
}
/** 여러 줄짜리 타일(프로젝트 번호). 줄 수·가장 긴 줄에 맞춰 글자 크기를 CSS 가 줄인다. */
function 타일줄(줄들, key, cls = '') {
  const 줄 = (Array.isArray(줄들) ? 줄들 : [줄들]).filter(Boolean);
  if (줄.length <= 1) return 타일(줄[0] || '프', key, cls);
  const 길이 = Math.max(...줄.map((x) => String(x).length));
  return `<div class="sjm-avatar is-tile is-two ${cls}" data-w="${길이}" style="--av:${L.아바타색(key)}">`
    + 줄.map((x) => `<span>${esc(x)}</span>`).join('') + '</div>';
}
function 방아바타(ch, cls = '') {
  if (ch.type === 'announce') return 타일('공지', 'announce', cls);
  if (ch.type === 'dept') return 타일(String(ch.name || '부서').slice(0, 2), 'dept:' + (ch.deptId || ch.name), cls);
  if (ch.type === 'project') {
    const p = state.projects.find((x) => x.id === (ch.projectId || String(ch.id).replace(/^proj_/, '')));
    // 코드 앞의 SJ·SJE 는 전부 같아서 구분이 안 된다 — 뒤 번호를 두 줄로 넣는다(lib.프로젝트약자)
    const 줄 = p && p.code ? L.프로젝트약자(p.code) : [String(ch.name || '프').slice(0, 2)];
    return 타일줄(줄, 'proj:' + ch.id, cls);
  }
  if (ch.type === 'dm') return 아바타(getU((ch.members || []).find((m) => m !== me()) || me()), cls, false);
  const others = (ch.members || []).filter((m) => m !== me()).slice(0, 4).map(getU);
  if (!others.length) return 아바타(나(), cls, false);
  if (others.length === 1) return 아바타(others[0], cls, false);
  return `<div class="sjm-avatar is-mosaic n-${others.length} ${cls}">${others.map((u) => 아바타(u, '', false)).join('')}</div>`;
}

// ───────────────────────────── 채널·메시지 계산 ─────────────────────────────
function 메시지색인() {
  byCh = new Map();
  for (const m of state.messages) {
    if (!byCh.has(m.channel)) byCh.set(m.channel, []);
    byCh.get(m.channel).push(m);
  }
}
const AI방 = () => ({ id: AI_CID, name: 'AI 비서', type: 'ai', 가상: true });
const 방메시지 = (cid) => (cid === AI_CID ? state.aiMsgs : byCh.get(cid)) || [];
function 미읽음(cid) {
  const last = state.reads[cid] || 0, my = me();
  let n = 0;
  for (const m of 방메시지(cid)) { if (m.author !== my && L.메시지시각ms(m) > last) n++; }
  return n;
}
function 미읽음합(제외cid) {
  return 채팅목록().reduce((s, r) => s + (r.ch.id === 제외cid ? 0 : r.unread), 0);
}
function 프로젝트기본방(p) {
  return state.channels.find((c) => c.id === 'proj_' + p.id || (c.type === 'project' && c.projectId === p.id))
    || { id: 'proj_' + p.id, name: p.name || p.code || '프로젝트', type: 'project', projectId: p.id, 가상: true };
}
// 부장님 지시(2026-09-19): "내가 속해 있는 프로젝트만 리스트를 띄우면 되잖아."
// **임원 예외를 없앴다(같은 날 오후, 부장님 지시)**: "임원이라도 자기 부서 아니면 대화를 못 보게 해.
// 이건 대표님도 마찬가지 — 대표님은 영업부서만." 등급이 아니라 **참여자로 적혀 있는지**만 본다.
// 대표님 계정의 users.dept 가 '영업부' 여야 이 규칙이 뜻대로 돈다(계정 쪽에서 맞춰 둘 것).
const 보이는프로젝트 = () => state.projects.filter((p) => !p.hidden && L.내프로젝트인가(p, me()));
function 프로젝트방들(p) {
  const rooms = [프로젝트기본방(p)];
  for (const c of state.channels) {
    if (c.type === 'group' && c.projectId === p.id && (c.members || []).includes(me())) rooms.push(c);
  }
  return rooms;
}
function 방멤버(ch) { return L.방멤버(ch, state.users, state.projects); }
function 방이름(ch) { return L.방이름(ch, state.users, me()); }
function 부서방(dn) {
  return state.channels.find((c) => c.type === 'dept' && c.name === dn)
    || { id: 'dept_' + (DEPT_ID[dn] || dn), name: dn, type: 'dept', deptId: DEPT_ID[dn] || null, 가상: true };
}
function 마지막활동(ch) {
  const msgs = 방메시지(ch.id);
  const last = msgs.length ? msgs[msgs.length - 1] : null;
  return { last, lastAt: last ? L.메시지시각ms(last) : (ch.lastAt || ch.createdAt || 0) };
}
const 활동있음 = (ch) => 방메시지(ch.id).length > 0 || !!ch.lastAt || state.readDocs.has(ch.id) || !!state.pins[ch.id] || ui.opened.has(ch.id);
// 채팅 탭에 보이는 방 — 공지 · 내 부서 · 내가 든 dm/group · 활동(메시지·읽음 기록·고정)이 있는 나머지.
// 임원이라도 조용한 부서 방 11개를 늘어놓지 않는다(카톡 목록엔 빈 방이 없다). 그런 방은 연락처 탭 "부서"·프로젝트 탭·검색에서 들어간다.
function 보이는방() {
  const out = new Map();
  const add = (c) => { if (c && !out.has(c.id)) out.set(c.id, c); };
  add(AI방());                                   // AI 비서는 늘 목록에 있다(카톡의 채널 자리)
  const ann = state.channels.filter((c) => c.type === 'announce');
  (ann.length ? ann : [{ id: 'c1', name: '전사 공지', type: 'announce', 가상: true }]).forEach(add);
  const myDept = 나().dept;
  if (myDept) add(부서방(myDept));
  // 남의 부서 방은 **아무도** 안 본다 — 임원도, 대표님도(부장님 지시 2026-09-19 오후).
  // 전에는 임원이 전 부서 방을 봤다. 그 줄을 지웠다.
  for (const p of 보이는프로젝트()) { const room = 프로젝트기본방(p); if (활동있음(room)) add(room); }
  for (const c of state.channels) {
    if ((c.type === 'group' || c.type === 'dm') && (c.members || []).includes(me())) {
      if (c.type === 'dm' && state.hidden[c.id] && 마지막활동(c).lastAt <= state.hidden[c.id]) continue;   // 숨긴 1:1 — 새 메시지가 와야 다시 뜬다
      add(c);
    }
  }
  for (const cid of ui.opened) { if (!out.has(cid)) add(getChannel(cid)); }
  return Array.from(out.values());
}
function 채팅목록() {
  return 보이는방().map((ch) => {
    const { last, lastAt } = 마지막활동(ch);
    return { ch, last, lastAt, unread: 미읽음(ch.id), pinned: !!state.pins[ch.id], name: 방이름(ch), preview: last ? L.미리보기(last) : (ch.lastText || '') };
  }).sort(L.채팅정렬);
}
function getChannel(cid) {
  if (!cid) return null;
  if (cid === AI_CID) return AI방();
  const c = state.channels.find((x) => x.id === cid);
  if (c) return c;
  if (cid === 'c1') return { id: 'c1', name: '전사 공지', type: 'announce', 가상: true };
  if (cid.startsWith('dept_')) {
    const key = cid.slice(5);
    const found = DEPTS.find(([id, name]) => id === key || name === key);
    return { id: cid, name: found ? found[1] : key, type: 'dept', deptId: found ? found[0] : null, 가상: true };
  }
  if (cid.startsWith('proj_')) {
    const pid = cid.slice(5), p = state.projects.find((x) => x.id === pid);
    return { id: cid, name: p ? (p.name || p.code || '프로젝트') : '프로젝트', type: 'project', projectId: pid, 가상: true };
  }
  return null;
}
function 인원표기(ch) {
  if (ch.type === 'dm' || ch.type === 'ai') return '';
  const n = 방멤버(ch).length;
  return n > 2 ? String(n) : '';
}
function 상대전화(ch) {
  if (!ch || ch.type !== 'dm') return '';
  const other = (ch.members || []).find((m) => m !== me());
  return other ? (state.phones[other] || '') : '';
}

// ───────────────────────────── 껍데기(한 번) ─────────────────────────────
const TABS = [['friends', '연락처', ICON.friends], ['chats', '채팅', ICON.chat], ['projects', '프로젝트', ICON.folder], ['me', '나', ICON.user]];
function 탭버튼(rail) {
  return TABS.map(([id, label, icon]) => `<button data-act="tab" data-tab="${id}" class="${ui.tab === id ? 'is-active' : ''}" aria-label="${label}">${icon}${rail ? '' : `<span>${label}</span>`}<span class="sjm-tab-badge" data-badge="${id}" hidden></span></button>`).join('');
}
function ensureShell(force) {
  const app = $('#app');
  const root = $('.sjm', app);
  if (root && !force && root.dataset.layout === ui.layout) return;
  app.innerHTML = `
    <div class="sjm" data-layout="${ui.layout}">
      <nav class="sjm-rail">${탭버튼(true)}</nav>
      <section class="sjm-pane">
        <div class="sjm-offline" id="offline" hidden>오프라인입니다. 연결되면 자동으로 이어집니다.</div>
        <div class="sjm-topbar" id="topbar"></div>
        <div class="sjm-screens">
          ${['friends', 'chats', 'projects', 'me', 'search'].map((s) => `<div class="sjm-screen" data-screen="${s}" hidden></div>`).join('')}
        </div>
      </section>
      <nav class="sjm-tabbar">${탭버튼(false)}</nav>
      <section class="sjm-room" id="room">
        <div class="sjm-room-empty">${ICON.chat}<div>채팅방을 선택하세요</div></div>
        <div class="sjm-room-head" id="roomHead"></div>
        <div class="sjm-room-search" id="roomSearch"></div>
        <div class="sjm-room-body" id="roomBody"></div>
        <button class="sjm-new-chip" data-act="jump-bottom" hidden>${ICON.arrowDown}<span>새 메시지</span></button>
        <div class="sjm-drop-hint" id="dropHint">여기에 놓으면 보냅니다</div>
        <div class="sjm-composer" id="composer"></div>
        <aside class="sjm-drawer" id="drawer"></aside>
        <div class="sjm-drawer-scrim" data-act="drawer-close"></div>
      </section>
    </div>`;
  roomDom = { cid: null, ids: [] };
  $('#offline').hidden = navigator.onLine !== false;
}

// ───────────────────────────── 렌더(부분) ─────────────────────────────
function render(부위 = 'all') {
  ensureShell(false);
  const all = 부위 === 'all';
  if (all || 부위 === 'tabs') renderTabs();
  if (all || 부위 === 'pane' || 부위 === 'tabs') renderPane();
  if (all || 부위 === 'room') renderRoom();
}
function renderTabs() {
  const rows = 채팅목록();
  const chatUnread = rows.reduce((s, r) => s + r.unread, 0);
  const projUnread = rows.filter((r) => r.ch.type === 'project' || r.ch.projectId).reduce((s, r) => s + r.unread, 0);
  $$('[data-act="tab"]').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === ui.tab));
  $$('[data-badge]').forEach((b) => {
    const n = b.dataset.badge === 'chats' ? chatUnread : b.dataset.badge === 'projects' ? projUnread : 0;
    b.hidden = n <= 0; b.textContent = n > 300 ? '300+' : String(n);
  });
  if (독립실행) {
    document.title = chatUnread ? `(${chatUnread > 300 ? '300+' : chatUnread}) SJ 메신저` : 'SJ 메신저';
    try { if (navigator.setAppBadge) (chatUnread ? navigator.setAppBadge(chatUnread) : navigator.clearAppBadge()).catch(() => {}); } catch (e) { /* 무시 */ }
  }
}
function 현재화면() { return ui.search.open ? 'search' : ui.tab; }
function renderPane() {
  renderTopbar();
  const cur = 현재화면();
  $$('.sjm-screen').forEach((el) => { if (!el.hidden) ui.scroll[el.dataset.screen] = el.scrollTop; });
  const el = $(`.sjm-screen[data-screen="${cur}"]`);
  if (!el) return;
  const st = el.hidden ? (ui.scroll[cur] || 0) : el.scrollTop;
  $$('.sjm-screen').forEach((x) => { x.hidden = x !== el; });
  el.innerHTML = ({ friends: 친구화면, chats: 채팅화면, projects: 프로젝트화면, me: 나화면, search: 검색화면 })[cur]();
  el.scrollTop = st;
  if (cur === 'search') { const inp = $('#searchInput'); if (inp && document.activeElement !== inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); } }
}
function renderTopbar() {
  const bar = $('#topbar'); if (!bar) return;
  if (ui.search.open) {
    bar.className = 'sjm-searchbar';
    bar.innerHTML = `<label class="sjm-field">${ICON.search}<input id="searchInput" type="search" placeholder="이름, 부서, 채팅방, 메시지 검색" value="${esc(ui.search.q)}" autocomplete="off" enterkeyhint="search"></label>
      <button data-act="search-close">취소</button>`;
    return;
  }
  bar.className = 'sjm-topbar';
  const title = { friends: '연락처', chats: '채팅', projects: '프로젝트', me: '나' }[ui.tab];
  const right = ui.tab === 'chats' ? `<button class="sjm-icon-btn" data-act="new-chat" aria-label="새 채팅">${ICON.plus}</button>` : '';
  bar.innerHTML = `<div class="sjm-topbar-title">${title}</div><button class="sjm-icon-btn" data-act="search-open" aria-label="검색">${ICON.search}</button>${right}`;
}

// 연락처 (화면 키는 friends — data-tab·CSS·시험대가 쓰는 이름이라 바꾸지 않았다) ------------------------------------------------------
function 사람줄(u, right = '', q = '') {
  const name = q ? 강조(u.name || '', q) : esc(u.name || '');
  return `<button class="sjm-user" data-act="user" data-uid="${esc(u.id)}">${아바타(u, '', false)}
    <div class="sjm-user-body"><div class="sjm-user-name">${name}</div><div class="sjm-user-sub">${esc([u.dept, u.title].filter(Boolean).join(' · '))}</div></div>
    ${right ? `<div class="sjm-user-right">${right}</div>` : ''}</button>`;
}
function 친구화면() {
  const my = 나();
  const users = 활성사용자().filter((u) => u.id !== me()).sort(L.사람정렬);
  const secs = L.섹션나누기(users);
  // **내 부서만.** 이 줄이 곧 그 부서 방으로 걸어 들어가는 문이라, 임원 예외를 여기 남기면
  // 목록에서 감춰 놔도 그대로 들어가진다(부장님 지시 2026-09-19 오후).
  const 볼부서 = DEPT_NAMES.filter((dn) => dn === (my.dept || ''));
  const depts = 볼부서.map((dn) => ({ dn, ch: 부서방(dn), n: 활성사용자().filter((u) => u.dept === dn).length }));
  return `<button class="sjm-me-row" data-act="tab" data-tab="me">${아바타(my, '', false)}
      <div class="sjm-user-body"><div class="sjm-user-name">${esc(my.name || '')}</div><div class="sjm-user-sub">${esc([my.dept, my.title].filter(Boolean).join(' · ') || '내 프로필')}</div></div></button>
    <button class="sjm-user sjm-airow" data-act="open" data-cid="${AI_CID}">${아바타(getU(AI_UID), '', false)}
      <div class="sjm-user-body"><div class="sjm-user-name">AI 비서</div><div class="sjm-user-sub">${esc(내권한().설명)}</div></div>
      <div class="sjm-user-right">${미읽음(AI_CID) ? `<span class="sjm-badge">${미읽음(AI_CID)}</span>` : ''}</div></button>
    <div class="sjm-index-wrap"><div class="sjm-index">${secs.map((s) => `<button data-act="jump" data-key="${esc(s.key)}">${esc(s.key)}</button>`).join('')}</div></div>
    <div class="sjm-friends-list">
      <div class="sjm-sec" data-key="부서"><div class="sjm-sec-h">부서 ${depts.length}</div>
        ${depts.map(({ dn, ch, n }) => `<button class="sjm-user sjm-deptrow" data-act="open" data-cid="${esc(ch.id)}">${방아바타(ch)}
          <div class="sjm-user-body"><div class="sjm-user-name">${esc(dn)}</div><div class="sjm-user-sub">${n ? `${n}명` : '아직 없음'}${ch.id === 부서방(my.dept || '').id ? ' · 내 부서' : ''}</div></div>
          <div class="sjm-user-right">${미읽음(ch.id) ? `<span class="sjm-badge">${미읽음(ch.id)}</span>` : ''}</div></button>`).join('')}
      </div>
      <div class="sjm-count-h">직원 ${users.length}</div>
      ${users.length ? secs.map((s) => `<div class="sjm-sec" data-key="${esc(s.key)}"><div class="sjm-sec-h">${esc(s.key)}</div>${s.items.map((u) => 사람줄(u)).join('')}</div>`).join('')
        : `<div class="sjm-empty">${ICON.friends}<div>아직 등록된 직원이 없습니다.</div></div>`}
    </div>`;
}

// 채팅 --------------------------------------------------------------
function 채팅줄(r, cls = '') {
  const { ch, last, lastAt, unread, pinned, name, preview } = r;
  const count = 인원표기(ch);
  const 빈문구 = ch.type === 'dm' ? '대화를 시작해 보세요' : '아직 메시지가 없습니다';
  return `<button class="sjm-chat ${cls} ${ui.cid === ch.id ? 'is-active' : ''}" data-act="open" data-cid="${esc(ch.id)}" data-long="chat">${방아바타(ch)}
    <div class="sjm-chat-body">
      <div class="sjm-chat-top"><span class="sjm-chat-name">${esc(name)}</span>${count ? `<span class="sjm-chat-count">${count}</span>` : ''}${pinned ? `<span class="sjm-pin">${ICON.pin}</span>` : ''}<span class="sjm-chat-time">${(last || ch.lastAt) ? esc(L.목록시각(lastAt)) : ''}</span></div>
      <div class="sjm-chat-bottom"><span class="sjm-chat-last">${esc(preview || 빈문구)}</span>${unread ? `<span class="sjm-badge">${unread > 300 ? '300+' : unread}</span>` : ''}</div>
    </div></button>`;
}
function 칩필터(rows) {
  if (ui.chip === 'dept') return rows.filter((r) => r.ch.type === 'dept' || r.ch.type === 'announce');
  if (ui.chip === 'project') return rows.filter((r) => r.ch.type === 'project' || r.ch.projectId);
  if (ui.chip === 'personal') return rows.filter((r) => (r.ch.type === 'dm' || r.ch.type === 'group') && !r.ch.projectId);
  return rows;
}
function 채팅화면() {
  const all = 채팅목록();
  if (!state.loaded.messages && !all.some((r) => r.last)) return `<div class="sjm-empty sjm-loading">${ICON.chat}<div>대화를 불러오는 중…</div></div>`;
  const rows = 칩필터(all);
  const chips = all.length >= 8 ? `<div class="sjm-chips">${[['all', '전체'], ['dept', '부서'], ['project', '프로젝트'], ['personal', '개인']].map(([id, label]) => `<button class="sjm-chip ${ui.chip === id ? 'is-active' : ''}" data-act="chip" data-chip="${id}">${label}</button>`).join('')}</div>` : '';
  if (!rows.length) return chips + `<div class="sjm-empty">${ICON.chat}<div>${all.length ? '이 종류의 채팅방이 없습니다.' : '아직 채팅방이 없습니다.<br>오른쪽 위 + 로 대화를 시작해 보세요.'}</div></div>`;
  return chips + rows.map((r) => 채팅줄(r)).join('');
}

// 프로젝트(폴더) ------------------------------------------------------
function 프로젝트화면() {
  const ps = 보이는프로젝트();
  if (!ps.length) return `<div class="sjm-empty">${ICON.folder}<div>진행 중인 프로젝트가 없습니다.<br>프로젝트는 플랫폼에서 등록합니다.</div></div>`;
  const groups = [['active', '진행중'], ['pre-close', '마감예정'], ['done', '완료']];
  const rowsByCid = new Map(채팅목록().map((r) => [r.ch.id, r]));
  const rowOf = (ch) => rowsByCid.get(ch.id) || (() => { const { last, lastAt } = 마지막활동(ch); return { ch, last, lastAt, unread: 미읽음(ch.id), pinned: !!state.pins[ch.id], name: 방이름(ch), preview: last ? L.미리보기(last) : (ch.lastText || '') }; })();
  return groups.map(([st, label]) => {
    const list = ps.filter((p) => (p.status || 'active') === st)
      .map((p) => ({ p, rooms: 프로젝트방들(p) }))
      .map((x) => ({ ...x, lastAt: Math.max(0, ...x.rooms.map((c) => 마지막활동(c).lastAt)) }))
      .sort((a, b) => (b.lastAt - a.lastAt) || String(a.p.name || '').localeCompare(String(b.p.name || ''), 'ko'));
    if (!list.length) return '';
    const collapsed = ui.projCollapsed[st] ? '1' : '0';
    return `<div class="sjm-proj-group" data-status="${st}" data-collapsed="${collapsed}">
      <button class="sjm-proj-group-h" data-act="proj-group" data-status="${st}"><span class="sjm-dot" data-status="${st}"></span>${label} ${list.length}<span class="sjm-caret">${ICON.down}</span></button>
      <div class="sjm-proj-list">${list.map(({ p, rooms }) => {
        const unread = rooms.reduce((s, c) => s + 미읽음(c.id), 0);
        const open = !!ui.projOpen[p.id];
        const pm = getU(p.pm || p.manager);
        return `<button class="sjm-proj" data-act="proj" data-pid="${esc(p.id)}">${방아바타(프로젝트기본방(p))}
            <div class="sjm-proj-body"><div class="sjm-proj-name">${esc(p.name || p.code || '프로젝트')}</div>
              <div class="sjm-proj-sub">${esc(p.code || '')}${p.code ? ' · ' : ''}${esc(pm.name && pm.name !== '알 수 없음' ? 'PM ' + pm.name : (p.client || ''))} · 방 ${rooms.length}</div></div>
            ${unread ? `<span class="sjm-badge">${unread > 300 ? '300+' : unread}</span>` : ''}<span class="sjm-caret" style="color:var(--text-3);transform:rotate(${open ? 0 : -90}deg)">${ICON.down}</span></button>
          ${open ? `<div class="sjm-proj-rooms">${rooms.map((c) => 채팅줄(rowOf(c))).join('')}
            <button class="sjm-proj-new" data-act="proj-new-room" data-pid="${esc(p.id)}">${ICON.plus}방 추가</button></div>` : ''}`;
      }).join('')}</div></div>`;
  }).join('');
}

// 나 -----------------------------------------------------------------
function 나화면() {
  const my = 나();
  const phone = state.phones[me()] || '';
  return `<div class="sjm-profile">
      <button class="sjm-photo-btn" data-act="photo-menu" aria-label="프로필 사진 바꾸기">${아바타(my, 'is-xl', false)}<span class="sjm-cam">${ICON.camera}</span></button>
      <div class="sjm-profile-name">${esc(my.name || '')}</div>
      <div class="sjm-profile-sub">${esc([my.dept, my.title].filter(Boolean).join(' · '))}</div>
      <div class="sjm-profile-mail">${esc(my.email || '')}</div>
    </div>
    <div class="sjm-settings">
      <label class="sjm-set-row">${ICON.phone}<span>전화번호</span><input id="phoneInput" class="sjm-set-input" type="tel" inputmode="tel" placeholder="010-0000-0000" value="${esc(phone)}" autocomplete="tel"></label>
      <div class="sjm-set-hint">${phone ? '동료가 연락처에서 바로 전화할 수 있습니다.' : '전화번호를 등록하면 동료가 바로 전화할 수 있어요.'}</div>
      <button class="sjm-set-row" data-act="photo-menu">${ICON.camera}<span>프로필 사진</span><span class="sjm-set-right">${state.photos[me()] ? '바꾸기 · 지우기' : '추가'}</span></button>
      <button class="sjm-set-row" data-act="dm" data-uid="${esc(me())}">${ICON.chat}<span>나와의 채팅</span><span class="sjm-set-right">메모·사진 보관</span></button>
      ${독립실행 ? `<button class="sjm-set-row is-danger" data-act="logout">${ICON.logout}<span>로그아웃</span></button>` : ''}
    </div>
    <div class="sjm-version">SJ 메신저 ${esc(버전)} · 이름·부서·직급은 플랫폼 설정에서 바꿀 수 있습니다.</div>`;
}

// 검색 --------------------------------------------------------------
function 검색결과() {
  const q = ui.search.q.trim();
  if (!q) return { friends: [], chats: [], messages: [] };
  const lq = q.toLowerCase();
  const friends = 활성사용자().filter((u) => u.id !== me())
    .map((u) => ({ u, r: L.이름일치(u.name || '', q, [u.dept, u.title, u.email]) }))
    .filter((x) => x.r > 0).sort((a, b) => a.r - b.r || L.사람정렬(a.u, b.u)).map((x) => x.u);
  // 채팅방: 보이는 방 + **내가 들어갈 수 있는** 부서·프로젝트 방(이름으로 찾아 들어갈 수 있게).
  // 목록에서 뺀 방을 검색으로 들어갈 수 있으면 뺀 의미가 없다(메시지 검색은 아래 visible 로 이미 걸린다).
  const pool = new Map(보이는방().map((c) => [c.id, c]));
  const 검색부서 = DEPT_NAMES.filter((dn) => dn === (나().dept || ''));
  for (const dn of 검색부서) { const c = 부서방(dn); if (!pool.has(c.id)) pool.set(c.id, c); }
  for (const p of 보이는프로젝트()) { const c = 프로젝트기본방(p); if (!pool.has(c.id)) pool.set(c.id, c); }
  const chats = Array.from(pool.values()).filter((c) => L.이름일치(방이름(c), q) > 0)
    .map((ch) => { const { last, lastAt } = 마지막활동(ch); return { ch, last, lastAt, unread: 미읽음(ch.id), pinned: !!state.pins[ch.id], name: 방이름(ch), preview: last ? L.미리보기(last) : (ch.lastText || '') }; })
    .sort(L.채팅정렬);
  const visible = new Set(보이는방().map((c) => c.id));
  const messages = state.messages.filter((m) => visible.has(m.channel) && String(m.text || '').toLowerCase().includes(lq)).reverse().slice(0, 100);
  return { friends, chats, messages };
}
function 강조(text, q) {
  const s = esc(text), i = s.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0 || !q) return s;
  return s.slice(0, i) + '<b>' + s.slice(i, i + q.length) + '</b>' + s.slice(i + q.length);
}
function 검색화면() {
  const q = ui.search.q.trim();
  const r = 검색결과();
  const stabs = [['all', '전체'], ['chats', '채팅방'], ['friends', '연락처'], ['messages', '메시지']];
  const head = `<div class="sjm-stabs">${stabs.map(([id, label]) => `<button data-act="stab" data-stab="${id}" class="${ui.search.stab === id ? 'is-active' : ''}">${label}</button>`).join('')}</div>`;
  if (!q) return head + `<div class="sjm-empty">${ICON.search}<div>이름을 치면 그 이름으로 시작하는 사람이,<br>초성(ㄱㅊ)만 쳐도 찾아집니다.</div></div>`;
  const st = ui.search.stab, all = st === 'all';
  const cut = (arr) => all ? arr.slice(0, 3) : arr;
  const secH = (label, n, kind) => `<div class="sjm-sres-h">${label} ${n}${all && n > 3 ? `<button class="sjm-more" data-act="stab" data-stab="${kind}">더보기 ›</button>` : ''}</div>`;
  let html = head;
  if ((all || st === 'friends') && r.friends.length) html += `<div class="sjm-sres" data-kind="friends">${secH('연락처', r.friends.length, 'friends')}${cut(r.friends).map((u) => 사람줄(u, '', q)).join('')}</div>`;
  if ((all || st === 'chats') && r.chats.length) html += `<div class="sjm-sres" data-kind="chats">${secH('채팅방', r.chats.length, 'chats')}${cut(r.chats).map((x) => 채팅줄(x)).join('')}</div>`;
  if ((all || st === 'messages') && r.messages.length) {
    html += `<div class="sjm-sres" data-kind="messages">${secH('메시지', r.messages.length, 'messages')}${cut(r.messages).map((m) => {
      const ch = getChannel(m.channel) || { id: m.channel, name: m.channel, type: 'group' };
      return `<button class="sjm-hit" data-act="hit" data-cid="${esc(m.channel)}" data-mid="${esc(m.id)}">${방아바타(ch)}
        <div class="sjm-hit-body"><div class="sjm-hit-top"><span class="sjm-hit-room">${esc(방이름(ch))}</span><span class="sjm-hit-time">${esc(L.목록시각(L.메시지시각ms(m)))}</span></div>
        <div class="sjm-hit-text">${강조(String(m.text || ''), q)}</div></div></button>`;
    }).join('')}<div class="sjm-note">최근 메시지에서만 검색됩니다.</div></div>`;
  }
  if (html === head) html += `<div class="sjm-empty">${ICON.search}<div>검색 결과가 없습니다.${st === 'messages' || all ? '<br><span class="sjm-note">메시지는 최근 것에서만 찾습니다.</span>' : ''}</div></div>`;
  return html;
}

// ───────────────────────────── 방 ─────────────────────────────
function renderRoom() {
  const room = $('#room'); if (!room) return;
  const ch = getChannel(ui.cid);
  if (!ch) {
    room.removeAttribute('data-cid'); room.classList.remove('is-open', 'is-searching');
    $('#roomHead').innerHTML = ''; $('#roomBody').innerHTML = ''; $('#composer').innerHTML = '';
    roomDom = { cid: null, ids: [] };
    return;
  }
  room.dataset.cid = ch.id; room.classList.add('is-open'); room.classList.toggle('is-searching', ui.rs.open);
  const others = 미읽음합(ch.id);
  const count = 인원표기(ch);
  const tel = 상대전화(ch);
  $('#roomHead').innerHTML = `<button class="sjm-back" data-act="back" aria-label="뒤로">${ICON.back}<span class="sjm-back-count">${others ? (others > 300 ? '300+' : others) : ''}</span></button>
    <div class="sjm-room-title"><span class="sjm-room-title-text">${esc(방이름(ch))}</span>${count ? `<span class="sjm-room-count">${count}</span>` : ''}</div>
    <button class="sjm-icon-btn" data-act="room-search" aria-label="대화 검색">${ICON.search}</button>
    ${tel ? `<button class="sjm-icon-btn" data-act="call" data-tel="${esc(tel)}" aria-label="전화">${ICON.phone}</button>` : ''}
    <button class="sjm-icon-btn" data-act="room-menu" aria-label="채팅방 메뉴">${ICON.menu}</button>`;
  $('#roomSearch').innerHTML = `<label class="sjm-field">${ICON.search}<input id="roomSearchInput" type="search" placeholder="대화 내용 검색" value="${esc(ui.rs.q)}" autocomplete="off"></label>
    <span class="sjm-rs-count">${ui.rs.hits.length ? `${ui.rs.idx + 1}/${ui.rs.hits.length}` : (ui.rs.q ? '0/0' : '')}</span>
    <button class="sjm-icon-btn" data-act="rs-prev" aria-label="이전">${ICON.up}</button><button class="sjm-icon-btn" data-act="rs-next" aria-label="다음">${ICON.down}</button>
    <button data-act="rs-close">닫기</button>`;
  if (!$('#msgInput')) {
    $('#composer').innerHTML = `<button class="sjm-icon-btn" data-act="attach" aria-label="첨부">${ICON.plus}</button>
      <textarea id="msgInput" rows="1" placeholder="메시지 입력" enterkeyhint="send"></textarea>
      <button data-act="send" aria-label="보내기">${ICON.send}</button>`;
  }
  const isAI = ch.type === 'ai';
  // 공지는 부서장 이상만(부장님 지시 2026-09-18). 화면에서 입력창을 접고, 저장소 규칙도 같은 기준으로 막는다.
  const 잠김 = ch.type === 'announce' && !L.공지쓰기가능(나());
  const comp = $('#composer');
  if (comp) {
    if (잠김) comp.setAttribute('data-locked', '공지는 부서장 이상만 올릴 수 있습니다.');
    else comp.removeAttribute('data-locked');
  }
  const inp0 = $('#msgInput'); if (inp0) inp0.placeholder = isAI ? 'AI 비서에게 물어보기' : '메시지 입력';
  // 1단계에서 AI 방은 첨부를 받지 않는다(영수증·일정 첨부는 R2 와 색인이 붙는 다음 단계).
  const att = $('[data-act="attach"]'); if (att) att.hidden = isAI;
  // 같은 방이면 다시 그려도 읽던 자리를 지킨다(users·channels 스냅샷마다 맨 아래로 튀지 않게). 방이 바뀌었을 때만 처음부터.
  renderMessages(roomDom.cid !== ch.id);
}
const 날바뀜 = (a, b) => !a || !b || new Date(L.메시지시각ms(a)).toDateString() !== new Date(L.메시지시각ms(b)).toDateString();
function 묶음정보(msgs, i) {
  const cur = msgs[i], prev = msgs[i - 1], next = msgs[i + 1];
  return {
    day: 날바뀜(prev, cur) ? L.날짜선(L.메시지시각ms(cur)) : null,
    first: !prev || 날바뀜(prev, cur) || !L.같은묶음(prev, cur),
    last: !next || 날바뀜(cur, next) || !L.같은묶음(cur, next),
  };
}
function 안읽은수(m, members) {
  if (!members) return 0;
  const t = L.메시지시각ms(m), my = me();
  return members.filter((uid) => uid !== m.author && uid !== my && (state.roomReads[uid] || 0) < t).length;
}
function 말풍선(m, info, members, readMarkBefore) {
  const my = me();
  const isMe = m.author === my, isSys = m.author === 'SYSTEM' || m.system === true;
  const u = getU(m.author);
  const t = L.메시지시각ms(m);
  let body;
  if (isSys) {
    body = `<div class="sjm-bubble">${esc(m.text || '')}</div>`;
  } else if (m.type === 'image' || (m.fileUrl && /\.(png|jpe?g|gif|webp|heic)$/i.test(m.file || ''))) {
    body = m.fileUrl ? `<div class="sjm-bubble is-img"><img class="sjm-msg-img" data-act="view-img" src="${esc(m.fileUrl)}" alt="${esc(m.file || '사진')}" loading="lazy"></div>`
      : `<div class="sjm-bubble">${ICON.image} ${esc(m.file || '사진')}</div>`;
  } else if (m.file) {
    body = `<a class="sjm-bubble is-file sjm-file" ${m.fileUrl ? `href="${esc(m.fileUrl)}" target="_blank" rel="noopener"` : ''}>${ICON.file}<span><div class="sjm-file-name">${esc(m.file)}</div><div class="sjm-file-size">${esc(m.fileSize || '')}</div></span></a>`;
  } else if (m.md) {
    // AI 답변 — 글머리표·표를 그대로 그린다. 방 안 검색 하이라이트는 여기 안 붙는다(서식 태그를 깨뜨린다).
    body = `<div class="sjm-bubble is-md">${L.서식(m.text || '')}${그림달기(m)}${출처달기(m)}</div>`;
  } else {
    let text = esc(m.text || '');
    if (ui.rs.open && ui.rs.q) {
      const q = esc(ui.rs.q), re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      text = text.replace(re, (s) => `<mark class="sjm-mark">${s}</mark>`);
    }
    body = `<div class="sjm-bubble">${링크달기(text)}</div>`;
  }
  const n = (!isSys && !m._pending) ? 안읽은수(m, members) : 0;
  // AI 방에서는 지우기를 길게누름으로 주지 않는다 — 한 줄씩 지우면 대화가 어긋난다. 방 메뉴의 "새 대화"로 통째로 지운다.
  const long = m._failed ? 'msg-failed' : (isMe && !m._pending && m.channel !== AI_CID ? 'msg-me' : 'msg');
  return `${info.day ? `<div class="sjm-day">${esc(info.day)}</div>` : ''}${readMarkBefore ? '<div class="sjm-day sjm-readmark">여기까지 읽으셨습니다</div>' : ''}
    <div class="sjm-msg ${isMe ? 'is-me' : ''} ${isSys ? 'is-system' : ''} ${m.author === AI_UID ? 'is-ai' : ''} ${m.실패 ? 'is-aifail' : ''} ${info.first ? 'is-first' : ''} ${info.last ? 'is-last' : ''} ${m._pending ? 'is-pending' : ''} ${m._failed ? 'is-failed' : ''}" data-mid="${esc(m.id)}" data-author="${esc(m.author)}" data-long="${long}">
      ${아바타(u, 'is-sm')}<div class="sjm-msg-name" ${u.id && !u.pending ? `data-act="user" data-uid="${esc(u.id)}"` : ''}>${esc(이름직급(u))}</div>
      <div class="sjm-msg-line">${body}<div class="sjm-msg-meta">${m._failed ? '<span class="sjm-msg-fail" title="전송 실패">!</span>' : `<span class="sjm-msg-unread">${n > 0 ? n : ''}</span>`}<span class="sjm-msg-time">${m._failed ? '전송 실패' : m._pending ? '전송 중' : esc(L.말풍선시각(t))}</span></div></div>
    </div>`;
}
// AI 답변이 사내 문서를 근거로 삼았으면 어떤 문서인지 밝힌다(원칙: 출처 없는 답은 믿지 않는다).
function 그림달기(m) {
  // ASME 도면. 주소는 맥이 서명해 준 것이고 7일이면 만료된다 — 옛 대화를 다시 열면 깨질 수 있다.
  // 그때 엑스박스를 보여 주느니 onerror 로 이미지를 접고 캡션 글자만 남긴다.
  const gs = (Array.isArray(m.그림) ? m.그림 : []).filter((g) => g && g.url);
  if (!gs.length) return '';
  return `<div class="sjm-md-figs">${gs.map((g) => {
    const 설명 = esc(g.caption || ('Figure ' + (g.no || '')));
    return `<figure class="sjm-md-fig">`
      + `<img src="${esc(g.url)}" alt="${설명}" loading="lazy"`
      + ` onerror="this.closest('.sjm-md-fig').classList.add('is-gone')">`
      + `<figcaption>${설명}${g.page ? ` · p.${esc(String(g.page))}` : ''}</figcaption></figure>`;
  }).join('')}</div>`;
}

function 출처달기(m) {
  // 색인의 docName 은 "[자동] CAR CAR-2026-002 — 현행요건 : 기술부 내부 …" 처럼 본문까지 붙어 길다.
  // 말풍선 아래 한 줄이라 앞부분(문서를 알아볼 수 있는 데까지)만 남긴다.
  const 짧게 = (s) => { const t = String(s).split('—')[0].replace(/^\[자동\]\s*/, '').trim(); return t.length > 26 ? t.slice(0, 26) + '…' : t; };
  const src = [...new Set((Array.isArray(m.sources) ? m.sources : []).filter(Boolean).map(짧게))].slice(0, 3);
  if (!src.length) return '';
  return `<div class="sjm-md-src" title="${esc((m.sources || []).join('\n'))}">${ICON.file}<span>${src.map((x) => esc(x)).join(' · ')}</span></div>`;
}
const 메시지찾기 = (mid) => state.messages.find((x) => x.id === mid) || state.aiMsgs.find((x) => x.id === mid) || null;
function 방전체메시지(cid) {
  const list = 방메시지(cid).slice();
  for (const p of state.pending) if (p.channel === cid) list.push(p);
  return list;
}
function 방멤버계산(ch) {
  if (ch.type === 'announce' || ch.type === 'ai') return null;   // 전원 방·AI 방은 '읽지 않은 사람 수'가 무의미
  const m = 방멤버(ch);
  return m.length >= 2 && m.length <= 60 ? m : null;
}
function 경계문구(cid) {
  // 500건 창이 꽉 찼고 이 방의 가장 오래된 표시 메시지가 창의 끝 근처면, 더 오래된 대화가 잘려 있을 가능성이 높다.
  if (cid === AI_CID) return '';
  if (state.messages.length < 메시지창) return '';
  const msgs = 방메시지(cid);
  const oldest = state.messages.length ? L.메시지시각ms(state.messages[0]) : 0;
  if (!msgs.length) { const ch = getChannel(cid); return ch && ch.lastAt ? '최근 대화만 표시됩니다' : ''; }
  return L.메시지시각ms(msgs[0]) - oldest < 24 * 3600 * 1000 ? '최근 대화만 표시됩니다' : '';
}
// 새 메시지가 뒤에만 붙었으면 그 부분만 그린다. 아니면 통째로 다시 그리되 "바닥에서의 거리" 를 유지한다.
// 바깥 껍데기: "생각 중" 점 세 개는 늘 맨 끝에 있어야 해서, 그리기 전에 떼고 그린 뒤 다시 붙인다.
function renderMessages(강제) {
  const b0 = $('#roomBody'); if (b0) $('.sjm-typing', b0)?.remove();
  renderMessages내부(강제);
  const b = $('#roomBody');
  if (b && ui.aiThinking && ui.cid === AI_CID) {
    b.insertAdjacentHTML('beforeend', `<div class="sjm-msg is-first is-last sjm-typing">${아바타(getU(AI_UID), 'is-sm', false)}<div class="sjm-msg-name">AI 비서</div><div class="sjm-msg-line"><div class="sjm-bubble is-typing"><i></i><i></i><i></i></div></div></div>`);
    b.scrollTop = b.scrollHeight;
  }
}
function renderMessages내부(강제) {
  const body = $('#roomBody'); const ch = getChannel(ui.cid); if (!body || !ch) return;
  const msgs = 방전체메시지(ch.id);
  const ids = msgs.map((m) => m.id);
  const members = 방멤버계산(ch);
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 60;
  const rsq = ui.rs.open ? ui.rs.q : '';
  // 강제 = 처음부터 다시. 검색어(하이라이트)가 바뀌었을 때도 말풍선을 다시 그려야 한다 — 안 그러면 검색을 닫아도 노란 표시가 남는다(시험대에서 잡힘)
  const same = roomDom.cid === ch.id && !강제 && roomDom.rsq === rsq;
  const oldLen = roomDom.ids.length;
  const 앞부분같음 = same && ids.length >= oldLen && roomDom.ids.every((id, i) => ids[i] === id);
  if (앞부분같음 && ids.length > oldLen && !ui.rs.open) {
    const 새것 = msgs.slice(oldLen);
    const from = Math.max(0, oldLen - 1);
    const old = oldLen ? $(`.sjm-msg[data-mid="${CSS.escape(roomDom.ids[oldLen - 1])}"]`, body) : null;
    if (old) old.remove();
    const frag = document.createElement('div');
    frag.innerHTML = msgs.slice(from).map((m, k) => 말풍선(m, 묶음정보(msgs, from + k), members, false)).join('');
    if (from > 0) { const dayDup = frag.querySelector(':scope > .sjm-day:not(.sjm-readmark)'); if (dayDup && $$('.sjm-day', body).some((d) => d.textContent === dayDup.textContent)) dayDup.remove(); }
    while (frag.firstChild) body.appendChild(frag.firstChild);
    roomDom.ids = ids;
    if (atBottom || 새것.some((m) => m.author === me())) { body.scrollTop = body.scrollHeight; $('.sjm-new-chip').hidden = true; 읽음처리(ch.id); }
    else { const last = 새것[새것.length - 1]; const chip = $('.sjm-new-chip'); chip.hidden = false; chip.lastElementChild.textContent = `${getU(last.author).name}: ${L.미리보기(last).slice(0, 20)}`; }
    return;
  }
  if (same && ids.length === oldLen && ids.every((id, i) => roomDom.ids[i] === id) && !ui.rs.open) {
    // 내용은 같고 읽음('1')만 바뀐 경우 — 숫자만 갱신
    $$('.sjm-msg', body).forEach((el) => {
      const m = msgs.find((x) => x.id === el.dataset.mid); const span = el.querySelector('.sjm-msg-unread');
      if (!m || !span) return; const n = 안읽은수(m, members); span.textContent = n > 0 ? String(n) : '';
    });
    return;
  }
  const fromBottom = body.scrollHeight - body.scrollTop;
  let 표식 = ui.readMark > 0 && !same;
  let html = '';
  const 경계 = 경계문구(ch.id);
  if (경계) html += `<div class="sjm-day sjm-edge">${경계}</div>`;
  if (!msgs.length) {
    const 빈 = ch.type === 'dm' ? `${esc(방이름(ch))}님과 대화를 시작해 보세요.` : ch.type === 'announce' ? '회사 소식과 공지가 올라오는 곳입니다.'
      : ch.type === 'ai' ? 'AI 비서입니다. 사내 문서·프로젝트·업무를 물어보세요.<br><span class="sjm-note">보이는 범위는 내 권한을 따릅니다. 등록·수정은 플랫폼에서 하세요.</span>'
      : ch.type === 'dept' ? `${esc(ch.name)} ${방멤버(ch).length}명이 함께하는 채팅방입니다.` : ch.type === 'project' ? `${esc(ch.name)} 프로젝트 채팅방입니다.` : '첫 메시지를 남겨 보세요.';
    html += `<div class="sjm-empty sjm-room-blank">${빈}</div>`;
  } else {
    html += msgs.map((m, i) => {
      let mark = false;
      if (표식 && m.author !== me() && !m._pending && L.메시지시각ms(m) > ui.readMark) { mark = true; 표식 = false; }
      return 말풍선(m, 묶음정보(msgs, i), members, mark);
    }).join('');
  }
  body.innerHTML = html;
  const 방바뀜 = roomDom.cid !== ch.id;
  roomDom = { cid: ch.id, ids, rsq };
  // 방이 바뀌었거나(처음 열기) 원래 맨 아래에 있었으면 맨 아래로. 아니면 "바닥에서의 거리" 를 그대로 — 읽던 자리가 안 튄다.
  if (방바뀜 || atBottom) body.scrollTop = body.scrollHeight; else body.scrollTop = Math.max(0, body.scrollHeight - fromBottom);
  $('.sjm-new-chip').hidden = true;
  if (ui.rs.open) 검색위치이동(false);
}
function 읽음처리(cid) {
  if (!cid || !me()) return;
  if (document.visibilityState !== 'visible') return;
  const now = Date.now();
  state.reads[cid] = now; state.readDocs.add(cid);
  renderTabs();
  // 스냅샷마다 쓰지 않는다(1초 스로틀). 단 마지막 것은 꼭 뒤따라 써서 서버가 최신 읽음을 놓치지 않게.
  const 지연 = 1000 - (now - (ui.lastReadWrite[cid] || 0));
  if (지연 > 0) { if (!ui.readTimer?.[cid]) { ui.readTimer = ui.readTimer || {}; ui.readTimer[cid] = setTimeout(() => { delete ui.readTimer[cid]; 읽음기록(cid); }, 지연); } return; }
  읽음기록(cid);
}
function 읽음기록(cid) {
  const now = Date.now(); ui.lastReadWrite[cid] = now;
  const fb = getFB(); if (!fb || !fb.db || !me()) return;
  fb.setDoc(fb.doc(fb.db, 'channelReads', cid + '_' + me()), plain({ channel: String(cid), uid: String(me()), lastRead: Number(now) }), { merge: true })
    .catch((e) => console.warn('[읽음] 저장 실패', e && e.message));
}

// 방 열기·닫기 -------------------------------------------------------
function openRoom(cid, opts = {}) {
  const ch = getChannel(cid);
  if (!ch) { 토스트('채팅방을 찾을 수 없습니다.'); return; }
  const 새방 = ui.cid !== cid;
  if (새방) { ui.readMark = state.reads[cid] || 0; ui.rs = { open: false, q: '', hits: [], idx: 0 }; 방읽음구독(cid); }
  ui.cid = cid; ui.opened.add(cid); closeSheet(); closeDrawer();
  if (state.hidden[cid]) {   // 숨겨 둔 1:1 방을 다시 열면 숨김 해제(서버에도)
    delete state.hidden[cid];
    const fb = getFB(); if (fb && fb.db) fb.setDoc(fb.doc(fb.db, 'channelReads', cid + '_' + me()), plain({ channel: String(cid), uid: String(me()), hidden: 0 }), { merge: true }).catch(() => {});
  }
  if (ui.search.open && !opts.keepSearch) ui.search.open = false;
  if (독립실행 && ui.layout === 'phone' && 새방 && !opts.fromHistory && !ui.pushed) { try { history.pushState({ sjm: 'room', cid }, ''); ui.pushed = true; } catch (e) { /* 무시 */ } }
  render('all');
  읽음처리(cid);
  if (opts.mid) requestAnimationFrame(() => 메시지로이동(opts.mid, true));
  if (ui.layout === 'desk') { const inp = $('#msgInput'); if (inp) inp.focus(); }
}
function closeRoom(viaHistory) {
  if (!ui.cid) return;
  if (독립실행 && ui.layout === 'phone' && ui.pushed && !viaHistory) { ui.pushed = false; try { history.back(); return; } catch (e) { /* 아래로 */ } }
  ui.pushed = false;
  ui.cid = null; ui.rs = { open: false, q: '', hits: [], idx: 0 };
  if (구독.방) { try { 구독.방(); } catch (e) { /* 무시 */ } 구독.방 = null; }
  state.roomReads = {};
  closeDrawer();
  render('all');
}
function 메시지로이동(mid, flash) {
  const el = $(`.sjm-msg[data-mid="${CSS.escape(mid)}"]`); if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  if (flash) { el.style.transition = 'background .3s'; el.style.background = 'rgba(255,255,255,.35)'; setTimeout(() => { el.style.background = ''; }, 900); }
  return true;
}

// 방 안 검색 ---------------------------------------------------------
function 방검색갱신() {
  const q = ui.rs.q.trim().toLowerCase();
  const msgs = 방전체메시지(ui.cid);
  ui.rs.hits = q ? msgs.filter((m) => String(m.text || '').toLowerCase().includes(q)).map((m) => m.id) : [];
  ui.rs.idx = Math.max(0, ui.rs.hits.length - 1);   // 최신 것부터
  renderMessages(true);
  renderRoomSearchCount();
  검색위치이동(true);
}
function renderRoomSearchCount() {
  const c = $('.sjm-rs-count'); if (c) c.textContent = ui.rs.hits.length ? `${ui.rs.idx + 1}/${ui.rs.hits.length}` : (ui.rs.q ? '0/0' : '');
}
function 검색위치이동(scroll) {
  $$('.sjm-mark.is-current').forEach((m) => m.classList.remove('is-current'));
  const mid = ui.rs.hits[ui.rs.idx]; if (!mid) return;
  const el = $(`.sjm-msg[data-mid="${CSS.escape(mid)}"]`); if (!el) return;
  el.querySelectorAll('.sjm-mark').forEach((m) => m.classList.add('is-current'));
  if (scroll) el.scrollIntoView({ block: 'center' });
}

// 서랍(참여자) --------------------------------------------------------
function renderDrawer() {
  const ch = getChannel(ui.cid); const d = $('#drawer'); if (!ch || !d) return;
  const members = 방멤버(ch).map(getU).sort(L.사람정렬);
  const canLeave = (ch.type === 'dm' || ch.type === 'group') && !ch.가상;
  const canInvite = ch.type === 'group' && !ch.가상;
  d.innerHTML = `<div class="sjm-drawer-h"><span>${esc(방이름(ch))}</span><button class="sjm-icon-btn" data-act="drawer-close" aria-label="닫기">${ICON.x}</button></div>
    <div class="sjm-drawer-list"><div class="sjm-drawer-sec">대화상대 ${members.length}</div>
      ${canInvite ? `<button class="sjm-user" data-act="invite" data-cid="${esc(ch.id)}"><div class="sjm-avatar is-icon">${ICON.userPlus}</div><div class="sjm-user-body"><div class="sjm-user-name">대화상대 초대</div></div></button>` : ''}
      ${members.map((u) => 사람줄(u, u.id === me() ? '나' : '')).join('') || '<div class="sjm-empty">참여자 정보가 없습니다.</div>'}</div>
    <div class="sjm-drawer-foot">
      <button class="sjm-set-row" data-act="pin" data-cid="${esc(ch.id)}">${ICON.pin}<span>${state.pins[ch.id] ? '채팅방 상단 고정 해제' : '채팅방 상단 고정'}</span></button>
      ${canLeave ? `<button class="sjm-set-row is-danger" data-act="leave" data-cid="${esc(ch.id)}">${ICON.logout}<span>나가기</span></button>` : ''}
    </div>`;
  d.classList.add('is-open'); $('.sjm-drawer-scrim').classList.add('is-show');
}
function closeDrawer() { $('#drawer')?.classList.remove('is-open'); $('.sjm-drawer-scrim')?.classList.remove('is-show'); }

// ───────────────────────────── 시트·모달 ─────────────────────────────
function openSheet(html, kind = '', extra = {}) {
  const s = $('#sheet'); s.innerHTML = `<div class="sjm-sheet-grip"></div>${html}`;
  s.dataset.kind = kind; Object.entries(extra).forEach(([k, v]) => { s.dataset[k] = v; });
  s.classList.add('is-open'); $('.sjm-sheet-scrim').classList.add('is-show');
}
function closeSheet() { const s = $('#sheet'); if (!s) return; s.classList.remove('is-open'); s.removeAttribute('data-kind'); $('.sjm-sheet-scrim')?.classList.remove('is-show'); }
const 항목 = (act, icon, label, attrs = '', cls = '', sub = '') => `<button class="sjm-sheet-item ${cls}" data-act="${act}" ${attrs}>${icon}<span>${label}</span>${sub ? `<span class="sjm-sheet-sub">${sub}</span>` : ''}</button>`;
function 프로필시트(uid) {
  const u = getU(uid); if (!u || !u.id) return;
  const isMe = uid === me();
  const phone = state.phones[uid] || u.phone || '';
  openSheet(`<div class="sjm-pf">${아바타(u, 'is-xl', false)}<div class="sjm-pf-name">${esc(u.name)}</div><div class="sjm-pf-sub">${esc([u.dept, u.title].filter(Boolean).join(' · '))}</div><div class="sjm-pf-mail">${esc(u.email || '')}${phone ? ` · ${esc(phone)}` : ''}</div></div>
    <div class="sjm-pf-actions">
      ${isMe ? `<button data-act="dm" data-uid="${esc(u.id)}">${ICON.chat}<span>나와의 채팅</span></button><button data-act="tab" data-tab="me">${ICON.user}<span>내 프로필</span></button>`
        : `<button data-act="dm" data-uid="${esc(u.id)}">${ICON.chat}<span>1:1 채팅</span></button>
           ${phone ? `<button data-act="call" data-tel="${esc(phone)}">${ICON.phone}<span>전화</span></button>` : ''}
           ${u.email ? `<button data-act="mail" data-mail="${esc(u.email)}">${ICON.mail}<span>이메일</span></button>` : ''}`}
    </div>`, 'profile', { uid });
}
function openModal(title, bodyHtml, onConfirm, okLabel = '확인') {
  const m = $('#modal'); $('#mTitle').textContent = title; $('#mBody').innerHTML = bodyHtml;
  const ok = $('#mOk'); const ok2 = ok.cloneNode(true); ok.replaceWith(ok2);
  ok2.textContent = okLabel;
  if (onConfirm) { ok2.style.display = ''; ok2.onclick = onConfirm; } else ok2.style.display = 'none';
  m.classList.add('active');
}
function closeModal() { $('#modal')?.classList.remove('active'); }
function 사람고르기HTML(users, name = 'pickMember', checked = new Set()) {
  return `<div class="fg"><input class="fi" id="pickSearch" placeholder="이름, 부서 검색 (초성도 됩니다)" autocomplete="off"></div>
    <div class="sjm-pick-list" id="pickList">${users.map((u) => `<label class="msg-pick" data-name="${esc(u.name)}" data-sub="${esc([u.dept, u.title].join(' '))}">
      <input type="checkbox" name="${name}" value="${esc(u.id)}" ${checked.has(u.id) ? 'checked' : ''}>${아바타(u, 'is-xs', false)}
      <span style="font-weight:600">${esc(u.name)}</span><span style="font-size:12px;color:var(--text-3)">${esc([u.dept, u.title].filter(Boolean).join(' · '))}</span></label>`).join('')}</div>`;
}
// 새 채팅 하나로: 1명 고르면 1:1, 여럿이면 그룹. 이름은 선택(비우면 멤버 이름으로).
function 새채팅(preset = {}) {
  const users = 활성사용자().filter((u) => u.id !== me()).sort(L.사람정렬);
  const isProj = !!preset.projectId;
  openModal(isProj ? '프로젝트 방 추가' : '대화상대 선택',
    `<div class="fg"><label class="fl">채팅방 이름 ${isProj ? '' : '(선택)'}</label><input class="fi" id="grpName" value="${esc(preset.name || '')}" placeholder="${isProj ? '예: ○○공사 · 품질' : '비우면 대화상대 이름으로 만듭니다'}"></div>
     ${사람고르기HTML(users, 'pickMember', new Set(preset.members || []))}`,
    async () => {
      const name = $('#grpName').value.trim();
      const members = $$('input[name="pickMember"]:checked').map((c) => c.value);
      if (!members.length) { 토스트('대화상대를 1명 이상 선택해 주세요.'); return; }
      if (!isProj && members.length === 1 && !name) { closeModal(); startDM(members[0]); return; }
      const autoName = members.slice(0, 3).map((id) => getU(id).name).join(', ') + (members.length > 3 ? ` 외 ${members.length - 3}명` : '');
      const id = 'g' + Date.now();
      const payload = { name: name || autoName, type: 'group', members: [me(), ...members], createdBy: me(), createdAt: Date.now() };
      if (isProj) payload.projectId = preset.projectId;
      const fb = getFB();
      try {
        if (fb && fb.db) await fb.setDoc(fb.doc(fb.db, 'channels', id), plain(payload));
        state.channels.push({ id, ...payload });
        closeModal(); ui.tab = isProj ? ui.tab : 'chats'; openRoom(id);
        시스템메시지(id, `${나().name}님이 ${members.map((m) => getU(m).name).join(', ')}님을 초대했습니다.`);
      } catch (e) { 토스트('채팅방을 만들지 못했습니다: ' + (e.message || e)); }
    }, '확인');
  const upd = () => { const n = $$('input[name="pickMember"]:checked').length; const ok = $('#mOk'); if (ok) ok.textContent = n ? `${n}명 선택` : '확인'; };
  $('#pickList')?.addEventListener('change', upd); upd();
  setTimeout(() => $('#pickSearch')?.focus(), 50);
}
function 초대하기(cid) {
  const ch = getChannel(cid); if (!ch) return;
  const cur = new Set(ch.members || []);
  const users = 활성사용자().filter((u) => !cur.has(u.id)).sort(L.사람정렬);
  if (!users.length) { 토스트('초대할 수 있는 사람이 없습니다.'); return; }
  openModal('대화상대 초대', 사람고르기HTML(users, 'invMember'), async () => {
    const add = $$('input[name="invMember"]:checked').map((c) => c.value);
    if (!add.length) { 토스트('초대할 사람을 선택해 주세요.'); return; }
    const fb = getFB();
    try {
      const members = Array.from(new Set([...(ch.members || []), ...add]));
      await fb.updateDoc(fb.doc(fb.db, 'channels', cid), plain({ members }));
      ch.members = members; closeModal(); closeDrawer(); 토스트('초대했습니다.'); render('all');
      시스템메시지(cid, `${나().name}님이 ${add.map((m) => getU(m).name).join(', ')}님을 초대했습니다.`);
    } catch (e) { 토스트('초대하지 못했습니다: ' + (e.message || e)); }
  }, '초대');
  const upd = () => { const n = $$('input[name="invMember"]:checked').length; const ok = $('#mOk'); if (ok) ok.textContent = n ? `${n}명 초대` : '초대'; };
  $('#pickList')?.addEventListener('change', upd);
}
function 사람필터(q) {
  const lq = q.trim();
  $$('#pickList .msg-pick').forEach((el) => {
    const r = lq ? L.이름일치(el.dataset.name || '', lq, [el.dataset.sub || '']) : 1;
    el.style.display = r > 0 ? '' : 'none';
  });
}

// ───────────────────────────── 동작(쓰기) ─────────────────────────────
// 전송 뒤 채널 문서에 마지막 말을 남겨 두면, 500건 창 밖으로 밀린 방도 목록에서 미리보기·시각이 비지 않는다.
function 마지막말기록(ch, payload) {
  const fb = getFB(); if (!fb || !fb.db || !ch || ch.id === AI_CID) return;   // AI 방 미리보기를 channels 에 쓰면 전 직원이 읽는다
  const doc_ = { lastText: L.미리보기(payload), lastAt: payload.createdAt, lastAuthor: payload.author };
  if (ch.가상) Object.assign(doc_, { name: ch.name, type: ch.type }, ch.deptId ? { deptId: ch.deptId } : {}, ch.projectId ? { projectId: ch.projectId } : {});
  fb.setDoc(fb.doc(fb.db, 'channels', ch.id), plain(doc_), { merge: true }).catch((e) => console.warn('[마지막말]', e && e.message));
}
async function 시스템메시지(cid, text) {
  const fb = getFB(); if (!fb || !fb.db || !me()) return;
  const createdTs = Date.now(), clientId = 새clientId(createdTs);
  const payload = { channel: String(cid), author: String(me()), text: String(text), type: 'system', system: true, clientId: String(clientId), at: nowStamp(), createdAt: createdTs };
  try { await fb.setDoc(fb.doc(fb.db, 'messages', 'msg_' + clientId), plain(payload)); 마지막말기록(getChannel(cid), payload); } catch (e) { console.warn('[시스템 메시지]', e && e.message); }
}
async function startDM(otherId) {
  const my = me();
  const self = otherId === my;
  let dm = state.channels.find((c) => c.type === 'dm' && (c.members || []).includes(my)
    && (self ? (c.members || []).every((m) => m === my) : (c.members || []).includes(otherId)));
  if (!dm) {
    dm = { id: 'dm' + Date.now(), name: self ? '나와의 채팅' : 'DM', type: 'dm', members: self ? [my] : [my, otherId], createdBy: my, createdAt: Date.now() };
    state.channels.push(dm);
    const fb = getFB();
    if (fb && fb.db) fb.setDoc(fb.doc(fb.db, 'channels', dm.id), plain({ name: dm.name, type: dm.type, members: dm.members, createdBy: my, createdAt: dm.createdAt }))
      .catch((e) => 토스트('채팅방 생성 실패: ' + (e.message || e)));
  }
  closeModal(); closeSheet(); closeDrawer();
  ui.tab = 'chats';
  openRoom(dm.id);
}
async function 저장(pendingMsg, payload, docId) {
  const fb = getFB();
  if (fb && fb.db) await fb.setDoc(fb.doc(fb.db, 'messages', docId), plain(payload));
  마지막말기록(getChannel(payload.channel), payload);
}
async function sendMsg() {
  const inp = $('#msgInput'); const text = inp ? inp.value.trim() : '';
  if (!text) return;
  const me_ = me();
  if (!me_) { 토스트('로그인이 필요합니다.'); return; }
  const chId = ui.cid; if (!chId) return;
  inp.value = ''; 입력높이(inp); 전송준비표시();
  if (chId === AI_CID) { AI에게묻기(text); return; }
  const ch_ = getChannel(chId);
  if (ch_ && ch_.type === 'announce' && !L.공지쓰기가능(나())) { 토스트('공지는 부서장 이상만 올릴 수 있습니다.'); return; }
  const createdTs = Date.now();
  // W1 데이터 모델: clientId = 보낸 쪽이 정하는 고유번호. 문서 id 를 여기서 만들기 때문에
  // 같은 clientId 로 다시 보내면 같은 문서를 덮어쓴다 → 재시도해도 두 번 안 찍힌다(실패 말풍선의 "다시 보내기" 가 이걸 쓴다).
  const clientId = 새clientId(createdTs);
  const docId = 'msg_' + clientId;
  const rawPayload = { channel: String(chId), author: String(me_), text: String(text), type: 'text', clientId: String(clientId), at: String(nowStamp()), createdAt: Number(createdTs) };
  const pend = { id: 'pending_' + clientId, ...rawPayload, _pending: true, _docId: docId, _payload: rawPayload };
  state.pending.push(pend);
  renderMessages(false);
  try { await 저장(pend, rawPayload, docId); state.pending = state.pending.filter((m) => m !== pend); }
  catch (e) { console.error('[전송] 실패', e); pend._pending = false; pend._failed = true; 토스트('메시지를 보내지 못했습니다. 네트워크를 확인해 주세요.'); }
  renderMessages(true);
}
async function 재전송(tempId) {
  const pend = state.pending.find((m) => m.id === tempId); if (!pend) return;
  pend._failed = false; pend._pending = true; renderMessages(true);
  try { await 저장(pend, pend._payload, pend._docId); state.pending = state.pending.filter((m) => m !== pend); }
  catch (e) { pend._pending = false; pend._failed = true; 토스트('다시 보내지 못했습니다.'); }
  renderMessages(true);
}
async function sendFiles(fileList) {
  const files = Array.from(fileList || []); if (!files.length) return;
  const me_ = me();
  if (!me_) { 토스트('로그인이 필요합니다.'); return; }
  const chId = ui.cid; if (!chId) return;
  const oversized = files.filter((f) => f.size > MSG_FILE_MAX_MB * 1024 * 1024);
  if (oversized.length) { 토스트(`${MSG_FILE_MAX_MB}MB 이하 파일만 보낼 수 있습니다: ` + oversized.map((f) => f.name).join(', ')); return; }
  const fb = getFB();
  if (!fb || !fb.storage || !fb.db) { 토스트('지금은 파일을 보낼 수 없습니다.'); return; }
  ui.uploading = true;
  for (const f0 of files) {
    let f = f0;
    try { f = await L.사진줄이기(f0, 1280, 0.8); } catch (e) { f = f0; }   // 카메라 원본(3~12MB)은 현장 4G 에서 15초 안에 못 올린다
    const kb = f.size / 1024, size = kb >= 1024 ? (kb / 1024).toFixed(1) + 'MB' : kb.toFixed(0) + 'KB';
    const createdTs = Date.now();
    const clientId = 새clientId(createdTs);
    const docId = 'msg_' + clientId;
    const pend = { id: 'pending_' + clientId, channel: chId, author: me_, file: f.name || f0.name, fileSize: size, type: (f0.type || '').indexOf('image/') === 0 ? 'image' : 'file', at: nowStamp(), createdAt: createdTs, _pending: true };
    state.pending.push(pend);
    renderMessages(false);
    try {
      const storageRef = fb.ref(fb.storage, `messages/${chId}/${createdTs}_${f.name || f0.name}`);
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('업로드가 15초 안에 끝나지 않았습니다(사내망에서 저장소가 막혀 있을 수 있습니다).')), 15000));
      await Promise.race([fb.uploadBytes(storageRef, f), timeout]);
      const fileUrl = await fb.getDownloadURL(storageRef);
      const rawPayload = {
        channel: String(chId), author: String(me_), file: String(f.name || f0.name), fileUrl: String(fileUrl), fileSize: String(size),
        type: (f.type || '').indexOf('image/') === 0 ? 'image' : 'file',
        clientId: String(clientId), at: String(nowStamp()), createdAt: Number(createdTs),
      };
      await fb.setDoc(fb.doc(fb.db, 'messages', docId), plain(rawPayload));
      마지막말기록(getChannel(chId), rawPayload);
    } catch (e) {
      console.error('[첨부] 실패', e); 토스트(`"${f0.name}" 을 올리지 못했습니다. 다시 시도해 주세요.`, 4000);
    } finally {
      state.pending = state.pending.filter((m) => m !== pend);
      renderMessages(true);
    }
  }
  ui.uploading = false;
}
async function deleteMsg(mid) {
  const m = state.messages.find((x) => x.id === mid); if (!m || m.author !== me()) return;
  if (!confirm('이 메시지를 삭제할까요?\n모든 대화 상대에게서 삭제됩니다.')) return;
  const fb = getFB();
  try {
    if (fb && fb.db) await fb.deleteDoc(fb.doc(fb.db, 'messages', mid));
    state.messages = state.messages.filter((x) => x.id !== mid); 메시지색인(); renderMessages(true); 토스트('삭제했습니다.');
  } catch (e) { 토스트('삭제하지 못했습니다. 다시 시도해 주세요.'); console.warn(e); }
}
async function leaveChannel(cid) {
  const ch = getChannel(cid); if (!ch) return;
  const fb = getFB();
  if (ch.type === 'dm') {
    // 카톡처럼: 1:1 방 나가기 = 내 목록에서 숨기기. 상대가 새 메시지를 보내면 같은 방이 다시 뜬다(기록이 갈라지지 않는다).
    if (!confirm('이 채팅방을 목록에서 지울까요?\n새 메시지가 오면 다시 표시됩니다.')) return;
    const now = Date.now(); state.hidden[cid] = now; ui.opened.delete(cid);
    try { if (fb && fb.db) await fb.setDoc(fb.doc(fb.db, 'channelReads', cid + '_' + me()), plain({ channel: String(cid), uid: String(me()), hidden: now }), { merge: true }); }
    catch (e) { console.warn('[숨김]', e && e.message); }
    closeDrawer(); closeSheet();
    if (ui.cid === cid) closeRoom(false); else render('all');
    return;
  }
  if (!Array.isArray(ch.members)) return;
  if (!confirm(`'${방이름(ch)}' 채팅방을 나갈까요?\n나가면 이 채팅방의 대화 내용을 다시 볼 수 없습니다.`)) return;
  try {
    const members = ch.members.filter((m) => m !== me());
    await fb.updateDoc(fb.doc(fb.db, 'channels', cid), plain({ members }));
    시스템메시지(cid, `${나().name}님이 나갔습니다.`);
    ch.members = members; ui.opened.delete(cid); closeDrawer(); closeSheet();
    if (ui.cid === cid) closeRoom(false); else render('all');
    토스트('채팅방을 나갔습니다.');
  } catch (e) { 토스트('채팅방을 나가지 못했습니다. 다시 시도해 주세요.'); console.warn(e); }
}
async function togglePin(cid) {
  const next = !state.pins[cid];
  state.pins[cid] = next; if (!next) delete state.pins[cid];
  closeSheet(); closeDrawer(); render('all');
  const fb = getFB(); if (!fb || !fb.db) return;
  fb.setDoc(fb.doc(fb.db, 'channelReads', cid + '_' + me()), plain({ channel: String(cid), uid: String(me()), pinned: next }), { merge: true })
    .catch((e) => 토스트('고정 상태를 저장하지 못했습니다: ' + (e.message || e)));
  토스트(next ? '채팅방을 상단에 고정했습니다.' : '고정을 해제했습니다.');
}
async function 프로필저장(fields) {
  const fb = getFB(); if (!fb || !fb.db || !me()) return;
  await fb.setDoc(fb.doc(fb.db, 프로필컬렉션, me()), plain({ uid: me(), ...fields, updatedAt: Date.now() }), { merge: true });
}
async function changePhoto(file) {
  if (!file) return;
  토스트('사진을 올리는 중…');
  try {
    const dataUrl = await L.이미지축소(file, 192, 0.82, 20 * 1024);
    if (dataUrl.length * 0.75 > 40 * 1024) { 토스트('사진을 줄이지 못했습니다. 다른 사진을 선택해 주세요.'); return; }
    await 프로필저장({ photo: dataUrl });
    state.photos[me()] = dataUrl; render('all'); 토스트('프로필 사진을 바꿨습니다.');
  } catch (e) { 토스트('사진을 저장하지 못했습니다. 다시 시도해 주세요.'); console.warn(e); }
}
async function removePhoto() {
  try { await 프로필저장({ photo: '' }); delete state.photos[me()]; render('all'); 토스트('기본 이미지로 바꿨습니다.'); }
  catch (e) { 토스트('지우지 못했습니다. 다시 시도해 주세요.'); console.warn(e); }
}
async function 전화저장(v) {
  const phone = String(v || '').replace(/[^\d+]/g, '').replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (phone === (state.phones[me()] || '')) return;
  try { await 프로필저장({ phone }); if (phone) state.phones[me()] = phone; else delete state.phones[me()]; 토스트(phone ? '전화번호를 저장했습니다.' : '전화번호를 지웠습니다.'); }
  catch (e) { 토스트('전화번호를 저장하지 못했습니다.'); console.warn(e); }
}
async function logout() {
  if (!confirm('로그아웃할까요?')) return;
  try { await window.fb.signOut(window.fb.auth); } catch (e) { /* 무시 */ }
  구독해제(); state.me = null; 관문(false);
}

// ───────────────────────────── AI 비서 방 ─────────────────────────────
// 화면은 다른 방과 똑같다. 다른 건 셋뿐이다.
//   ① 대화가 messages 가 아니라 t_aiChat 에 쌓인다(본인만 읽고 쓴다 — ai.js 머리말 참고)
//   ② 보내면 상대가 사람이 아니라 게이트웨이다
//   ③ 답에 표·글머리표가 있어서 말풍선이 서식을 그린다(lib.js 서식)
function 내권한() {
  const u = 나();
  return { ...L.AI권한(u), 이름: u.name || '', 직급: u.title || '' };
}
// 질문할 때마다 "이 사람이 볼 수 있는 것"만 추려 함께 넣는다. 도구 호출 대신 맥락 주입 —
// 회사(Gemini·Groq·Cerebras)마다 함수 호출 형식이 달라서, 셋을 다 맞추면 코드가 세 배가 된다.
// 내 업무·일정은 메신저가 구독하지 않는 컬렉션이라 물어볼 때 한 번만 읽는다(구독하면 70명 × 상시 = 비용).
// 실패하면 그냥 빼고 답한다 — 업무를 못 읽었다고 대화가 멈추면 안 된다.
async function 내업무일정() {
  const fb = getFB(); const 줄 = [];
  if (!fb || !fb.db || !fb.getDocs) return 줄;
  try {
    const s = await fb.getDocs(fb.query(fb.collection(fb.db, 'tasks'), fb.where('assignee', '==', me()), fb.limit(100)));
    const 남은 = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => !t.done && t.status !== 'done' && t.status !== '완료');
    if (남은.length) {
      줄.push(`\n## 내 업무 ${남은.length}건 (안 끝난 것)`);
      남은.slice(0, 40).forEach((t) => 줄.push([t.title, t.status && ('상태 ' + t.status), t.due && ('마감 ' + t.due)].filter(Boolean).join(' · ')));
    }
  } catch (e) { console.warn('[AI 업무]', e && e.message); }
  try {
    const 오늘 = new Date().toISOString().slice(0, 10);
    const s = await fb.getDocs(fb.query(fb.collection(fb.db, 'events'), fb.where('date', '>=', 오늘), fb.orderBy('date'), fb.limit(60)));
    // 캘린더가 보여 주는 것과 같은 기준: 내 부서 일정 + 내가 만든 것. 등급과 무관하게 이 기준을 그대로 쓴다.
    const 내것 = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => e.dept === 나().dept || e.createdBy === me());
    if (내것.length) {
      줄.push(`\n## 앞으로의 일정 ${내것.length}건 (내 부서·내가 만든 것)`);
      내것.slice(0, 30).forEach((e) => 줄.push([e.date, e.time, e.title, e.dept].filter(Boolean).join(' · ')));
    }
  } catch (e) { console.warn('[AI 일정]', e && e.message); }
  return 줄;
}
async function AI맥락(문서) {
  const perm = 내권한();
  const 줄 = [];
  const 사람 = 활성사용자().filter((u) => perm.범위 === '전사' || u.dept === perm.dept || u.id === me());
  줄.push(`## 직원 ${사람.length}명 (내 권한 범위)`);
  줄.push(사람.slice(0, 80).map((u) => [u.name, u.title, u.dept, state.phones[u.id]].filter(Boolean).join(' ')).join('\n'));
  const 프 = 보이는프로젝트().filter((pj) => {
    if (perm.범위 === '전사') return true;
    const mem = 방멤버(프로젝트기본방(pj));
    return mem.includes(me()) || (perm.범위 === '부서' && mem.some((uid) => getU(uid).dept === perm.dept));
  });
  줄.push(`\n## 프로젝트 ${프.length}건 (내 권한 범위)`);
  줄.push(프.slice(0, 40).map((pj) => [pj.code, pj.name, pj.client, pj.status && ('상태 ' + pj.status), pj.pm && ('PM ' + getU(pj.pm).name)].filter(Boolean).join(' · ')).join('\n'));
  줄.push(...await 내업무일정());
  if (문서 && 문서.length) {
    줄.push('\n## 사내 문서에서 찾은 부분 (답의 근거로 쓰고, 문서 이름을 밝힐 것)');
    문서.forEach((m) => 줄.push(`[${m.docName || '문서'}] ${String(m.text || '').slice(0, 700)}`));
    // 도면이 붙는다는 걸 알려 준다. 안 알려 주면 "그림 보여달라" 는 물음에 **없는 화면 경로를 지어내** 안내한다
    // (2026-09-19 실제로 "왼쪽 메뉴 → 표준·규격" 이라는 없는 메뉴를 만들어 냈다).
    const 붙는그림 = [];
    for (const m of 문서) for (const g of (m.images || [])) if (붙는그림.length < 2) 붙는그림.push(g);
    if (붙는그림.length) {
      줄.push(`\n## 이 답변 **바로 아래에 도면이 함께 표시된다**: ${붙는그림.map((g) => 'Figure ' + (g.no || '')).join(', ')}`);
      줄.push('그러니 "어디서 찾아보라" 고 안내하지 말고, 그림이 무엇을 보여 주는지·어떻게 읽는지를 설명해라.');
    }
  }
  return 줄.join('\n').slice(0, 8000);
}
const AI히스토리 = () => state.aiMsgs.filter((m) => !m.실패).map((m) => ({ role: m.role === 'ai' ? 'ai' : 'user', text: m.text }));
async function AI쓰기(obj) {
  const fb = getFB(); if (!fb || !fb.db) throw new Error('저장소에 연결되어 있지 않습니다.');
  const ts = Number(obj.createdAt) || Date.now();
  const id = `ai_${me()}_${ts}_${Math.random().toString(36).slice(2, 6)}`;
  await fb.setDoc(fb.doc(fb.db, AI_컬렉션, id), plain({ ...obj, uid: String(me()) }));
  return id;
}
async function AI에게묻기(질문) {
  const me_ = me(); const fb = getFB();
  if (ui.aiThinking) { 토스트('아직 답하는 중입니다.'); return; }
  const 물음 = String(질문).slice(0, 4000);
  const ts = Date.now();
  const 내말 = { author: String(me_), role: 'user', text: 물음, type: 'text', at: nowStamp(), createdAt: ts };
  // 보낸 티는 바로 낸다(느린 망에서도). 저장이 끝나면 구독 스냅샷이 진짜 문서로 갈아끼운다.
  const pend = { id: 'pending_ai_' + ts, channel: AI_CID, ...내말, _pending: true };
  state.pending.push(pend);
  ui.aiThinking = true; renderMessages(false);
  const 치우기 = () => { state.pending = state.pending.filter((m) => m !== pend); };
  try { await AI쓰기(내말); 치우기(); }
  catch (e) {
    console.error('[AI] 질문 저장 실패', e);
    pend._pending = false; pend._failed = true; ui.aiThinking = false; renderMessages(true);
    토스트('질문을 저장하지 못했습니다.'); return;
  }
  renderMessages(false);
  try {
    const 문서 = await 사내문서(물음, fb);
    const 답 = await 답하기({ 질문: 물음, 히스토리: AI히스토리().slice(0, -1), 맥락: await AI맥락(문서), 권한: 내권한(), fb });
    // 근거로 쓴 조각에 딸린 도면(ASME 그림)을 같이 남긴다. 점수 높은 것부터 두 장까지 —
    // 더 붙이면 말풍선이 그림으로 뒤덮여 정작 답이 안 보인다.
    const 그림 = [];
    for (const m of 문서) for (const g of (m.images || [])) {
      if (그림.length < 2 && !그림.some((x) => x.url === g.url)) 그림.push(g);
    }
    await AI쓰기({ author: AI_UID, role: 'ai', text: 답.text, type: 'text', md: true, model: 답.model,
      sources: [...new Set(문서.map((m) => m.docName).filter(Boolean))].slice(0, 4),
      ...(그림.length ? { 그림 } : {}), at: nowStamp(), createdAt: Date.now() });
  } catch (e) {
    // warn 이지 error 가 아니다: 여기 오는 건 "한도 초과·로그인 만료·시간 초과" 처럼 늘 있을 수 있는 일이고,
    // 사용자에게는 아래에서 말풍선으로 그대로 보여 준다. error 는 진짜 예상 못 한 것에만 남긴다(시험대가 error 0건을 본다).
    console.warn('[AI]', e && e.message ? e.message : e);
    // 오류도 대화에 남긴다 — 왜 답이 없었는지 나중에 봐야 한다. 실패한 줄은 다음 질문의 맥락에서 뺀다.
    try { await AI쓰기({ author: AI_UID, role: 'ai', text: String(e && e.message || e), type: 'text', md: false, 실패: true, at: nowStamp(), createdAt: Date.now() }); }
    catch (e2) { 토스트('AI가 답하지 못했습니다.'); }
  } finally { ui.aiThinking = false; renderMessages(false); 읽음처리(AI_CID); }
}
function AI대화지우기() {
  if (!state.aiMsgs.length) { 토스트('지울 대화가 없습니다.'); return; }
  openModal('새 대화', `지금까지의 AI 대화 ${state.aiMsgs.length}건을 지웁니다. 되돌릴 수 없습니다.`, async () => {
    const fb = getFB(); const 목록 = state.aiMsgs.slice();
    state.aiMsgs = []; renderMessages(true);
    for (const m of 목록) { try { await fb.deleteDoc(fb.doc(fb.db, AI_컬렉션, m.id)); } catch (e) { console.warn('[AI 지우기]', e && e.message); } }
    토스트('대화를 지웠습니다.');
  }, '지우기');
}

// ───────────────────────────── 입력창 ─────────────────────────────
function 입력높이(ta) { if (!ta) return; ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 132) + 'px'; }
function 전송준비표시() { const b = $('[data-act="send"]'); const i = $('#msgInput'); if (b && i) b.classList.toggle('is-ready', !!i.value.trim()); }

// ───────────────────────────── 이벤트 위임 ─────────────────────────────
function 행동(el) {
  const act = el.dataset.act;
  switch (act) {
    case 'tab': ui.tab = el.dataset.tab; ui.search.open = false; closeSheet(); if (ui.layout === 'phone' && ui.cid) { closeRoom(false); } render('all'); break;
    case 'search-open': ui.search.open = true; ui.search.q = ''; ui.search.stab = 'all'; render('pane'); break;
    case 'search-close': ui.search.open = false; ui.search.q = ''; render('pane'); break;
    case 'stab': ui.search.stab = el.dataset.stab; render('pane'); break;
    case 'chip': ui.chip = el.dataset.chip; render('pane'); break;
    case 'jump': {
      const keys = L.색인키; let i = keys.indexOf(el.dataset.key); let sec = null;
      for (; i < keys.length && !sec; i++) sec = $(`.sjm-sec[data-key="${CSS.escape(keys[i])}"]`);   // 빈 초성은 다음 있는 섹션으로
      if (sec) { const scr = sec.closest('.sjm-screen'); if (scr) scr.scrollTop = sec.offsetTop - 4; }
      break;
    }
    case 'user': 프로필시트(el.dataset.uid); break;
    case 'dm': startDM(el.dataset.uid); break;
    case 'mail': if (el.dataset.mail) location.href = 'mailto:' + el.dataset.mail; break;
    case 'call': if (el.dataset.tel) location.href = 'tel:' + el.dataset.tel.replace(/[^\d+]/g, ''); break;
    case 'open': openRoom(el.dataset.cid); break;
    case 'hit': openRoom(el.dataset.cid, { mid: el.dataset.mid }); break;
    case 'back': closeRoom(false); break;
    case 'new-chat': 새채팅(); break;
    case 'proj-group': ui.projCollapsed[el.dataset.status] = !ui.projCollapsed[el.dataset.status]; render('pane'); break;
    case 'proj': {
      const p = state.projects.find((x) => x.id === el.dataset.pid); if (!p) break;
      const rooms = 프로젝트방들(p);
      if (rooms.length === 1 && !ui.projOpen[p.id]) { openRoom(rooms[0].id); break; }   // 방이 하나뿐이면 바로 들어간다
      ui.projOpen[p.id] = !ui.projOpen[p.id]; render('pane'); break;
    }
    case 'proj-new-room': { const p = state.projects.find((x) => x.id === el.dataset.pid); if (!p) break; const members = 방멤버(프로젝트기본방(p)).filter((u) => u !== me()); 새채팅({ projectId: p.id, name: (p.name || p.code || '프로젝트') + ' · ', members }); break; }
    case 'photo-menu': openSheet(`<div class="sjm-sheet-title">프로필 사진</div>${항목('photo-pick', ICON.image, '앨범에서 선택')}${항목('photo-shoot', ICON.camera, '사진 촬영')}${state.photos[me()] ? 항목('photo-remove', ICON.refresh, '기본 이미지로 변경') : ''}<button class="sjm-sheet-cancel" data-act="sheet-close">취소</button>`); break;
    case 'photo-pick': closeSheet(); $('#photoInput').value = ''; $('#photoInput').click(); break;
    case 'photo-shoot': closeSheet(); $('#photoCamera').value = ''; $('#photoCamera').click(); break;
    case 'photo-remove': closeSheet(); removePhoto(); break;
    case 'logout': logout(); break;
    case 'room-search': ui.rs.open = true; ui.rs.q = ''; ui.rs.hits = []; ui.rs.idx = 0; render('room'); setTimeout(() => $('#roomSearchInput')?.focus(), 30); break;
    case 'rs-close': ui.rs = { open: false, q: '', hits: [], idx: 0 }; render('room'); break;
    case 'rs-prev': if (ui.rs.hits.length) { ui.rs.idx = (ui.rs.idx - 1 + ui.rs.hits.length) % ui.rs.hits.length; renderRoomSearchCount(); 검색위치이동(true); } break;
    case 'rs-next': if (ui.rs.hits.length) { ui.rs.idx = (ui.rs.idx + 1) % ui.rs.hits.length; renderRoomSearchCount(); 검색위치이동(true); } break;
    case 'room-menu':
      if (ui.cid === AI_CID) { openSheet(`<div class="sjm-sheet-title">AI 비서</div>${항목('ai-clear', ICON.refresh, '새 대화 (지금까지 대화 지우기)', '', 'is-danger')}<button class="sjm-sheet-cancel" data-act="sheet-close">취소</button>`); break; }
      renderDrawer(); break;
    case 'ai-clear': closeSheet(); AI대화지우기(); break;
    case 'drawer-close': closeDrawer(); break;
    case 'invite': closeDrawer(); 초대하기(el.dataset.cid); break;
    case 'leave': leaveChannel(el.dataset.cid); break;
    case 'pin': togglePin(el.dataset.cid); break;
    case 'attach': {
      if (ui.uploading) { 토스트('아직 이전 파일을 보내는 중입니다.'); break; }
      if (ui.layout === 'desk') { $('#fileInput').value = ''; $('#fileInput').click(); break; }
      openSheet(`<div class="sjm-sheet-title">보내기</div>${항목('pick-album', ICON.image, '앨범')}${항목('pick-camera', ICON.camera, '카메라')}${항목('pick-file', ICON.clip, '파일')}<button class="sjm-sheet-cancel" data-act="sheet-close">취소</button>`); break;
    }
    case 'pick-camera': closeSheet(); $('#cameraInput').value = ''; $('#cameraInput').click(); break;
    case 'pick-album': closeSheet(); $('#albumInput').value = ''; $('#albumInput').click(); break;
    case 'pick-file': closeSheet(); $('#fileInput').value = ''; $('#fileInput').click(); break;
    case 'send': sendMsg(); break;
    case 'retry': closeSheet(); 재전송(el.dataset.mid); break;
    case 'discard': closeSheet(); state.pending = state.pending.filter((m) => m.id !== el.dataset.mid); renderMessages(true); break;
    case 'jump-bottom': { const b = $('#roomBody'); if (b) b.scrollTop = b.scrollHeight; el.hidden = true; 읽음처리(ui.cid); break; }
    case 'view-img': { const v = $('#viewer'); v.innerHTML = `<div class="sjm-viewer-bar"><button class="sjm-icon-btn" data-act="viewer-close" aria-label="닫기">${ICON.x}</button><a class="sjm-icon-btn" href="${esc(el.src)}" download target="_blank" rel="noopener" aria-label="저장">${ICON.download}</a></div><img src="${esc(el.src)}" alt="">`; v.classList.add('is-open'); break; }
    case 'viewer-close': $('#viewer').classList.remove('is-open'); break;
    case 'copy': { const m = 메시지찾기(el.dataset.mid); closeSheet(); if (m && m.text) navigator.clipboard?.writeText(m.text).then(() => 토스트('복사했습니다.'), () => 토스트('복사하지 못했습니다.')); break; }
    case 'delete': closeSheet(); deleteMsg(el.dataset.mid); break;
    case 'sheet-close': closeSheet(); break;
    case 'modal-close': closeModal(); break;
    default: break;
  }
}
function 길게누름(el) {
  const kind = el.dataset.long;
  if (kind === 'chat') {
    const cid = el.dataset.cid, ch = getChannel(cid); if (!ch) return;
    const canLeave = (ch.type === 'dm' || ch.type === 'group') && !ch.가상;
    openSheet(`<div class="sjm-sheet-title">${esc(방이름(ch))}</div>
      ${항목('pin', ICON.pin, state.pins[cid] ? '채팅방 상단 고정 해제' : '채팅방 상단 고정', `data-cid="${esc(cid)}"`)}
      ${canLeave ? 항목('leave', ICON.logout, '나가기', `data-cid="${esc(cid)}"`, 'is-danger') : ''}
      <button class="sjm-sheet-cancel" data-act="sheet-close">취소</button>`);
  } else if (kind === 'msg-failed') {
    openSheet(`${항목('retry', ICON.refresh, '다시 보내기', `data-mid="${esc(el.dataset.mid)}"`)}${항목('discard', ICON.trash, '삭제', `data-mid="${esc(el.dataset.mid)}"`, 'is-danger')}<button class="sjm-sheet-cancel" data-act="sheet-close">취소</button>`);
  } else if (kind === 'msg' || kind === 'msg-me') {
    const mid = el.dataset.mid; const m = 메시지찾기(mid); if (!m) return;
    const items = `${m.text ? 항목('copy', ICON.copy, '복사', `data-mid="${esc(mid)}"`) : ''}${kind === 'msg-me' ? 항목('delete', ICON.trash, '삭제', `data-mid="${esc(mid)}"`, 'is-danger') : ''}`;
    if (!items) return;
    openSheet(`${items}<button class="sjm-sheet-cancel" data-act="sheet-close">취소</button>`);
  }
}
function 이벤트연결() {
  // 스크롤바는 굴릴 때만 잠깐 보인다(CSS 의 .is-scrolling). scroll 은 위로 안 올라오므로 캡처 단계로 받는다 —
  // 그래야 목록·방 본문·서랍처럼 안쪽에서 구르는 것까지 한 곳에서 잡힌다.
  const 스크롤타이머 = new WeakMap();
  document.addEventListener('scroll', (e) => {
    const el = (e.target && e.target.classList) ? e.target : document.documentElement;
    el.classList.add('is-scrolling');
    clearTimeout(스크롤타이머.get(el));
    스크롤타이머.set(el, setTimeout(() => el.classList.remove('is-scrolling'), 900));
  }, true);
  document.addEventListener('click', (e) => {
    if (ui.suppressClick && Date.now() < ui.suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
    const failed = e.target.closest('.sjm-msg.is-failed');
    if (failed && !e.target.closest('[data-act]')) { 길게누름(failed); return; }
    const el = e.target.closest('[data-act]');
    if (el) { if (el.tagName === 'A' && el.dataset.act === 'view-img') e.preventDefault(); 행동(el); return; }
    if (e.target === $('#modal')) closeModal();
  });
  // 길게 누르기(폰) · 우클릭(데스크톱) → 같은 시트
  let lp = null;
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-long]'); if (!el || e.button !== 0) return;
    const x = e.clientX, y = e.clientY;
    lp = { el, x, y, tm: setTimeout(() => { lp = null; ui.suppressClick = Date.now() + 600; 길게누름(el); }, 500) };
  }, { passive: true });
  const cancelLp = (e) => { if (!lp) return; if (e.type === 'pointermove' && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) < 10) return; clearTimeout(lp.tm); lp = null; };
  document.addEventListener('pointermove', cancelLp, { passive: true });
  document.addEventListener('pointerup', cancelLp, { passive: true });
  document.addEventListener('pointercancel', cancelLp, { passive: true });
  document.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('[data-long]'); if (!el) return;
    e.preventDefault(); if (lp) { clearTimeout(lp.tm); lp = null; }
    if (ui.suppressClick && Date.now() < ui.suppressClick) return;   // 안드로이드: 길게 누르기와 contextmenu 가 둘 다 온다
    ui.suppressClick = Date.now() + 600; 길게누름(el);
  });
  const onSearchInput = (t) => {
    if (t.id === 'msgInput') { 입력높이(t); 전송준비표시(); }
    else if (t.id === 'searchInput') { ui.search.q = t.value; renderSearchOnly(); }
    else if (t.id === 'roomSearchInput') { ui.rs.q = t.value; 방검색갱신(); }
    else if (t.id === 'pickSearch') { 사람필터(t.value); }
  };
  document.addEventListener('input', (e) => onSearchInput(e.target));
  document.addEventListener('compositionend', (e) => { if (e.target.id !== 'msgInput') onSearchInput(e.target); });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.id === 'msgInput' && e.key === 'Enter') {
      if (e.isComposing) return;                              // 한글 조합 중 Enter → 이중 전송 방지
      if (ui.layout === 'desk' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
      return;
    }
    if (t.id === 'phoneInput' && e.key === 'Enter') { e.preventDefault(); t.blur(); return; }
    if (t.id === 'roomSearchInput' && e.key === 'Enter') { e.preventDefault(); 행동({ dataset: { act: e.shiftKey ? 'rs-prev' : 'rs-next' } }); return; }
    if (t.id === 'searchInput' && e.key === 'Escape') { 행동({ dataset: { act: 'search-close' } }); return; }
    if (e.key === 'Escape') { if ($('#viewer').classList.contains('is-open')) $('#viewer').classList.remove('is-open'); else if ($('#sheet').classList.contains('is-open')) closeSheet(); else if ($('#drawer')?.classList.contains('is-open')) closeDrawer(); else if ($('#modal').classList.contains('active')) closeModal(); else if (ui.rs.open) 행동({ dataset: { act: 'rs-close' } }); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'photoInput' || t.id === 'photoCamera') changePhoto(t.files && t.files[0]);
    else if (t.id === 'fileInput' || t.id === 'cameraInput' || t.id === 'albumInput') sendFiles(t.files);
    else if (t.id === 'phoneInput') 전화저장(t.value);
  });
  document.addEventListener('focusout', (e) => { if (e.target.id === 'phoneInput') 전화저장(e.target.value); });
  document.addEventListener('scroll', (e) => {
    if (e.target && e.target.id === 'roomBody') {
      const b = e.target; const atBottom = b.scrollHeight - b.scrollTop - b.clientHeight < 60;
      if (atBottom) { const chip = $('.sjm-new-chip'); if (chip && !chip.hidden) { chip.hidden = true; 읽음처리(ui.cid); } }
    }
  }, true);
  // 드래그앤드롭(데스크톱)
  document.addEventListener('dragover', (e) => { if (!ui.cid || !e.target.closest('#room')) return; e.preventDefault(); $('#dropHint').classList.add('is-show'); });
  document.addEventListener('dragleave', (e) => { if (e.target.closest && e.target.closest('#room') && !e.relatedTarget?.closest?.('#room')) $('#dropHint').classList.remove('is-show'); });
  document.addEventListener('drop', (e) => { if (!e.target.closest('#room')) return; e.preventDefault(); $('#dropHint').classList.remove('is-show'); if (ui.cid && e.dataTransfer?.files?.length) sendFiles(e.dataTransfer.files); });
  window.addEventListener('popstate', () => { if (독립실행 && ui.cid) { ui.pushed = false; closeRoom(true); } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ui.cid) { const b = $('#roomBody'); if (b && b.scrollHeight - b.scrollTop - b.clientHeight < 60) 읽음처리(ui.cid); } });
  window.addEventListener('online', () => { const o = $('#offline'); if (o) o.hidden = true; });
  window.addEventListener('offline', () => { const o = $('#offline'); if (o) o.hidden = false; });
  // iOS 독립실행에서 키보드가 올라오면 화면 높이를 보이는 영역에 맞춘다(입력바가 키보드 뒤로 숨지 않게).
  if (독립실행 && window.visualViewport) {
    const fit = () => {
      const app = $('#app'); if (!app) return; const h = window.visualViewport.height;
      const 키보드 = h < window.innerHeight - 1;
      app.style.height = 키보드 ? h + 'px' : '';
      if (키보드) { window.scrollTo(0, 0); const b = $('#roomBody'); if (b && ui.cid) b.scrollTop = b.scrollHeight; }
    };
    window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit);
  }
  const mq = window.matchMedia('(min-width: 900px)');
  const onLayout = () => { const next = mq.matches ? 'desk' : 'phone'; if (next === ui.layout) return; ui.layout = next; ensureShell(true); render('all'); };
  (mq.addEventListener ? mq.addEventListener('change', onLayout) : mq.addListener(onLayout));
}
function renderSearchOnly() {
  if (!ui.search.open) return;
  const el = $('.sjm-screen[data-screen="search"]'); if (!el) return;
  const st = el.scrollTop; el.innerHTML = 검색화면(); el.scrollTop = st;
}

// ───────────────────────────── 구독 ─────────────────────────────
function 구독해제() { 구독.기본.forEach((u) => { try { u(); } catch (e) { /* 무시 */ } }); 구독.기본 = []; if (구독.방) { try { 구독.방(); } catch (e) { /* 무시 */ } 구독.방 = null; } }
function 방읽음구독(cid) {
  if (구독.방) { try { 구독.방(); } catch (e) { /* 무시 */ } 구독.방 = null; }
  state.roomReads = {};
  const fb = getFB(); if (!fb || !fb.db) return;
  try {
    구독.방 = fb.onSnapshot(fb.query(fb.collection(fb.db, 'channelReads'), fb.where('channel', '==', cid)), (snap) => {
      const r = {}; snap.docs.forEach((d) => { const x = d.data(); if (x && x.uid) r[x.uid] = x.lastRead || 0; });
      state.roomReads = r; if (ui.cid === cid) renderMessages(false);
    }, (e) => console.warn('[읽음 구독]', e && e.message));
  } catch (e) { console.warn('[읽음 구독] 실패', e && e.message); }
}
function 구독시작() {
  const fb = getFB(); if (!fb || !fb.db) return;
  구독해제();
  const on = (q, cb, tag) => {
    const 실패 = (e) => {
      console.warn(`[${tag}]`, e && e.message);
      // 메시지 구독이 막히면(규칙·망) "불러오는 중" 에 영영 머물지 않게 — 방 목록은 미리보기 없이라도 보여준다
      if (tag === 'messages' && !state.loaded.messages) { state.loaded.messages = true; renderPane(); }
    };
    try { 구독.기본.push(fb.onSnapshot(q, cb, 실패)); } catch (e) { 실패(e); }
  };
  on(fb.collection(fb.db, 'users'), (snap) => { state.users = snap.docs.map((d) => ({ id: d.id, ...d.data() })); userMap = new Map(state.users.map((u) => [u.id, u])); render('all'); }, 'users');
  on(fb.collection(fb.db, 프로필컬렉션), (snap) => {
    const photos = {}, phones = {};
    snap.docs.forEach((d) => { const x = d.data() || {}; if (x.photo) photos[d.id] = x.photo; if (x.phone) phones[d.id] = x.phone; });
    state.photos = photos; state.phones = phones; render('all');
  }, 'profile');
  on(fb.collection(fb.db, 'channels'), (snap) => { state.channels = snap.docs.map((d) => ({ id: d.id, ...d.data() })); state.loaded.channels = true; render('all'); }, 'channels');
  on(fb.collection(fb.db, 'projects'), (snap) => { state.projects = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render('all'); }, 'projects');
  on(fb.query(fb.collection(fb.db, 'messages'), fb.orderBy('createdAt', 'desc'), fb.limit(메시지창)), (snap) => {
    state.messages = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => L.메시지시각ms(a) - L.메시지시각ms(b));
    state.loaded.messages = true;
    메시지색인(); renderTabs(); renderPane(); if (ui.cid) renderMessages(false);
  }, 'messages');
  // AI 대화 — 내 것만. 규칙(firestore.rules)도 uid 가 나인 문서만 허용하므로 이 조건이 빠지면 조회 자체가 막힌다.
  on(fb.query(fb.collection(fb.db, AI_컬렉션), fb.where('uid', '==', me())), (snap) => {
    state.aiMsgs = snap.docs.map((d) => ({ id: d.id, ...d.data(), channel: AI_CID }))
      .sort((a, b) => L.메시지시각ms(a) - L.메시지시각ms(b));
    renderTabs(); renderPane(); if (ui.cid === AI_CID) renderMessages(false);
  }, 'aichat');
  on(fb.query(fb.collection(fb.db, 'channelReads'), fb.where('uid', '==', me())), (snap) => {
    const reads = {}, pins = {}, hidden = {}, docs = new Set();
    snap.docs.forEach((d) => { const x = d.data(); if (!x || !x.channel) return; docs.add(x.channel); if (x.lastRead) reads[x.channel] = x.lastRead; if (x.pinned) pins[x.channel] = true; if (x.hidden) hidden[x.channel] = x.hidden; });
    // 내가 방금 로컬로 올린 읽음 시각이 서버 값보다 최신이면 그대로 둔다(스냅샷이 옛 값으로 되돌리는 깜빡임 방지)
    for (const k of Object.keys(state.reads)) if ((state.reads[k] || 0) > (reads[k] || 0)) reads[k] = state.reads[k];
    for (const k of Object.keys(state.hidden)) if (!hidden[k] && ui.opened.has(k)) { /* 방금 다시 열어 로컬에서 지운 숨김은 서버 스냅샷을 기다린다 */ }
    state.reads = reads; state.pins = pins; state.hidden = hidden; state.readDocs = docs;
    render('tabs'); if (ui.cid) renderMessages(false);
  }, 'reads');
}

// ───────────────────────────── 관문·부팅 ─────────────────────────────
// Firebase 는 새로고침 직후 currentUser 가 잠깐 null 이다(IndexedDB 복원 전). 그 순간을 로그아웃으로 오해하지 않으려고 첫 상태 1회를 기다린다.
function 첫인증(제한ms) {
  const fb = window.fb;
  if (!fb || !fb.auth || !fb.onAuthStateChanged) return Promise.resolve(null);
  if (fb.auth.currentUser) return Promise.resolve(fb.auth.currentUser);
  return new Promise((resolve) => {
    let 끝 = false;
    const 마치기 = (u) => { if (끝) return; 끝 = true; resolve(u || null); };
    let 그만 = null;
    try { 그만 = fb.onAuthStateChanged(fb.auth, (u) => { try { 그만 && 그만(); } catch (e) { /* 무시 */ } 마치기(u); }); }
    catch (e) { return 마치기(null); }
    setTimeout(() => 마치기(fb.auth.currentUser), 제한ms || 8000);
  });
}
// 로그인 화면은 플랫폼 본진(index.html)에 있다 — OAuth 리디렉션 주소가 사이트 루트 하나로만 등록돼 있어서
// 메신저가 따로 로그인하지 못한다. 루트에 다녀오고 돌아온다(manifest scope 가 "/" 라 앱 안에 머문다).
function 로그인하러() {
  try { sessionStorage.setItem('sjReturnTo', '/modules/messenger/messenger.html'); } catch (e) { /* 무시 */ }
  location.href = '/';
}
function 관문(오프라인) {
  const app = $('#app'); if (!app) return;
  app.innerHTML = `<div class="sjm-gate"><div class="sjm-gate-box"><img src="./icons/icon-192.png" alt="">
      <div class="sjm-gate-title">SJ 메신저</div>
      <div class="sjm-gate-sub">${오프라인 ? '지금 인터넷이 끊겨 있습니다.<br>연결되면 자동으로 들어갑니다.' : '회사 계정(@sejong-21c.com)으로<br>로그인해야 대화를 볼 수 있습니다.'}</div>
      ${오프라인 ? '' : '<button class="sjm-gate-btn" data-act="gate-login">로그인</button>'}</div></div>`;
  if (오프라인) window.addEventListener('online', () => location.reload(), { once: true });
  app.querySelector('[data-act="gate-login"]')?.addEventListener('click', 로그인하러);
}
function getCurrentUserUid() {
  if (state.me) return state.me;
  const ps = 부모상태(); if (ps && ps.currentUser) return ps.currentUser;
  const fb = getFB(); if (fb && fb.auth && fb.auth.currentUser) return fb.auth.currentUser.uid;
  // 예전엔 여기서 'cwkim' 을 돌려줬다(W1 에서 제거). 모르면 모른다고 한다.
  return null;
}
async function boot() {
  // 모듈이 살아났으니 오류 화면은 우리 것으로(껍데기의 임시 핸들러 대체)
  window.onerror = (msg, url, line, col, err) => { console.error('[메신저]', msg, err); 토스트('화면에 문제가 생겼습니다: ' + String(msg).slice(0, 80), 4000); };
  window.addEventListener('unhandledrejection', (e) => { e.preventDefault(); console.error('[메신저 비동기]', e.reason); });

  if (독립실행) {
    const u = await 첫인증(8000);
    if (u && u.uid) state.me = u.uid;
    else { 관문(!navigator.onLine || !window.fb); return; }
  }
  const ps = 부모상태();
  if (ps) {
    if (ps.currentUser) state.me = ps.currentUser;
    if (Array.isArray(ps.users) && ps.users.length) state.users = ps.users.map((u) => ({ ...u }));
    if (Array.isArray(ps.projects) && ps.projects.length) state.projects = ps.projects.map((p) => ({ ...p }));
    if (Array.isArray(ps.pendingUsers)) state.pendingUsers = ps.pendingUsers.map((p) => ({ ...p }));
  }
  state.me = getCurrentUserUid();
  if (!state.me) { 관문(!navigator.onLine); return; }
  userMap = new Map(state.users.map((u) => [u.id, u]));
  ui.layout = window.matchMedia('(min-width: 900px)').matches ? 'desk' : 'phone';
  이벤트연결();
  ensureShell(true);
  render('all');          // 0ms 첫 화면(부모 state 만으로)
  구독시작();
}

// 시험대·디버그용 (읽기 위주)
window.SJM = {
  get state() { return state; }, get ui() { return ui; },
  me: () => me(), open: (cid) => openRoom(cid), close: () => closeRoom(false),
  tab: (t) => 행동({ dataset: { act: 'tab', tab: t } }), search: (q) => { ui.search.open = true; ui.search.q = q; render('pane'); },
  rerender: () => render('all'), version: 버전,
  // 시험용 — AI 에게 실제로 넘어가는 맥락. 권한 밖 자료가 섞이지 않았는지 시험대가 이걸로 본다.
  ai맥락: () => AI맥락([]),
};
window.getCurrentUserUid = getCurrentUserUid;

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
