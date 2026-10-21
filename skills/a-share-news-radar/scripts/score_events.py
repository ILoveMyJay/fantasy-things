#!/usr/bin/env python3
"""Score news events and A-share candidates for the news radar skill.

Input JSON can be either a list of events or an object with an "events" list.

Event fields remain backward compatible:
  fact_strength, industry_distance, earnings_relevance, policy_persistence,
  crowding_risk, counterevidence_risk

Candidate fields can use either legacy lists of names or structured objects:
  ticker, name, evidence_label, source_quality, link_strength, listing_status,
  freshness, crowding_risk, negative_exposure, reason, sources
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from typing import Any


EVENT_WEIGHTS = {
    "fact_strength": 0.24,
    "industry_distance": 0.22,
    "earnings_relevance": 0.22,
    "policy_persistence": 0.14,
    "crowding_risk": -0.10,
    "counterevidence_risk": -0.08,
}

EVIDENCE_SCORES = {
    "公告确认": 35.0,
    "业务归属": 30.0,
    "产业链推断": 20.0,
    "情绪映射": 8.0,
    "负面暴露": 12.0,
    "剔除": 0.0,
}

SOURCE_SCORES = {
    "S": 30.0,
    "A": 24.0,
    "B": 16.0,
    "C": 8.0,
    "UNKNOWN": 4.0,
}

ACTIVE_LISTING_STATUSES = {"active", "listed", "正常上市", "上市"}

LEGACY_GROUP_DEFAULTS = {
    "direct": {"evidence_label": "业务归属", "link_strength": 6},
    "indirect": {"evidence_label": "产业链推断", "link_strength": 5},
    "watch_verify": {"evidence_label": "情绪映射", "link_strength": 3},
    "possible_losers": {"evidence_label": "负面暴露", "link_strength": 5, "negative_exposure": True},
    "removed": {"evidence_label": "剔除", "link_strength": 0, "listing_status": "inactive"},
}

GROUP_ALIASES = {
    "direct": "direct",
    "direct_benefit": "direct",
    "直接受益": "direct",
    "indirect": "indirect",
    "indirect_benefit": "indirect",
    "间接受益": "indirect",
    "watch": "watch_verify",
    "watch_verify": "watch_verify",
    "verify": "watch_verify",
    "观察核实": "watch_verify",
    "possible_losers": "possible_losers",
    "losers": "possible_losers",
    "negative": "possible_losers",
    "可能受损": "possible_losers",
    "removed": "removed",
    "excluded": "removed",
    "剔除": "removed",
}


@dataclass
class ScoredEvent:
    raw: dict[str, Any]
    score: float
    confidence: str
    penalties: list[str]
    candidates: dict[str, list[dict[str, Any]]]


def clamp_score(value: Any, maximum: float = 10.0) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return max(0.0, min(maximum, number))


def normalize_source_quality(value: Any) -> str:
    if isinstance(value, str):
        normalized = value.strip().upper()
        if normalized in SOURCE_SCORES:
            return normalized
    return "UNKNOWN"


def normalize_listing_status(value: Any) -> str:
    if value is None or value == "":
        return "active"
    return str(value).strip().lower()


def normalize_group(value: Any) -> str:
    if value is None:
        return "watch_verify"
    return GROUP_ALIASES.get(str(value).strip(), "watch_verify")


def event_confidence_label(score: float, event: dict[str, Any]) -> str:
    fact = clamp_score(event.get("fact_strength"))
    distance = clamp_score(event.get("industry_distance"))
    risk = clamp_score(event.get("counterevidence_risk"))
    crowding = clamp_score(event.get("crowding_risk"))

    if score >= 6.5 and fact >= 7 and distance >= 6 and risk <= 4 and crowding <= 6:
        return "High"
    if score >= 4.0 and fact >= 5:
        return "Medium"
    return "Low"


def candidate_confidence_label(score: float, candidate: dict[str, Any], penalties: list[str]) -> str:
    source_quality = normalize_source_quality(candidate.get("source_quality"))
    evidence_label = str(candidate.get("evidence_label") or "")

    if "not_active_listing" in penalties or evidence_label == "剔除":
        return "Low"
    if (
        score >= 70
        and source_quality in {"S", "A"}
        and evidence_label in {"公告确认", "业务归属"}
        and "weak_source_cap" not in penalties
        and "high_crowding" not in penalties
    ):
        return "High"
    if score >= 40:
        return "Medium"
    return "Low"


def score_candidate(candidate: dict[str, Any], group: str = "watch_verify") -> dict[str, Any]:
    evidence_label = str(candidate.get("evidence_label") or LEGACY_GROUP_DEFAULTS[group]["evidence_label"])
    source_quality = normalize_source_quality(candidate.get("source_quality"))
    listing_status = normalize_listing_status(candidate.get("listing_status"))
    link_strength = clamp_score(candidate.get("link_strength", LEGACY_GROUP_DEFAULTS[group].get("link_strength", 3)))
    freshness = clamp_score(candidate.get("freshness", 5))
    crowding_risk = clamp_score(candidate.get("crowding_risk"))
    negative_exposure = candidate.get("negative_exposure", LEGACY_GROUP_DEFAULTS[group].get("negative_exposure", False))
    if isinstance(negative_exposure, bool):
        negative_penalty = 15.0 if negative_exposure else 0.0
    else:
        negative_penalty = clamp_score(negative_exposure) * 1.5

    penalties: list[str] = []
    active = listing_status in ACTIVE_LISTING_STATUSES
    if not active or evidence_label == "剔除":
        penalties.append("not_active_listing" if not active else "excluded_candidate")
        score = 0.0
    else:
        score = (
            EVIDENCE_SCORES.get(evidence_label, 6.0)
            + SOURCE_SCORES[source_quality]
            + link_strength * 2.0
            + freshness * 1.0
            - crowding_risk * 2.0
            - negative_penalty
        )

        if source_quality == "C" and score > 59:
            score = 59.0
            penalties.append("weak_source_cap")
        if evidence_label == "情绪映射" and score > 45:
            score = 45.0
            penalties.append("sentiment_mapping_cap")
        if evidence_label == "产业链推断" and source_quality in {"C", "UNKNOWN"} and score > 55:
            score = 55.0
            penalties.append("unverified_chain_cap")
        if crowding_risk >= 7:
            penalties.append("high_crowding")
        if source_quality in {"C", "UNKNOWN"}:
            penalties.append("weak_source")
        if link_strength <= 3:
            penalties.append("weak_link")
        if negative_penalty > 0:
            penalties.append("negative_exposure")

    score = round(max(0.0, min(100.0, score)), 2)
    scored = dict(candidate)
    scored.setdefault("ticker", "")
    scored.setdefault("name", scored.get("ticker") or "Unnamed candidate")
    scored.setdefault("evidence_label", evidence_label)
    scored.setdefault("source_quality", source_quality)
    scored.setdefault("listing_status", listing_status)
    scored.setdefault("link_strength", link_strength)
    scored.setdefault("freshness", freshness)
    scored.setdefault("crowding_risk", crowding_risk)
    scored.setdefault("negative_exposure", negative_exposure)
    scored.setdefault("reason", "")
    scored.setdefault("sources", [])
    scored["candidate_score"] = score
    scored["candidate_confidence"] = candidate_confidence_label(score, scored, penalties)
    scored["penalties"] = penalties
    return scored


def legacy_candidate_to_object(value: Any, group: str) -> dict[str, Any]:
    defaults = LEGACY_GROUP_DEFAULTS[group]
    if isinstance(value, dict):
        candidate = dict(value)
    else:
        candidate = {"name": str(value)}
    for key, default_value in defaults.items():
        candidate.setdefault(key, default_value)
    candidate.setdefault("source_quality", "UNKNOWN")
    candidate.setdefault("listing_status", "active")
    candidate.setdefault("freshness", 5)
    candidate.setdefault("crowding_risk", 0)
    return candidate


def score_candidates(raw_candidates: Any) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {
        "direct": [],
        "indirect": [],
        "watch_verify": [],
        "possible_losers": [],
        "removed": [],
    }

    if isinstance(raw_candidates, list):
        for item in raw_candidates:
            if not isinstance(item, dict):
                item = {"name": str(item)}
            group = normalize_group(item.get("group"))
            candidate = legacy_candidate_to_object(item, group)
            grouped[group].append(score_candidate(candidate, group))
    elif isinstance(raw_candidates, dict):
        for raw_group, values in raw_candidates.items():
            group = normalize_group(raw_group)
            if isinstance(values, list):
                iterable = values
            else:
                iterable = [values]
            for item in iterable:
                candidate = legacy_candidate_to_object(item, group)
                grouped[group].append(score_candidate(candidate, group))

    return {
        group: sorted(candidates, key=lambda item: item["candidate_score"], reverse=True)
        for group, candidates in grouped.items()
        if candidates
    }


def score_event(event: dict[str, Any]) -> ScoredEvent:
    score = 0.0
    for field, weight in EVENT_WEIGHTS.items():
        score += clamp_score(event.get(field)) * weight
    score = round(max(0.0, min(10.0, score)), 2)

    penalties: list[str] = []
    if clamp_score(event.get("crowding_risk")) >= 7:
        penalties.append("crowded_theme")
    if clamp_score(event.get("counterevidence_risk")) >= 7:
        penalties.append("high_counterevidence")
    if clamp_score(event.get("industry_distance")) <= 3:
        penalties.append("weak_a_share_linkage")
    if clamp_score(event.get("fact_strength")) <= 3:
        penalties.append("low_fact_strength")

    return ScoredEvent(
        raw=event,
        score=score,
        confidence=event_confidence_label(score, event),
        penalties=penalties,
        candidates=score_candidates(event.get("candidates", {})),
    )


def load_events(path: str) -> list[dict[str, Any]]:
    if path == "-":
        data = json.load(sys.stdin)
    else:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)

    if isinstance(data, list):
        events = data
    elif isinstance(data, dict) and isinstance(data.get("events"), list):
        events = data["events"]
    else:
        raise ValueError("Input must be a list or an object with an 'events' list.")

    normalized: list[dict[str, Any]] = []
    for index, event in enumerate(events):
        if not isinstance(event, dict):
            raise ValueError(f"Event at index {index} is not an object.")
        normalized.append(event)
    return normalized


def summarize(scored: ScoredEvent) -> dict[str, Any]:
    event = scored.raw
    return {
        "score": scored.score,
        "confidence": scored.confidence,
        "penalties": scored.penalties,
        "title": event.get("title") or event.get("event") or "Untitled event",
        "event_type": event.get("event_type"),
        "chain": event.get("chain"),
        "themes": event.get("themes", []),
        "candidates": scored.candidates,
        "window": event.get("window"),
        "invalidation": event.get("invalidation"),
        "sources": event.get("sources", []),
    }


def score_and_rank(events: list[dict[str, Any]], top: int = 7) -> list[dict[str, Any]]:
    ranked = sorted((score_event(event) for event in events), key=lambda item: item.score, reverse=True)
    return [summarize(item) for item in ranked[: max(1, top)]]


def main() -> int:
    parser = argparse.ArgumentParser(description="Score A-share news radar events and candidates.")
    parser.add_argument("input", help="Path to JSON input, or '-' for stdin.")
    parser.add_argument("--top", type=int, default=7, help="Number of events to output.")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON output.")
    args = parser.parse_args()

    try:
        output = score_and_rank(load_events(args.input), args.top)
    except Exception as exc:  # noqa: BLE001 - CLI should show a concise error.
        print(f"score_events.py: {exc}", file=sys.stderr)
        return 1

    if args.pretty:
        print(json.dumps(output, ensure_ascii=False, indent=2))
    else:
        print(json.dumps(output, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

