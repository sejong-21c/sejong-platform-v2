// PDF → 색인용 조각(쪽번호 포함).  검사: node test/pdf-to-chunks.test.mjs
//
// 왜 쪽번호를 붙이나: AI 가 "ASME Sec.IX 에 그렇게 적혀 있습니다" 라고만 하면 기술부가 확인을 못 한다.
// "Sec.IX p.152" 라고 해야 책을 펴서 대조할 수 있다. 근거를 댈 수 없는 답은 설계에 못 쓴다.
//
// 어떻게 쪽을 찾나: 조각을 낸 뒤, 조각 본문의 앞부분이 **몇 쪽 글 안에 들어 있는지** 찾는다.
//   쪽 경계로 먼저 자르면 문단이 쪽을 넘나들 때 조각이 토막 난다(ASME 조문은 늘 쪽을 넘는다).
//   그래서 "이어 붙여서 자르고, 나중에 쪽을 되찾는" 순서로 간다.
//
// 쓰는 법:
//   node tools/pdf-to-chunks.mjs "책.pdf" --name "ASME Sec.IX (2023)" --out 조각.json [--max 900] [--처음 1] [--끝 0]
//   → {docName, chunks:[{글, 머리, 쪽}]}  그대로 파이스로: node scripts/doc-index-cli.mjs 조각.json
import { execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { 조각내기, 기본최대 } from './rag-chunk.mjs';

const 여기 = dirname(fileURLToPath(import.meta.url));

/** PDF → 쪽별 글자. python + PyMuPDF 를 부른다(노드에 PDF 파서를 넣지 않는다 — 패키지 0 원칙). */
export function 쪽뽑기(파일, { 처음 = 1, 끝 = 0, python = process.env.PYTHON || 'python' } = {}) {
  const 스크립트 = join(여기, 'pdf-pages.py');
  if (!existsSync(스크립트)) throw new Error(`${스크립트} 가 없습니다`);
  // 결과는 임시 파일로 받는다 — 윈도우 콘솔이 cp949 라 stdout 으로 주면 특수문자에서 죽는다.
  const 임시 = join(tmpdir(), `pdf-pages-${process.pid}-${Date.now()}.json`);
  try {
    execFileSync(python, [스크립트, 파일, 임시, String(처음), String(끝)], { encoding: 'utf8' });
    return JSON.parse(readFileSync(임시, 'utf8'));
  } finally { try { unlinkSync(임시); } catch (e) { /* 이미 없으면 그만 */ } }
}

/** 조각 본문이 몇 쪽에 있는지 되찾는다. 못 찾으면 직전 조각의 쪽을 물려준다(앞뒤는 이어져 있다). */
export function 쪽찾기(조각들, 쪽들, 첫쪽 = 1) {
  const 열쇠 = (몸) => 몸.replace(/\s+/g, ' ').trim().slice(0, 40);
  // 쪽 글도 같은 방식으로 눌러 둔다 — 원본은 줄바꿈이 제각각이라 그대로 비교하면 거의 안 맞는다
  const 눌린쪽 = 쪽들.map((t) => t.replace(/\s+/g, ' '));
  let 직전 = 첫쪽;
  return 조각들.map((c) => {
    const k = 열쇠(c.몸 || c);
    let 쪽 = 0;
    if (k.length >= 12) {
      // 직전 쪽부터 앞으로 훑는다 — 조각은 책 순서대로라 대개 한두 쪽 안에서 찾는다
      const 시작 = Math.max(0, 직전 - 첫쪽);
      for (let i = 시작; i < 눌린쪽.length; i++) if (눌린쪽[i].includes(k)) { 쪽 = 첫쪽 + i; break; }
      if (!쪽) for (let i = 0; i < 시작; i++) if (눌린쪽[i].includes(k)) { 쪽 = 첫쪽 + i; break; }
    }
    if (쪽) 직전 = 쪽;
    return { ...(typeof c === 'string' ? { 글: c } : c), 쪽: 쪽 || 직전 };
  });
}

/** 조각내기가 준 "머리\n몸" 문자열을 {머리, 몸} 으로 되돌린다. */
export function 머리몸가르기(조각, docName) {
  const i = 조각.indexOf('\n');
  if (i > 0 && 조각.slice(0, i).startsWith(docName)) return { 머리: 조각.slice(0, i), 몸: 조각.slice(i + 1) };
  return { 머리: '', 몸: 조각 };
}

/**
 * 글자 사이가 전부 벌어진 PDF 인지 본다("S t a i n l e s s S t e e l").
 * 왜 검사하나: 그런 책을 그대로 색인하면 **검색이 영영 안 걸린다** — "stainless" 로 물어도
 * 색인에는 "S t a i n l e s s" 로 들어가 있어 아무것도 안 나온다. 그런데 조각 수·평균 길이는
 * 멀쩡해 보여서 사람 눈에는 성공한 것처럼 보인다(2026-09-19 ASME B36.19 에서 발견).
 */
export function 글자벌어짐(원문) {
  const 말 = 원문.slice(0, 20000).split(/\s+/).filter(Boolean);
  if (말.length < 200) return 0;
  return 말.filter((w) => w.length === 1).length / 말.length;
}

export function 책조각내기(파일, { docName, 최대 = 기본최대, 처음 = 1, 끝 = 0, 벌어짐허용 = 0.35 } = {}) {
  const { 쪽, 첫쪽 } = 쪽뽑기(파일, { 처음, 끝 });
  const 원문 = 쪽.join('\n');
  const 벌어짐 = 글자벌어짐(원문);
  if (벌어짐 > 벌어짐허용) {
    throw new Error(`글자가 낱자로 흩어진 PDF 입니다(한 글자짜리 ${Math.round(벌어짐 * 100)}%). `
      + '이대로 색인하면 검색에 영영 안 걸립니다. 다른 판본을 구하거나 좌표 기반으로 다시 뽑아야 합니다.');
  }
  const 조각 = 조각내기(원문, docName, 최대, { 번호제목: false }).map((c) => 머리몸가르기(c, docName));
  const 쪽붙인것 = 쪽찾기(조각, 쪽, 첫쪽);
  // 20자도 안 되는 조각은 버린다 — 표에서 떨어져 나온 숫자 쪼가리라 어떤 질문에도 답이 못 된다.
  // (책은 조각이 수천 개라 이런 게 15%쯤 섞인다. 짧은 글 자체가 문제인 규정 문서와 달리 버려도 잃는 게 없다.)
  const 쓸것 = 쪽붙인것.filter((c) => (c.몸 || '').trim().length >= 20);
  return {
    docName,
    쪽수: 쪽.length,
    글자수: 원문.length,
    버린조각: 쪽붙인것.length - 쓸것.length,
    chunks: 쓸것.map((c) => ({ 글: c.몸, 머리: c.머리, 쪽: c.쪽 })),
  };
}

// ── 명령줄 ──
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const 인자 = process.argv.slice(2);
  const 값 = (이름, 기본) => { const i = 인자.indexOf(이름); return i >= 0 ? 인자[i + 1] : 기본; };
  const 옵션이름 = ['--name', '--out', '--max', '--처음', '--끝'];
  const 파일 = 인자.find((a, i) => !a.startsWith('--') && !옵션이름.includes(인자[i - 1]));
  if (!파일) { console.error('쓰는 법: node tools/pdf-to-chunks.mjs <책.pdf> --name "이름" --out 조각.json'); process.exit(2); }
  const docName = 값('--name', basename(파일).replace(/\.[^.]+$/, ''));
  const r = 책조각내기(파일, {
    docName, 최대: Number(값('--max', 기본최대)),
    처음: Number(값('--처음', 1)), 끝: Number(값('--끝', 0)),
  });
  const 나갈곳 = 값('--out', '');
  if (나갈곳) writeFileSync(나갈곳, JSON.stringify({ docName: r.docName, chunks: r.chunks }), 'utf8');
  const 쪽있음 = r.chunks.filter((c) => c.쪽).length;
  console.log(`${r.docName} — ${r.쪽수}쪽 · ${r.글자수.toLocaleString()}자 → 조각 ${r.chunks.length}개`);
  console.log(`쪽번호 ${쪽있음}/${r.chunks.length} · 너무 짧아 버린 것 ${r.버린조각}개 · 평균 ${Math.round(r.chunks.reduce((s, c) => s + c.글.length, 0) / r.chunks.length)}자`);
  console.log(`\n--- 첫 조각 (p.${r.chunks[0].쪽}) ---\n${r.chunks[0].머리}\n${r.chunks[0].글.slice(0, 300)}`);
  const 가운데 = r.chunks[Math.floor(r.chunks.length / 2)];
  console.log(`\n--- 가운데 조각 (p.${가운데.쪽}) ---\n${가운데.머리}\n${가운데.글.slice(0, 300)}`);
  if (나갈곳) console.log(`\n저장: ${나갈곳}`);
}
