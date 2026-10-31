"""Original SDK against a synthetic OpenCode transport; no live credentials."""

import json

import httpx2
import pytest
from typesafe_sdk import Choice, Noul, Score, TypeSafeAPIResponseValidationError, TypeSafeAPITimeoutError, TypeSafeClient

from typesafe_computer_use.models import Abort
from typesafe_computer_use.opencode import ENDPOINT, MODEL, make_opencode_client


def question_set():
    return {
        "item": Choice(
            instructions="Select the observed control", criteria={"0": "Save", "7": "Cancel", "error": "An error is visible"}
        ),
        "ok": Noul(instructions="Does the field contain the requested text?"),
        "rating": Score(instructions="Rate completion", criteria=["None", "Partial", "Complete"]),
    }


def payload():
    return {
        "model": MODEL,
        "usage": {"input_tokens": 10, "output_tokens": 5},
        "answers": {
            "item": {"type": "choice", "choice": "error", "confidence": 0.8, "probabilities": {"0": 0.1, "7": 0.1, "error": 0.8}},
            "ok": {"type": "noul", "noul": 0.91},
            "rating": {
                "type": "score",
                "score": 1.8,
                "confidence": 0.8,
                "legend": {"0": "None", "1": "Partial", "2": "Complete"},
                "probabilities": {"0": 0.0, "1": 0.2, "2": 0.8},
            },
        },
    }


def client(handler):
    return make_opencode_client(api_key="offline-fixture-not-real", transport=httpx2.MockTransport(handler))


def test_original_sdk_preserves_native_contract_and_decodes_all_three_types(monkeypatch):
    monkeypatch.setenv("TYPESAFE_BASE_URL", "https://unrelated.invalid")
    monkeypatch.setenv("TYPESAFE_DEFAULT_MODEL", "jev-1.13")
    monkeypatch.setenv("TYPESAFE_API_KEY", "unrelated-paid-fixture")
    seen = []

    def handle(request):
        seen.append(request)
        assert str(request.url) == ENDPOINT
        assert str(request.url).count("/v1/systemone") == 1
        assert request.headers["authorization"] == "Bearer offline-fixture-not-real"
        data = json.loads(request.content)
        assert data["model"] == MODEL
        assert data["state"] == {"goal": "Save the text"}
        assert set(data["questions"]["item"]["criteria"]) == {"0", "7", "error"}
        assert data["questions"]["ok"]["type"] == "noul"
        assert data["questions"]["rating"]["type"] == "score"
        return httpx2.Response(200, json=payload())

    with client(handle) as engine:
        assert type(engine) is TypeSafeClient
        result = engine.system_one(state={"goal": "Save the text"}, questions=question_set())
        assert result.model == MODEL
        assert result.answers["item"].choice == "error"  # an ordinary offered label, NOT HTTP failure
        assert result.answers["item"].confidence == 0.8
        assert result.answers["item"].probabilities == {"0": 0.1, "7": 0.1, "error": 0.8}
        assert result.answers["ok"].noul == 0.91
        assert result.answers["rating"].score == 1.8
        assert result.answers["rating"].probabilities == {0: 0.0, 1: 0.2, 2: 0.8}
        assert engine.calls == len(seen) == 1


@pytest.mark.parametrize("status", [301, 302, 401, 403, 429, 500, 503])
def test_http_errors_are_sanitized_never_retried_or_redirected(status):
    seen = []

    def handle(request):
        seen.append(request)
        return httpx2.Response(status, headers={"Location": "https://other.invalid"}, text="private provider detail")

    with client(handle) as engine, pytest.raises(Abort) as error:
        engine.system_one(state="state", questions=question_set())
    assert len(seen) == 1
    assert str(status) in str(error.value)
    assert "private provider detail" not in str(error.value)


