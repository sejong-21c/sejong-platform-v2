/* SJ 메신저 순수 함수 — 화면 코드(messenger.js)에서 떼어 둔 이유: node 로 검증하려고.
 * 여기서는 window·document 를 최상위에서 건드리지 않는다. 브라우저가 꼭 필요한 두 함수(이미지축소·사진줄이기)만
 * 호출 시점에 확인한다.  검사: node test/messenger-lib.test.mjs
 */

// ───────── 한글 초성 ─────────
export const 초성표 = ['ㄱ', 'ㄴ', 'ㄷ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅅ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
export const 색인키 = [...초성표, ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'];
const 초성19 = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const 기본자음 = { 'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ' };   // 연락처 앱처럼 쌍자음은 기본 자음 칸에
const 음절인가 = (code) => code >= 0xAC00 && code <= 0xD7A3;
const 자음인가 = (code) => code >= 0x3131 && code <= 0x314E;   // 호환 자모 ㄱ~ㅎ (모음 ㅏ~ 는 0x314F 부터)

/** '김철우' → 'ㄱㅊㅇ'. 한글 아닌 글자는 대문자로 그대로. 자음 단독 입력(ㄱ, ㄲ)도 초성으로 본다. */
export function 초성(str) {
  let out = '';
  for (const ch of String(str ?? '')) {
    const code = ch.codePointAt(0);
    if (음절인가(code)) { const c = 초성19[Math.floor((code - 0xAC00) / 588)]; out += 기본자음[c] || c; }
    else if (자음인가(code)) out += 기본자음[ch] || ch;
    else out += ch.toUpperCase();
  }
  return out;
}
/** 색인 섹션 키: '김철우'→'ㄱ' · 'Alice'→'A' · '123'/''→'#' */
export function 섹션키(name) {
  const s = String(name ?? '').trim();
  if (!s) return '#';
  const code = s.codePointAt(0);
  if (음절인가(code) || 자음인가(code)) return 초성(s[0]);
  const up = s[0].toUpperCase();
  return /^[A-Z]$/.test(up) ? up : '#';
}
const 전부자음 = (q) => q.length > 0 && Array.from(q).every((ch) => 자음인가(ch.codePointAt(0)));
/**
 * 검색 순위: 1 접두('김'→김철우) · 2 초성 접두('ㄱㅊ'→김철우, 질의가 전부 자음일 때) · 3 부분('철우') · 4 extra(부서·직급) 부분.
 * 0 = 불일치. 공백 trim, 대소문자 무시.
 */
export function 이름일치(name, query, extra = []) {
  const q = String(query ?? '').trim();
  if (!q) return 0;
  const n = String(name ?? '');
  const lq = q.toLowerCase(), ln = n.toLowerCase();
  if (ln.startsWith(lq)) return 1;
  if (전부자음(q) && 초성(n).startsWith(초성(q))) return 2;
  if (ln.includes(lq)) return 3;
  if ((extra || []).some((x) => String(x ?? '').toLowerCase().includes(lq))) return 4;
  return 0;
}
export function 사람정렬(a, b) {
  return String(a?.name ?? '').localeCompare(String(b?.name ?? ''), 'ko') || String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}
/** 초성표 순 → A~Z → '#' 로 섹션을 나눈다. 빈 섹션은 뺀다. */
export function 섹션나누기(users) {
  const map = new Map();
  for (const u of users || []) { const k = 섹션키(u.name); if (!map.has(k)) map.set(k, []); map.get(k).push(u); }
  return 색인키.filter((k) => map.has(k)).map((k) => ({ key: k, items: map.get(k).sort(사람정렬) }));
}

// ───────── 아바타 ─────────
/** 한글 3자 이상 → 뒤 2자('김철우'→'철우') · 한글 2자 → 뒤 1자 · 영문 → 대문자 첫 2자 · 그 외 첫 1자 · 빈 값 '?' */
export function 이니셜(name) {
  const s = String(name ?? '').trim();
  if (!s) return '?';
  const chars = Array.from(s.replace(/\s+/g, ''));
  if (chars.length && chars.every((ch) => 음절인가(ch.codePointAt(0)))) {
    return chars.length >= 3 ? chars.slice(-2).join('') : chars.length === 2 ? chars[1] : chars[0];
  }
  if (/^[A-Za-z]/.test(s)) return s.replace(/[^A-Za-z]/g, '').slice(0, 2).toUpperCase() || s[0];
  return chars[0];
}
const 팔레트 = ['#5b8def', '#7c6fe0', '#e0709a', '#e08a4f', '#4fb0a0', '#5ea857', '#d4a83a', '#7e8fa6'];   // 흰 글자가 읽히는 중간 명도
/** 같은 uid 는 항상 같은 색. */
export function 아바타색(uid) {
  let h = 7;
  for (const ch of String(uid ?? '')) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return 팔레트[h % 팔레트.length];
}

// ───────── 시각 ─────────
const 두자리 = (n) => String(n).padStart(2, '0');
const 같은날 = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** '오후 12:39' (12시는 오후 12, 0시는 오전 12) */
export function 말풍선시각(ms) {
  const d = new Date(ms); const h = d.getHours();
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${두자리(d.getMinutes())}`;
}
/** 카톡 채팅 목록 시각: 오늘 '오후 12:39' · 어제 '어제' · 올해 '9월 18일' · 다른 해 '2024. 7. 26.' */
export function 목록시각(ms, now = Date.now()) {
  if (!ms) return '';
  const d = new Date(ms), n = new Date(now);
  if (같은날(d, n)) return 말풍선시각(ms);
  const 어제 = new Date(n.getFullYear(), n.getMonth(), n.getDate() - 1);
  if (같은날(d, 어제)) return '어제';
  if (d.getFullYear() === n.getFullYear()) return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}
const 요일 = ['일', '월', '화', '수', '목', '금', '토'];
/** '2026년 9월 18일 목요일' */
export function 날짜선(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${요일[d.getDay()]}요일`;
}
/**
 * 메시지 시각(ms). createdAt 숫자가 있으면 그것. 없으면 at 을 세 가지 모양으로 읽는다:
 * 'YYYY-MM-DD HH:mm'(메신저) · ISO(SYSTEM) · '2026. 9. 18. 오후 3:12:05'(AI 비서). 못 읽으면 0.
 */
export function 메시지시각ms(msg) {
  if (!msg) return 0;
  if (typeof msg.createdAt === 'number' && msg.createdAt > 0) return msg.createdAt;
  const at = String(msg.at ?? '').trim();
  if (!at) return 0;
  let m = at.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime();
  m = at.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) { let h = +m[5] % 12; if (m[4] === '오후') h += 12; return new Date(+m[1], +m[2] - 1, +m[3], h, +m[6], +(m[7] || 0)).getTime(); }
  const iso = Date.parse(at);
  return Number.isNaN(iso) ? 0 : iso;
}
const 시스템인가 = (m) => !!m && (m.author === 'SYSTEM' || m.system === true);
/** 카톡 묶음: 같은 사람 · 같은 분(HH:MM) · 같은 날 · 둘 다 시스템 아님 */
export function 같은묶음(prev, cur) {
  if (!prev || !cur || 시스템인가(prev) || 시스템인가(cur)) return false;
  if (prev.author !== cur.author) return false;
  const a = new Date(메시지시각ms(prev)), b = new Date(메시지시각ms(cur));
  return 같은날(a, b) && a.getHours() === b.getHours() && a.getMinutes() === b.getMinutes();
}

// ───────── 메시지·방 ─────────
const 이미지확장자 = /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/i;
/** 채팅 목록 미리보기 한 줄 */
export function 미리보기(msg) {
  if (!msg) return '';
  if (msg.type === 'image' || (msg.file && 이미지확장자.test(msg.file))) return '사진을 보냈습니다.';
  if (msg.file) return `파일: ${msg.file}`;
  const t = String(msg.text ?? '').replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 60) + '…' : t;
}
const 찾기 = (users, id) => (users || []).find((u) => u && u.id === id);
/** dm → 상대 '이름 직급'(없으면 이름만; 상대가 없으면 '나와의 채팅') · 그 외 ch.name */
export function 방이름(ch, users, me) {
  if (!ch) return '';
  if (ch.type === 'dm') {
    const other = (ch.members || []).find((m) => m !== me);
    if (!other) return '나와의 채팅';
    const u = 찾기(users, other);
    if (!u) return ch.name && ch.name !== 'DM' ? ch.name : '알 수 없음';
    return u.title ? `${u.name} ${u.title}` : String(u.name ?? '');
  }
  return String(ch.name ?? '');
}
/**
 * 방 멤버 uid 목록. announce → 전원 · dept → users.dept === 방 이름 · project → pm + members(배열/객체 모두) → 없으면 전원
 * · group/dm → ch.members · 그 외 전원. disabled 사용자는 뺀다.
 */
