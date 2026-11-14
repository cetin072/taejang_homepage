#!/usr/bin/env python3
import argparse
import json
import os
import pathlib
import subprocess
import time
import urllib.request
import urllib.parse

REQUIRED_CHECKS = [
    "static_regression",
    "environment_parity",
    "role_ui_contract",
    "preview_runtime",
    "representative_smoke",
    "visual_stability",
]


def fail(message: str) -> None:
    print(f"::error::{message}")
    raise SystemExit(1)


def load_contract(path: pathlib.Path) -> dict:
    if not path.exists():
        fail(f"UAR contract not found: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"UAR contract is invalid JSON: {exc}")
    if data.get("version") != 2:
        fail("UAR contract version must be 2")
    checks = data.get("checks")
    if not isinstance(checks, dict):
        fail("UAR contract must contain a checks object")
    for name in REQUIRED_CHECKS:
        item = checks.get(name)
        if not isinstance(item, dict):
            fail(f"Missing required UAR check: {name}")
        command = item.get("command")
        if not isinstance(command, str) or not command.strip():
            fail(f"UAR check {name} requires a non-empty command")
    role = checks["role_ui_contract"]
    if role.get("fixture_policy") != "minimal":
        fail('role_ui_contract.fixture_policy must be "minimal"')
    stability = checks["visual_stability"]
    if stability.get("surface_policy") not in {"representative", "all-critical"}:
        fail('visual_stability.surface_policy must be "representative" or "all-critical"')
    preview = data.get("preview", {})
    if not isinstance(preview, dict):
        fail("preview must be an object")
    if preview.get("required") is True and not str(preview.get("status_context", "")).strip():
        fail("preview.status_context is required when preview.required=true")
    escapes = data.get("qa_escape_regressions", [])
    if not isinstance(escapes, list) or not all(isinstance(item, str) and item.strip() for item in escapes):
        fail("qa_escape_regressions must be an array of non-empty strings")
    return data


def github_json(url: str, token: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "user-acceptance-ready-gate",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def wait_for_preview(contract: dict, env: dict) -> str:
    preview = contract.get("preview", {})
    if preview.get("required") is not True:
        return ""
    repo = env.get("GITHUB_REPOSITORY", "").strip()
    head_sha = env.get("UAR_HEAD_SHA", "").strip()
    token = env.get("GITHUB_TOKEN", "").strip()
    if not repo or not head_sha or not token:
        fail("GITHUB_REPOSITORY, UAR_HEAD_SHA and GITHUB_TOKEN are required for preview verification")
    context = str(preview["status_context"]).strip()
    timeout_seconds = int(preview.get("wait_seconds", 600))
    deadline = time.time() + timeout_seconds
    status_url = f"https://api.github.com/repos/{repo}/commits/{head_sha}/status"
    print(f"Waiting for exact-head preview status: {context} @ {head_sha}")
    while time.time() < deadline:
        payload = github_json(status_url, token)
        matches = [item for item in payload.get("statuses", []) if item.get("context") == context]
        if matches:
            item = matches[0]
            state = item.get("state")
            if state == "success":
                target = str(item.get("target_url") or "").strip()
                if not target:
                    fail(f"Preview status {context} succeeded without target_url")
                print(f"Exact-head preview ready: {target}")
                # Netlify status URLs may include a PR entry path (/app/).
                # Downstream checks append their own public/app paths.
                parsed = urllib.parse.urlsplit(target)
                if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
                    fail("Preview status must provide an HTTPS origin without credentials")
                return f"{parsed.scheme}://{parsed.netloc}"
            if state in {"failure", "error"}:
                fail(f"Preview status {context} failed with state={state}")
        time.sleep(10)
    fail(f"Timed out waiting for preview status {context} on {head_sha}")
    return ""


def run_command(label: str, command: str, env: dict) -> None:
    print(f"\n===== UAR: {label} =====")
    print(command)
    result = subprocess.run(command, shell=True, env=env)
    if result.returncode != 0:
        fail(f"UAR check failed: {label} (exit {result.returncode})")
    print(f"UAR PASS: {label}")


def wait_for_public_checks(env: dict, timeout_seconds: int = 900) -> None:
    """Reuse dedicated public jobs only after their exact-head results succeed."""
    required = {
        "Public source and launch regression",
        "Article photo and existing video slides",
        "Employee app landing local and exact-head Preview",
    }
    repo = env.get("GITHUB_REPOSITORY", "").strip()
    sha = env.get("UAR_HEAD_SHA", "").strip()
    token = env.get("GITHUB_TOKEN", "").strip()
    if not repo or not sha or not token:
        fail("Exact-head public checks require repository, HEAD and token")
    url = f"https://api.github.com/repos/{repo}/commits/{sha}/check-runs?filter=latest&per_page=100"
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        latest = {}
        page = 1
        while True:
            checks = github_json(f"{url}&page={page}", token).get("check_runs", [])
            for check in checks:
                if check.get("head_sha") != sha or check.get("app", {}).get("slug") != "github-actions":
                    continue
                name = check.get("name")
                if name in required and check.get("id", 0) > latest.get(name, {}).get("id", -1):
                    latest[name] = check
            if len(checks) < 100:
                break
            page += 1
        for name, check in latest.items():
            if check.get("status") == "completed" and check.get("conclusion") != "success":
                fail(f"Public QA failed: {name} ({check.get('conclusion')})")
        pending = sorted(name for name in required if latest.get(name, {}).get("conclusion") != "success"
                         or latest.get(name, {}).get("status") != "completed")
        if not pending:
            print(f"UAR public QA: all {len(required)} exact-head checks passed")
            return
        print("Waiting for public QA: " + ", ".join(pending), flush=True)
        time.sleep(10)
    fail("Timed out waiting for exact-head public QA")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--contract", default=os.environ.get("UAR_CONTRACT_PATH", ".github/user-acceptance-ready.json"))
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()

    contract = load_contract(pathlib.Path(args.contract))
    print("UAR contract validation: PASS")
    if args.validate_only:
        return

    env = os.environ.copy()
    scope = env.get("VALIDATION_SCOPE", "full")
    if scope == "docs":
        print("UAR not applicable: documentation-only change")
        return
    if scope == "public":
        wait_for_preview(contract, env)
        wait_for_public_checks(env)
        print("USER_ACCEPTANCE_READY=PASS (public regression and hosted PC/mobile QA verified)")
        return
    bootstrap = str(contract.get("bootstrap", "")).strip()
    if bootstrap:
        run_command("bootstrap", bootstrap, env)

    for name in ("static_regression", "role_ui_contract"):
        run_command(name, contract["checks"][name]["command"], env)

    preview_url = wait_for_preview(contract, env)
    env["PREVIEW_URL"] = preview_url
    env["EXPECTED_HEAD_SHA"] = env.get("UAR_HEAD_SHA", "")

    # Reuse a successful command only within this same Preview/environment.
    # The earlier local role check remains separate from hosted validation.
    completed_commands = set()
    for name in ("environment_parity", "preview_runtime", "representative_smoke", "visual_stability"):
        command = contract["checks"][name]["command"]
        if command in completed_commands:
            print(f"UAR PASS: {name} (same command already passed on this Preview)")
            continue
        run_command(name, command, env)
        completed_commands.add(command)

    print("\nUSER_ACCEPTANCE_READY=PASS")
    print("User Preview may be requested only after this gate is GREEN.")


if __name__ == "__main__":
    main()
