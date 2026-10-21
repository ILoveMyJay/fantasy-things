#!/usr/bin/env python3
"""Run historical regression cases for the A-share news radar skill."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

import score_events


CONFIDENCE_ORDER = {"Low": 1, "Medium": 2, "High": 3}


def load_cases(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    if isinstance(data, dict) and isinstance(data.get("cases"), list):
        return data["cases"]
    raise ValueError("Historical cases file must contain a 'cases' list.")


def flatten_candidates(scored_event: dict[str, Any]) -> dict[str, dict[str, Any]]:
    flattened: dict[str, dict[str, Any]] = {}
    for candidates in scored_event.get("candidates", {}).values():
        for candidate in candidates:
            ticker = str(candidate.get("ticker") or "")
            if ticker:
                flattened[ticker] = candidate
    return flattened


def confidence_at_least(actual: str, expected: str) -> bool:
    return CONFIDENCE_ORDER.get(actual, 0) >= CONFIDENCE_ORDER.get(expected, 0)


def check_case(case: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    scored = score_events.score_and_rank([case["event"]], top=1)[0]
    expect = case.get("expect", {})
    candidates = flatten_candidates(scored)

    expected_theme = expect.get("theme")
    if expected_theme and expected_theme not in scored.get("themes", []):
        failures.append(f"missing theme {expected_theme!r}")

    min_event_confidence = expect.get("min_event_confidence")
    if min_event_confidence and not confidence_at_least(scored["confidence"], min_event_confidence):
        failures.append(f"event confidence {scored['confidence']} < {min_event_confidence}")

    for ticker, label in expect.get("must_have_label", {}).items():
        candidate = candidates.get(ticker)
        if not candidate:
            failures.append(f"missing candidate {ticker}")
        elif candidate.get("evidence_label") != label:
            failures.append(f"{ticker} label {candidate.get('evidence_label')} != {label}")

    for ticker, min_confidence in expect.get("must_have_min_confidence", {}).items():
        candidate = candidates.get(ticker)
        if not candidate:
            failures.append(f"missing candidate {ticker}")
        elif not confidence_at_least(candidate.get("candidate_confidence", "Low"), min_confidence):
            failures.append(
                f"{ticker} confidence {candidate.get('candidate_confidence')} < {min_confidence}"
            )

    for ticker in expect.get("must_not_high", []):
        candidate = candidates.get(ticker)
        if not candidate:
            failures.append(f"missing candidate {ticker}")
        elif candidate.get("candidate_confidence") == "High":
            failures.append(f"{ticker} unexpectedly High confidence")

    for ticker in expect.get("must_exclude", []):
        candidate = candidates.get(ticker)
        if not candidate:
            failures.append(f"missing excluded candidate {ticker}")
            continue
        if candidate.get("candidate_score") != 0:
            failures.append(f"{ticker} expected score 0, got {candidate.get('candidate_score')}")
        if "not_active_listing" not in candidate.get("penalties", []):
            failures.append(f"{ticker} missing not_active_listing penalty")

    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description="Run historical regression cases.")
    parser.add_argument("input", help="Path to fixtures/historical_cases.json.")
    parser.add_argument("--pretty", action="store_true", help="Print detailed JSON results.")
    args = parser.parse_args()

    try:
        cases = load_cases(Path(args.input))
    except Exception as exc:  # noqa: BLE001
        print(f"run_historical_cases.py: {exc}", file=sys.stderr)
        return 1

    results = []
    for case in cases:
        failures = check_case(case)
        results.append({"id": case.get("id"), "ok": not failures, "failures": failures})

    failed = [result for result in results if not result["ok"]]
    if args.pretty:
        print(json.dumps(results, ensure_ascii=False, indent=2))
    else:
        passed = len(results) - len(failed)
        print(f"Historical cases: {passed}/{len(results)} passed")
        for result in failed:
            print(f"- {result['id']}: {'; '.join(result['failures'])}")

    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