export function 방멤버(ch, users, projects) {
  const 활성 = (users || []).filter((u) => u && !u.disabled);
  const 전원 = 활성.map((u) => u.id);
  if (!ch) return [];
  const 제한 = (ids) => Array.from(new Set(ids.filter(Boolean)));
  switch (ch.type) {
    case 'announce': return 전원;
    case 'dept': { const dn = ch.name || ch.deptName; return 활성.filter((u) => u.dept === dn).map((u) => u.id); }
    case 'project': {
      const pid = ch.projectId || String(ch.id || '').replace(/^proj_/, '');
      const p = (projects || []).find((x) => x && x.id === pid);
      if (!p) return 전원;
      const ids = [p.pm || p.manager];
      const mem = p.members || p.assignees || p.team || p.users;
      if (Array.isArray(mem)) ids.push(...mem);
      else if (mem && typeof mem === 'object') for (const v of Object.values(mem)) { if (Array.isArray(v)) ids.push(...v); else if (v) ids.push(v); }
      const known = 제한(ids).filter((id) => 활성.some((u) => u.id === id));
      return known.length ? known : 전원;
    }
    case 'group': case 'dm': return 제한(ch.members || []).filter((id) => 활성.some((u) => u.id === id) || !users);
    default: return 전원;
  }
}
/** 채팅 목록 정렬: 고정 먼저 → 마지막 활동 내림차순(0 은 맨 뒤) → 이름 */
export function 채팅정렬(a, b) {
  if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
  const la = a.lastAt || 0, lb = b.lastAt || 0;
  if (la !== lb) { if (!la) return 1; if (!lb) return -1; return lb - la; }
  return String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ko');
}

