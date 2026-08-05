"""Calculation result container and plain-text calc-sheet rendering.

Every calculation function in this package returns a CalcResult so the
intermediate values can be printed as a reviewable calculation sheet
(for quotation / preliminary-check documentation) instead of a bare number.
"""

from dataclasses import dataclass, field


@dataclass
class CalcResult:
    title: str
    code_ref: str = ""
    inputs: list = field(default_factory=list)   # (name, value, unit, note)
    steps: list = field(default_factory=list)    # (name, formula, value, unit)
    checks: list = field(default_factory=list)   # (description, passed)
    results: dict = field(default_factory=dict)  # key numeric results
    notes: list = field(default_factory=list)    # caveats printed with the sheet
    data: dict = field(default_factory=dict)     # intermediates for downstream
                                                 # calcs; not printed

    @property
    def ok(self) -> bool:
        return all(passed for _, passed in self.checks)

    def add_input(self, name, value, unit="", note=""):
        self.inputs.append((name, value, unit, note))

    def add_step(self, name, formula, value, unit=""):
        self.steps.append((name, formula, value, unit))

    def add_check(self, description, passed):
        self.checks.append((description, bool(passed)))

    def add_note(self, text):
        self.notes.append(text)

    def report(self) -> str:
        w = 78
        lines = ["=" * w, self.title]
        if self.code_ref:
            lines.append(f"Code reference: {self.code_ref}")
        lines.append("-" * w)
        if self.inputs:
            lines.append("[Inputs]")
            for name, value, unit, note in self.inputs:
                v = f"{value:,.4f}" if isinstance(value, float) else f"{value}"
                tail = f"   ({note})" if note else ""
                lines.append(f"  {name:<28} = {v:>14} {unit:<6}{tail}")
        if self.steps:
            lines.append("[Calculation]")
            for name, formula, value, unit in self.steps:
                v = f"{value:,.4f}" if isinstance(value, float) else f"{value}"
                lines.append(f"  {name:<28} = {v:>14} {unit:<6}  {formula}")
        if self.checks:
            lines.append("[Checks]")
            for description, passed in self.checks:
                mark = "PASS" if passed else "FAIL"
                lines.append(f"  [{mark}] {description}")
        if self.notes:
            lines.append("[Notes]")
            for text in self.notes:
                lines.append(f"  ! {text}")
        lines.append("-" * w)
        for key, value in self.results.items():
            v = f"{value:,.4f}" if isinstance(value, float) else f"{value}"
            lines.append(f"  >> {key} = {v}")
        lines.append("=" * w)
        return "\n".join(lines)
