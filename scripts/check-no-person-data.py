#!/usr/bin/env python3
"""
Guard against real person data entering the repository.

Real students, teachers, mentors and advisors from the schools must never appear
in tracked files — not their e-mail addresses, not their Hazu identity tags, not
their names. Generated reports that legitimately contain such data belong in the
gitignored `output/` directory.

The e-mail check is an *allowlist*: any address whose domain is not explicitly
permitted below is reported. That way a school domain nobody thought of is still
caught the first time it appears.

Usage:
    check-no-person-data.py --staged        # scan staged changes (pre-commit hook)
    check-no-person-data.py --all           # audit every tracked file
    check-no-person-data.py FILE [FILE...]  # scan specific files
    check-no-person-data.py --claude-hook   # read a Claude Code PreToolUse event on stdin

Exit codes: 0 = clean, 1 = violations found, 2 = violations found (Claude hook: blocks the tool call).
"""
import json
import re
import subprocess
import sys

# Domains permitted to appear in tracked files. `.invalid` is reserved by RFC 2606
# precisely for this purpose and can never resolve.
ALLOWED_DOMAINS = {
    "example.invalid", "example.com", "example.org", "example.net", "example.test",
    "partner-domain.invalid",
    "hazu.io",        # Hazu platform infrastructure accounts (support@, genius@)
    "anthropic.com", "github.com", "claude.com",
}

# Paths exempt from the check. `output/` is gitignored and is the designated home
# for generated reports that legitimately contain real person data.
EXEMPT_RE = re.compile(r"^(output/|node_modules/|dist/|\.git/)")

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
# A Hazu identity tag carrying a real identity rather than a placeholder.
USERID_TAG_RE = re.compile(r"hz-config-userid-(?![<{$])[^\s\"'\],}]*[@.][^\s\"'\],}]*")


def scan_text(path, text):
    """Return a list of (line_no, kind, snippet) violations found in `text`."""
    if EXEMPT_RE.match(path or ""):
        return []
    out = []
    for i, line in enumerate(text.splitlines(), 1):
        for m in EMAIL_RE.finditer(line):
            if m.group(1).lower() not in ALLOWED_DOMAINS:
                out.append((i, "e-mail address", m.group(0)))
        for m in USERID_TAG_RE.finditer(line):
            out.append((i, "Hazu identity tag", m.group(0)))
    return out


def report(violations):
    if not violations:
        return 0
    print("\nBLOCKED: real person data must not enter tracked files.\n", file=sys.stderr)
    for path, line, kind, snippet in violations:
        print(f"  {path}:{line}  {kind}: {snippet}", file=sys.stderr)
    print(
        "\nUse a placeholder at @example.invalid instead, or put the file in output/"
        "\n(gitignored) if it is a generated report that must contain real data."
        "\nSee the person-data rule in CLAUDE.md.\n",
        file=sys.stderr,
    )
    return 1


def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True).stdout


def main():
    argv = sys.argv[1:]
    if not argv:
        print(__doc__)
        return 0

    if argv[0] == "--claude-hook":
        try:
            event = json.load(sys.stdin)
        except Exception:
            return 0  # never break the session on a malformed event
        ti = event.get("tool_input") or {}
        path = ti.get("file_path") or ""
        text = "\n".join(
            str(ti.get(k) or "") for k in ("content", "new_string", "command")
        )
        found = scan_text(path, text)
        if found:
            print(
                f"BLOCKED: this edit would put real person data into {path or 'a tracked file'}:",
                file=sys.stderr,
            )
            for line, kind, snippet in found:
                print(f"  {kind}: {snippet}", file=sys.stderr)
            print(
                "Use a placeholder at @example.invalid, or write the file into output/ instead.",
                file=sys.stderr,
            )
            return 2  # exit 2 blocks the tool call
        return 0

    violations = []
    if argv[0] == "--staged":
        files = [f for f in git("diff", "--cached", "--name-only", "--diff-filter=ACM").split("\n") if f]
        for f in files:
            blob = git("show", f":{f}")
            violations += [(f, ln, k, s) for ln, k, s in scan_text(f, blob)]
    else:
        files = [f for f in git("ls-files").split("\n") if f] if argv[0] == "--all" else argv
        for f in files:
            try:
                with open(f, encoding="utf-8", errors="ignore") as fh:
                    violations += [(f, ln, k, s) for ln, k, s in scan_text(f, fh.read())]
            except (OSError, IsADirectoryError):
                continue
    return report(violations)


if __name__ == "__main__":
    sys.exit(main())
