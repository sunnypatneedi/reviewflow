#!/usr/bin/env python3
"""Ban raw design values outside src/styles/tokens.css.
Scans src/**/*.css (excluding tokens.css) and style="" / <style> blocks in src HTML/TSX.
Rules: no hex/rgb/hsl/named colours, no alpha, no opacity other than 0/1, no numeric
z-index, no font-size in px/rem, no box-shadow other than var(--shadow)/none.

Run from artifacts/reviewflow/:  python3 scripts/lint-tokens.py
"""
import re, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
RULES = [
    (r"#[0-9a-fA-F]{3,8}\b", "raw hex colour"),
    (r"\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(", "raw colour function"),
    (
        r"(?<![\w-])(?:white|black|red|blue|green|gray|grey|yellow|orange|purple)(?![\w-])",
        "named colour",
    ),
    (r"opacity\s*:\s*(?!0(?:[;}\s]|$)|1(?:[;}\s]|$)|var\()[0-9.]+", "raw opacity (use 0/1 or a role)"),
    (r"z-index\s*:\s*-?\d", "numeric z-index (use --layer-*)"),
    (r"font-size\s*:\s*[0-9.]+(?:px|rem|em)", "raw font-size (use a type role)"),
    (r"box-shadow\s*:\s*(?!var\(--shadow\)|none)", "raw shadow (one shadow: var(--shadow))"),
]


def blocks(path: pathlib.Path):
    t = path.read_text()
    if path.suffix == ".css":
        yield 1, t
        return
    for m in re.finditer(r"<style>(.*?)</style>", t, re.S):
        yield t[: m.start()].count("\n") + 1, m.group(1)
    for m in re.finditer(r'style="([^"]*)"', t):
        yield t[: m.start()].count("\n") + 1, m.group(1)


def collect_files():
    files = []
    for path in SRC.rglob("*"):
        if not path.is_file():
            continue
        if path.suffix == ".css":
            if path.resolve() == (SRC / "styles" / "tokens.css").resolve():
                continue
            files.append(path)
        elif path.suffix in {".html", ".tsx", ".jsx"}:
            files.append(path)
    return sorted(files)


bad = 0
for f in collect_files():
    for line0, text in blocks(f):
        text_nc = re.sub(r"/\*.*?\*/", lambda m: " " * len(m.group(0)), text, flags=re.S)
        for pat, why in RULES:
            for m in re.finditer(pat, text_nc):
                ln = line0 + text_nc[: m.start()].count("\n")
                rel = f.relative_to(ROOT)
                print(f"{rel}:{ln}: {why}: {m.group(0)!r}")
                bad += 1
print(f"lint_tokens: {bad} violation(s)")
sys.exit(1 if bad else 0)
