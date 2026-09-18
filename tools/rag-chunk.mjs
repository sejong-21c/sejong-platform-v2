// 사내 문서를 AI 색인에 넣기 좋은 조각으로 자른다.  검사: node test/rag-chunk.test.mjs
//
// 왜 따로 만드나: 지금 플랫폼의 🔑 문서 등록은 700자마다 문단 경계에서 자른다. 그러면
//   "3.2 부적합품은 즉시 격리한다"
// 같은 조각이 **어느 장(章)인지 모른 채** 색인에 들어간다. 검색은 조각 하나만 보고 답하므로
// AI 가 "무슨 절차의 3.2 인지" 를 말하지 못한다. 그래서 여기서는 조각마다 **제목 줄을 앞에 붙인다**.
//
// 자르는 규칙 (위에서부터 우선):
//   1) 제목으로 보이는 줄에서 끊는다 — "제5장", "제12조", "5.", "5.2", "5.2.1", markdown "#", "[부록]"
//   2) 한 덩이가 최대치를 넘으면 문단(빈 줄) → 문장(다., 요., .) 순서로 더 쪼갠다
//   3) 너무 짧은 조각(제목만 있고 본문이 거의 없는 것)은 다음 조각에 붙인다
// 조각마다 맨 앞에 "문서이름 > 상위제목 > 제목" 을 한 줄 붙인다. 검색에도 그 말이 걸린다.
//
// 쓰는 법:
//   node tools/rag-chunk.mjs <파일.txt|.md> [--name "품질 매뉴얼 v3"] [--max 900] [--out 조각.json]
//   → {docName, chunks:[...]} JSON. 이걸 게이트웨이 /rag/upload 로 올린다(로그인 토큰 필요 — 브라우저에서).

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

export const 기본최대 = 900;      // 한 조각 목표 길이(자). bge-m3 는 넉넉하지만 짧을수록 검색이 정확하다
const 최소 = 120;                 // 이보다 짧으면 앞뒤로 붙인다 — 제목만 있는 조각은 쓸모가 없다

// 제목 줄 판별. 한국어 규정 문서에서 실제로 쓰이는 형태만 본다(추측해서 넓히면 본문을 제목으로 오인한다).
const 제목규칙 = [
  { re: /^#{1,6}\s+(.+)$/, 깊이: (m) => m[0].indexOf(' ') },        // markdown
  { re: /^(제\s*\d+\s*(?:장|편)\s*[.:]?\s*.*)$/, 깊이: () => 1 },    // 제5장
  { re: /^(제\s*\d+\s*조\s*(?:\(.*?\))?\s*.*)$/, 깊이: () => 2 },    // 제12조 (목적)
  { re: /^(\[[^\]]{1,30}\])\s*$/, 깊이: () => 1 },                   // [부록 A]
  { re: /^(\d+(?:\.\d+){0,3})\.?\s+(\S.*)$/, 깊이: (m) => 1 + (m[1].match(/\./g) || []).length },  // 5. / 5.2 / 5.2.1
];
export function 제목인가(줄) {
  const t = String(줄 || '').trim();
  if (!t || t.length > 80) return null;                 // 긴 줄은 본문이다
  if (/[.?!]$/.test(t) && !/^\d/.test(t)) return null;  // 마침표로 끝나면 문장
  for (const r of 제목규칙) {
    const m = t.match(r.re);
    if (m) return { 글: t, 깊이: r.깊이(m) };
  }
  return null;
}

const 다듬기 = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** 문장 단위로 쪼갠다. 한국어는 마침표 없이 "~한다" 로 끝나는 줄이 많아 줄바꿈도 경계로 본다. */
function 문장들(글) {
  return 글.split(/(?<=[.!?])\s+|(?<=다\.)\s*|\n/).map((s) => s.trim()).filter(Boolean);
}

function 길이로쪼개기(글, 최대) {
  if (글.length <= 최대) return [글];
  const 나온것 = [];
  let 현재 = '';
  for (const 덩이 of 글.split(/\n\s*\n/)) {
    const 조각들 = 덩이.length <= 최대 ? [덩이] : (() => {
      const out = []; let buf = '';
      for (const s of 문장들(덩이)) {
        if (buf && (buf + ' ' + s).length > 최대) { out.push(buf); buf = s; }
        else buf = buf ? buf + ' ' + s : s;
      }
      if (buf) out.push(buf);
      return out;
    })();
    for (const 조각 of 조각들) {
      if (현재 && (현재 + '\n\n' + 조각).length > 최대) { 나온것.push(현재); 현재 = 조각; }
      else 현재 = 현재 ? 현재 + '\n\n' + 조각 : 조각;
    }
  }
  if (현재) 나온것.push(현재);
  return 나온것;
}