@pytest.mark.parametrize("override", [{"model": "jev-1.13"}, {"extra_body": {"model": "jev-1.13"}}])
def test_paid_model_overrides_are_blocked_before_network(override):
    seen = []
    with client(lambda request: seen.append(request)) as engine, pytest.raises(Abort, match=r"jev-1\.13-free"):
        engine.system_one(state="state", questions=question_set(), **override)
    assert not seen


def test_paid_response_model_is_refused():
    value = payload()
    value["model"] = "jev-1.13"
    with client(lambda _: httpx2.Response(200, json=value)) as engine, pytest.raises(Abort, match="unexpected model"):
        engine.system_one(state="state", questions=question_set())


def test_malformed_json_and_missing_model_stop():
    for value in [httpx2.Response(200, text="not-json"), httpx2.Response(200, json={})]:
        with client(lambda _, response=value: response) as engine, pytest.raises(Abort):
            engine.system_one(state="state", questions=question_set())


def test_malformed_choice_is_rejected_by_original_sdk():
    value = payload()
    del value["answers"]["item"]["probabilities"]
    with client(lambda _: httpx2.Response(200, json=value)) as engine, pytest.raises(TypeSafeAPIResponseValidationError):
        engine.system_one(state="state", questions=question_set())


def test_timeout_is_not_replayed():
    seen = []

    def handle(request):
        seen.append(request)
        raise httpx2.ReadTimeout("offline timeout", request=request)

    with client(handle) as engine, pytest.raises(TypeSafeAPITimeoutError):
        engine.system_one(state="state", questions=question_set())
    assert len(seen) == 1


def test_cancellation_blocks_before_and_after_http(monkeypatch, tmp_path):
    stop = tmp_path / "STOP"
    monkeypatch.setenv("CLICKER_STOP_FILE", str(stop))
    seen = []

    def handle(request):
        seen.append(request)
        stop.write_text("stop")
        return httpx2.Response(200, json=payload())

    with client(handle) as engine:
        with pytest.raises(Abort, match="host requested stop"):
            engine.system_one(state="state", questions=question_set())
        with pytest.raises(Abort, match="host requested stop"):
            engine.system_one(state="state", questions=question_set())
    assert len(seen) == 1


def test_only_opencode_client_exists_even_with_obsolete_provider_environment(monkeypatch):
    from typesafe_computer_use import runner

    sentinel = object()
    monkeypatch.setattr(runner, "make_opencode_client", lambda: sentinel)
    for obsolete_value in ("retired-provider", "typesafe", "vercel", "unknown"):
        monkeypatch.setenv("CLICKER_PROVIDER", obsolete_value)
        assert runner.decision_client() is sentinel


def test_missing_opencode_key_does_not_borrow_other_provider_keys(monkeypatch):
    from typesafe_computer_use import opencode

    monkeypatch.setattr(opencode, "opencode_token", lambda: None)
    monkeypatch.setenv("TYPESAFE_API_KEY", "unrelated-paid-fixture")
    monkeypatch.setenv("AI_GATEWAY_API_KEY", "unrelated-paid-gateway-fixture")
    with pytest.raises(Abort, match="OpenCode key missing"):
        make_opencode_client()


def test_sdk_timeout_produces_an_aborted_run_report_without_gui_or_success(monkeypatch, tmp_path):
    from typesafe_computer_use import runner

    def handle(request):
        raise httpx2.ReadTimeout("offline timeout", request=request)

    engine = client(handle)
    monkeypatch.setattr(runner, "decision_client", lambda: engine)
    monkeypatch.setattr(runner, "run_step", lambda cfg, ctx, *_: ctx.system_one(state="state", questions=question_set()))
    result = runner.run(runner.RunConfig(goal="Offline failure fixture", out=tmp_path), lambda typesafe, _: typesafe)
    assert result.outcome.startswith("aborted (decision provider failed:")
    report = json.loads((tmp_path / "run.json").read_text())
    assert report["goal_achieved"] is None
    assert report["steps_taken"] == 0
    assert report["decision_api"]["provider"] == "opencode"
    assert report["decision_api"]["attempts"] == 1