// ───────── 이미지(브라우저 전용) ─────────
function 브라우저확인() { if (typeof document === 'undefined') throw new Error('브라우저에서만 쓸 수 있습니다'); }
function 그림읽기(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽지 못했습니다')); };
    img.src = url;
  });
}
/** 프로필용: 정사각 중앙 크롭 → size×size JPEG data URL. maxBytes 를 넘으면 화질을 0.1 씩 낮춰 5번까지. */
export async function 이미지축소(file, size = 192, quality = 0.82, maxBytes = 20 * 1024) {
  브라우저확인();
  const img = await 그림읽기(file);
  const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
  const sx = ((img.naturalWidth || img.width) - s) / 2, sy = ((img.naturalHeight || img.height) - s) / 2;
  const c = document.createElement('canvas'); c.width = size; c.height = size;
  c.getContext('2d').drawImage(img, sx, sy, s, s, 0, 0, size, size);
  let q = quality, out = c.toDataURL('image/jpeg', q);
  for (let i = 0; i < 5 && out.length * 0.75 > maxBytes && q > 0.2; i++) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
  return out;
}
/** 첨부용: 긴 변 maxSide 로 비율 유지 축소 → JPEG Blob. 이미지가 아니거나 이미 작으면 원본 그대로. */
export async function 사진줄이기(file, maxSide = 1280, quality = 0.8) {
  브라우저확인();
  if (!file || !/^image\//.test(file.type || '') || /gif/.test(file.type)) return file;
  if (file.size < 300 * 1024) return file;
  const img = await 그림읽기(file);
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const scale = Math.min(1, maxSide / Math.max(w, h));
  if (scale === 1 && file.size < 900 * 1024) return file;
  const c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', quality));
  if (!blob) return file;
  const name = String(file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
  try { return new File([blob], name, { type: 'image/jpeg', lastModified: Date.now() }); } catch (e) { blob.name = name; return blob; }
}