/** 텍스트 → 색인용 조각 배열. 조각 앞에는 "문서 > 상위제목 > 제목" 한 줄이 붙는다. */
export function 조각내기(원문, docName, 최대 = 기본최대) {
  const 줄들 = 다듬기(원문).split('\n');
  const 구역 = [];                       // { 경로: [...], 본문: '' }
  let 경로 = [];
  let 본문 = [];
  const 닫기 = () => { const t = 본문.join('\n').trim(); if (t) 구역.push({ 경로: 경로.slice(), 본문: t }); 본문 = []; };
  for (const 줄 of 줄들) {
    const h = 제목인가(줄);
    if (h) {
      닫기();
      경로 = 경로.slice(0, Math.max(0, h.깊이 - 1));
      경로.push(h.글);
    } else 본문.push(줄);
  }
  닫기();
  if (!구역.length) 구역.push({ 경로: [], 본문: 다듬기(원문) });

  const 조각 = [];
  for (const g of 구역) {
    const 머리 = [docName, ...g.경로].filter(Boolean).join(' > ');
    for (const 몸 of 길이로쪼개기(g.본문, Math.max(200, 최대 - 머리.length - 2))) {
      조각.push({ 머리, 몸 });
    }
  }
  // 너무 짧은 조각은 앞 조각에 붙인다 — 혼자서는 검색에 걸려도 답이 안 나온다.
  // 단 **같은 제목 아래일 때만**. 장(章)을 넘어 합치면 제5장 조각 안에 제6장 내용이 섞여
  // AI 가 엉뚱한 조항을 근거로 댄다(처음에 그렇게 짰다가 시험에서 잡혔다).
  const 합친것 = [];
  for (const c of 조각) {
    const 앞 = 합친것[합친것.length - 1];
    if (앞 && 앞.머리 === c.머리 && c.몸.length < 최소 && (앞.몸 + '\n' + c.몸).length <= 최대 * 1.5) 앞.몸 += '\n' + c.몸;
    else 합친것.push({ ...c });
  }
  return 합친것.map((c) => (c.머리 ? c.머리 + '\n' + c.몸 : c.몸));
}

// ── 명령줄 ──
// 윈도우에서 import.meta.url 은 file:///C:/... (슬래시 3개)인데 손으로 만든 file://C:/... 는 2개라
// 영영 안 맞는다 → 명령줄로 불러도 아무 일이 안 일어난다(2026-09-19 platform-count 에서 같은 줄이 잡혔다).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const 인자 = process.argv.slice(2);
  const 값 = (이름, 기본) => { const i = 인자.indexOf(이름); return i >= 0 ? 인자[i + 1] : 기본; };
  const 파일 = 인자.find((a) => !a.startsWith('--') && 인자[인자.indexOf(a) - 1] !== '--name' && 인자[인자.indexOf(a) - 1] !== '--max' && 인자[인자.indexOf(a) - 1] !== '--out');
  if (!파일) { console.error('쓰는 법: node tools/rag-chunk.mjs <파일> [--name 이름] [--max 900] [--out 조각.json]'); process.exit(2); }
  const docName = 값('--name', basename(파일).replace(/\.[^.]+$/, ''));
  const 최대 = Number(값('--max', 기본최대));
  const chunks = 조각내기(readFileSync(파일, 'utf8'), docName, 최대);
  const 결과 = { docName, chunks };
  const 나갈곳 = 값('--out', '');
  if (나갈곳) writeFileSync(나갈곳, JSON.stringify(결과, null, 1), 'utf8');
  console.log(`${docName} — 조각 ${chunks.length}개 · 평균 ${Math.round(chunks.join('').length / chunks.length)}자 · 최장 ${Math.max(...chunks.map((c) => c.length))}자`);
  if (chunks.length > 500) console.log('⚠️ 500개를 넘는다 — 게이트웨이가 거부한다. 문서를 나누거나 --max 를 키울 것.');
  console.log('\n--- 첫 조각 ---\n' + chunks[0].slice(0, 400));
  if (나갈곳) console.log(`\n저장: ${나갈곳}`);
}
