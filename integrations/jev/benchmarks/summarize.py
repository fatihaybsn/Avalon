"""Aggregate independent fixture results without dropping failed runs."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import statistics
from datetime import UTC, datetime
from pathlib import Path

ENGINES = ("openai", "jev")
FAMILIES = (
    "form",
    "long-list",
    "menu-dialog",
    "grid",
    "text-editor",
    "dynamic",
    "ocr-visual",
    "recovery",
)


def percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    return sorted(values)[math.ceil(fraction * len(values)) - 1]


def source_snapshot(root: Path) -> dict[str, str]:
    files: list[Path] = []
    for directory in ("typesafe_computer_use", "tests", "benchmarks"):
        files.extend(path for path in (root / directory).rglob("*") if path.is_file() and "__pycache__" not in path.parts)
    files.extend(path for path in (root / "mcp.mjs", root / "pyproject.toml") if path.exists())
    return {path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(files)}


def collect(run_root: Path) -> list[dict]:
    records: list[dict] = []
    pattern = re.compile(r"^(?P<family>.+?)-seed(?P<seed>-?\d+)(?:-(?P<attempt>.+))?$")
    for engine in ENGINES:
        engine_root = run_root / engine
        if not engine_root.exists():
            continue
        for directory in sorted(path for path in engine_root.iterdir() if path.is_dir()):
            match = pattern.fullmatch(directory.name)
            result_path = directory / "result.json"
            case_path = directory / "case.json"
            if not match or not case_path.exists():
                continue
            case = json.loads(case_path.read_text(encoding="utf-8"))
            result = json.loads(result_path.read_text(encoding="utf-8")) if result_path.exists() else {}
            total_wall = None
            if result.get("launchedUtc") and result.get("completedUtc"):
                launched = datetime.fromisoformat(result["launchedUtc"].replace("Z", "+00:00"))
                completed = datetime.fromisoformat(result["completedUtc"].replace("Z", "+00:00"))
                total_wall = (completed - launched).total_seconds()
            records.append(
                {
                    "engine": engine,
                    "family": match.group("family"),
                    "seed": int(match.group("seed")),
                    "attempt": match.group("attempt") or "initial",
                    "partition": case.get("partition"),
                    "success": bool(result.get("success", False)),
                    "totalWallSeconds": total_wall,
                    "interactionSeconds": result.get("interactionSeconds"),
                    "actions": result.get("actions"),
                    "validationErrors": result.get("validationErrors"),
                    "resultPath": str(result_path),
                }
            )
    return records


def aggregate(records: list[dict]) -> dict[str, dict]:
    out = {}
    for engine in ENGINES:
        group = [record for record in records if record["engine"] == engine]
        successful_wall = [
            float(record["totalWallSeconds"]) for record in group if record["success"] and record["totalWallSeconds"] is not None
        ]
        successful_interaction = [
            float(record["interactionSeconds"])
            for record in group
            if record["success"] and record["interactionSeconds"] is not None
        ]
        out[engine] = {
            "runs": len(group),
            "successes": sum(record["success"] for record in group),
            "successRate": sum(record["success"] for record in group) / len(group) if group else 0,
            "medianSuccessfulTotalWallSeconds": statistics.median(successful_wall) if successful_wall else None,
            "p90SuccessfulTotalWallSeconds": percentile(successful_wall, 0.90),
            "p95SuccessfulTotalWallSeconds": percentile(successful_wall, 0.95),
            "medianSuccessfulInteractionSeconds": statistics.median(successful_interaction) if successful_interaction else None,
            "p90SuccessfulInteractionSeconds": percentile(successful_interaction, 0.90),
            "p95SuccessfulInteractionSeconds": percentile(successful_interaction, 0.95),
            "validationErrors": sum(record["validationErrors"] or 0 for record in group),
        }
    jev_wall = out["jev"]["medianSuccessfulTotalWallSeconds"]
    reference_wall = out["openai"]["medianSuccessfulTotalWallSeconds"]
    jev_interaction = out["jev"]["medianSuccessfulInteractionSeconds"]
    reference_interaction = out["openai"]["medianSuccessfulInteractionSeconds"]
    out["comparison"] = {
        "medianTotalWallSpeedup": reference_wall / jev_wall if jev_wall and reference_wall else None,
        "medianInteractionSpeedup": reference_interaction / jev_interaction
        if jev_interaction and reference_interaction
        else None,
    }
    return out


def write_report(root: Path, run_root: Path, out_dir: Path, label: str, order: str, note: str) -> None:
    records = collect(run_root)
    summary = aggregate(records)
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "schemaVersion": 2,
        "generatedUtc": datetime.now(UTC).isoformat(),
        "label": label,
        "engineOrder": order,
        "note": note,
        "runRoot": str(run_root),
        "sourceSnapshot": source_snapshot(root),
        "records": records,
        "summary": summary,
    }
    (out_dir / f"{label}.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")
    with (out_dir / f"{label}.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(records[0]) if records else ["engine"])
        writer.writeheader()
        writer.writerows(records)

    lines = [
        f"# {label}",
        "",
        note,
        "",
        f"Engine order: `{order}`",
        "",
        "| Engine | Success | Total wall median | Total wall P95 | Interaction median | Interaction P95 | Validation errors |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    for engine in ENGINES:
        item = summary[engine]
        lines.append(
            f"| {engine} | {item['successes']}/{item['runs']} | {item['medianSuccessfulTotalWallSeconds']:.3f}s | "
            f"{item['p95SuccessfulTotalWallSeconds']:.3f}s | {item['medianSuccessfulInteractionSeconds']:.3f}s | "
            f"{item['p95SuccessfulInteractionSeconds']:.3f}s | {item['validationErrors']} |"
        )
    wall_speedup = summary["comparison"]["medianTotalWallSpeedup"]
    interaction_speedup = summary["comparison"]["medianInteractionSpeedup"]
    lines.extend(
        [
            "",
            f"Median total-wall speedup: **{wall_speedup:.3f}x**",
            f"Median interaction speedup: **{interaction_speedup:.3f}x**",
            "",
            "| Family | Seed | Engine | Success | Total wall | Interaction | Actions | Errors |",
            "|---|---:|---|---:|---:|---:|---:|---:|",
        ]
    )
    for record in records:
        wall = f"{record['totalWallSeconds']:.3f}" if record["totalWallSeconds"] is not None else "n/a"
        interaction = f"{record['interactionSeconds']:.3f}" if record["interactionSeconds"] is not None else "n/a"
        lines.append(
            f"| {record['family']} | {record['seed']} | {record['engine']} | {record['success']} | "
            f"{wall} | {interaction} | {record['actions']} | {record['validationErrors']} |"
        )
    (out_dir / f"{label}.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("run_root", type=Path)
    parser.add_argument("out_dir", type=Path)
    parser.add_argument("label")
    parser.add_argument("--order", required=True)
    parser.add_argument("--note", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    write_report(root, args.run_root.resolve(), args.out_dir.resolve(), args.label, args.order, args.note)


if __name__ == "__main__":
    main()
