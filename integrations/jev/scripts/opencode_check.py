"""One public-fixture request through the original SDK; no Windows I/O."""

import json
from pathlib import Path

from typesafe_sdk import Choice, Noul, Score, TypeSafeError

from typesafe_computer_use.models import Abort
from typesafe_computer_use.opencode import MODEL, make_opencode_client


def main():
    record = {"provider": "opencode", "expected_model": MODEL, "desktop_actions": 0}
    try:
        with make_opencode_client() as client:
            response = client.system_one(
                state={"status": "ERROR", "payment_made": False, "progress": "complete"},
                questions={
                    "status": Choice(
                        instructions="Which status is explicitly recorded?",
                        criteria={"0": "The status is OK", "error": "The status is ERROR"},
                    ),
                    "paid": Noul(instructions="Was a payment made according to payment_made?"),
                    "progress": Score(
                        instructions="Rate the recorded progress", criteria=["No progress", "Partial progress", "Complete"]
                    ),
                },
            )
            raw = response.raw_http_response
            wire = raw.json()
            choice, noul, score = response.answers["status"], response.answers["paid"], response.answers["progress"]
            record.update(
                {
                    "http_status": raw.status_code,
                    "model": response.model,
                    "sdk_class": type(client).__name__,
                    "request_count": client.calls,
                    "choice": choice.choice,
                    "confidence": choice.confidence,
                    "probabilities": choice.probabilities,
                    "noul": noul.noul,
                    "score": score.score,
                    "score_probabilities": score.probabilities,
                    "input_tokens": response.usage.input_tokens,
                    "output_tokens": response.usage.output_tokens,
                    "fixture_matches": choice.choice == "error" and noul.noul < 0.5 and score.score > 1.5,
                    "elapsed_ms": client.api_elapsed_ms,
                    "billing_source": wire.get(
                        "billing_source", wire.get("billingSource", raw.headers.get("x-opencode-billing-source"))
                    ),
                    "reported_cost": wire.get("cost"),
                }
            )
    except (Abort, TypeSafeError) as error:
        record.update(
            {
                "error_type": type(error).__name__,
                "message": str(error)
                if isinstance(error, Abort)
                else "Original SDK request/response validation failed; no retry performed",
            }
        )
    target = Path(__file__).resolve().parents[2] / "opencode-live-result.json"
    target.write_text(json.dumps(record, indent=2), encoding="utf-8")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
