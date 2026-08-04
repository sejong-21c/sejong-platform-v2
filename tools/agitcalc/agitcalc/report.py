"""검토 가능한 계산서 출력 — pvcalc.report 와 동일한 규약.

모든 계산 함수는 CalcResult 를 돌려주고, .report() 로 사람이 검토할 수 있는
텍스트 계산서를 만든다. results 딕셔너리에 수치 결과가 들어간다.
"""


class CalcResult:
    def __init__(self, title, ref=""):
        self.title = title
        self.ref = ref
        self.inputs = []      # (name, value, unit, note)
        self.steps = []       # (name, formula, value, unit)
        self.checks = []      # (desc, bool, note)
        self.warnings = []    # str
        self.results = {}

    def add_input(self, name, value, unit="", note=""):
        self.inputs.append((name, value, unit, note))
        return self

    def add_step(self, name, formula, value, unit=""):
        self.steps.append((name, formula, value, unit))
        return self

    def add_check(self, desc, passed, note=""):
        self.checks.append((desc, bool(passed), note))
        return self

    def warn(self, msg):
        self.warnings.append(msg)
        return self

    @property
    def ok(self):
        return all(c[1] for c in self.checks)

    def _fmt(self, v):
        if isinstance(v, bool):
            return "예" if v else "아니오"
        if isinstance(v, (int,)):
            return str(v)
        if isinstance(v, float):
            if v != 0 and (abs(v) >= 1e6 or abs(v) < 1e-3):
                return f"{v:.4e}"
            return f"{v:.6g}"
        return str(v)

    def report(self, width=78):
        L = []
        L.append("=" * width)
        L.append(self.title)
        if self.ref:
            L.append(f"근거: {self.ref}")
        L.append("=" * width)
        if self.inputs:
            L.append("[입력]")
            for n, v, u, note in self.inputs:
                s = f"  {n:<34} = {self._fmt(v):>14} {u}"
                if note:
                    s += f"   ({note})"
                L.append(s)
        if self.steps:
            L.append("[계산]")
            for n, f, v, u in self.steps:
                L.append(f"  {n:<34} = {self._fmt(v):>14} {u}")
                if f:
                    L.append(f"  {'':<34}   {f}")
        if self.checks:
            L.append("[검토]")
            for d, p, note in self.checks:
                mark = "OK " if p else "NG "
                s = f"  [{mark}] {d}"
                if note:
                    s += f"  — {note}"
                L.append(s)
        if self.warnings:
            L.append("[경고]")
            for w in self.warnings:
                L.append(f"  ! {w}")
        L.append("=" * width)
        return "\n".join(L)

    def __repr__(self):
        return f"<CalcResult {self.title!r} ok={self.ok}>"
