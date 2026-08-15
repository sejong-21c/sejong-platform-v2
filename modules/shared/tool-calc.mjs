// 세종 QA 도구 — 순수 계산·파싱 함수 (단일 출처). 화면·저장과 무관한 계산만 모아 테스트 가능하게 함.
//   ITP Builder / QA Doc Generator가 이 파일을 import해 사용하고, test/tool-calc.test.mjs가 검증한다.
//   ⚠ 이 함수들의 동작을 바꾸면 test/tool-calc.test.mjs도 함께 갱신할 것.

// ── 치수 공차 (ASME UG-80 / TEMA) ──
export function dimTolASME(v){ const n=parseFloat(v)||0; if(!n)return""; if(n<=120)return"±1"; if(n<=400)return"±2"; if(n<=1000)return"±3"; if(n<=2000)return"±4"; if(n<=4000)return"±6"; return"±8"; }
export function dimTolTEMA(v){ const n=parseFloat(v)||0; if(!n)return""; if(n<=300)return"±3"; if(n<=1500)return"±5"; return"±8"; }

// ── TEMA 판별 (R/C/B 모두 "TEMA"로 시작) ──
export const isTEMA = s => typeof s === "string" && s.indexOf("TEMA") === 0;

// ── 노즐 공차 ──
export function tolPos(std){ return isTEMA(std)?"±1.5°":"±0.5°"; }
export function tolH(std,v){ const n=parseFloat(v)||0; if(isTEMA(std)){return n<=300?"±3":"±5";} if(n<=120)return"±1"; if(n<=400)return"±2"; if(n<=1000)return"±3"; return"±5"; }
export function tolL(std,v){ const n=parseFloat(v)||0; if(isTEMA(std)){return n<=300?"±3":"±5";} return tolH(std,v); }

// ── 태그 유틸 ──
export const tagId = t => (t||"").replace(/-/g,""); // Report No 등 표기용: 하이픈 제거
// 태그 정규화(대소문자·공백·하이픈·기호 무시) — "TA-6602A"·"TA6602A"·"ta 6602 a"를 같은 것으로.
export const normTag = t => String(t==null?"":t).toUpperCase().replace(/[^A-Z0-9]/g,"");

// ── 엑셀 클립보드(TSV) 파서 ──
//   큰따옴표로 감싼 필드 안의 줄바꿈(\n)·탭(\t)은 내용으로 취급("" = 리터럴 ").
//   각 행의 후행 빈 필드 제거(가로 병합셀), 완전히 빈 줄 제거(세로 병합셀).
export function parseClipboardTSV(text){
  text = text.replace(/\r\n/g,"\n").replace(/\r/g,"\n");
  const rows=[]; let row=[]; let field=""; let inQ=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(inQ){
      if(ch==='"'){ if(text[i+1]==='"'){ field+='"'; i++; } else { inQ=false; } }
      else field+=ch;
    } else {
      if(ch==='"' && field===""){ inQ=true; }
      else if(ch==='\t'){ row.push(field); field=""; }
      else if(ch==='\n'){ row.push(field); rows.push(row); row=[]; field=""; }
      else field+=ch;
    }
  }
  row.push(field); rows.push(row);
  if(rows.length && rows[rows.length-1].length===1 && rows[rows.length-1][0]==="") rows.pop();
  rows.forEach(r=>{ while(r.length>1 && r[r.length-1]==="") r.pop(); });
  const filtered = rows.filter(r => !r.every(f => f === ""));
  return filtered.length ? filtered : rows;
}
