import test from "node:test";
import assert from "node:assert/strict";
import {
  approvalAuthorized,
  approvalChoiceFromTranscript,
} from "../electron/approvalPolicy.mjs";

test("dangerous approval scopes require an exact matching user choice", () => {
  assert.equal(approvalChoiceFromTranscript("yes"), "once");
  assert.equal(approvalChoiceFromTranscript("allow it once"), "once");
  assert.equal(approvalChoiceFromTranscript("allow it for this session"), "session");
  assert.equal(approvalChoiceFromTranscript("always allow this"), "always");
  assert.equal(approvalChoiceFromTranscript("no, deny it"), "deny");
  assert.equal(approvalChoiceFromTranscript("yes but what does it do"), "other");

  assert.equal(
    approvalAuthorized({ stage: "awaiting_user", userResponse: "yes" }, "once"),
    true,
  );
  assert.equal(
    approvalAuthorized({ stage: "awaiting_user", userResponse: "yes" }, "always"),
    false,
  );
  assert.equal(
    approvalAuthorized({ stage: "awaiting_model", userResponse: "always allow" }, "always"),
    false,
  );
});

test("Turkish approvals preserve scope and refuse qualified or ambiguous consent", () => {
  assert.equal(approvalChoiceFromTranscript("EVET"), "once");
  assert.equal(approvalChoiceFromTranscript("Yalnızca bu kez"), "once");
  assert.equal(approvalChoiceFromTranscript("Bu oturum için izin ver"), "session");
  assert.equal(approvalChoiceFromTranscript("Her zaman izin ver"), "always");
  assert.equal(approvalChoiceFromTranscript("Hayır"), "deny");
  assert.equal(approvalChoiceFromTranscript("Evet ama önce açıkla"), "other");
  assert.equal(approvalChoiceFromTranscript("Her zaman izin verme"), "other");
  assert.equal(approvalAuthorized({ stage: "awaiting_user", userResponse: "evet" }, "always"), false);
});
