import test from "node:test";
import assert from "node:assert/strict";
import { deliverBrainReply, proposalReadback } from "../electron/brainReply.mjs";
import { decodeBrainReply, VoiceRelay } from "../electron/voiceRelay.mjs";
import { proposeHermesTask, resetHermesGate, getHermesProposal, claimConfirmedProposal, markModelTurnComplete, recordUserResponse, restartProposalReadback } from "../electron/hermesGate.mjs";

test("recorded suggestion wording cannot become task speech or a second confirmation", () => {
  resetHermesGate();
  const frames = [], transcripts = [], proposals = [];
  const relay = new VoiceRelay({ send: (frame) => frames.push(frame), audio: () => {}, interrupt: () => {} });
  relay.connect();
  const answer = decodeBrainReply(JSON.stringify({
    reply: "Tamam, masaüstüne adı Fatih olan yeni bir metin belgesi oluşturmanı öneriyorum. Onaylarsan hemen hazırlarım.",
    proposal: { goal: "Masaüstüne Fatih.txt oluştur", constraints: ["Üzerine yazma"] },
  }));
  const brief = "Goal:\nMasaüstüne Fatih.txt oluştur\n\nConstraints:\n- Üzerine yazma";
  deliverBrainReply(answer, {
    stageProposal: (proposal) => proposeHermesTask(brief, "normal", { sessionId: "s", summary: proposal.goal }),
    transcript: (text) => transcripts.push(text),
    speak: (text, options) => relay.enqueue(text, options),
    proposed: (proposal) => proposals.push(proposal),
  });
  assert.deepEqual(transcripts, [proposalReadback({ task: brief, summary: answer.proposal.goal })]);
  assert.equal(frames.length, 1);
  assert.doesNotMatch(frames[0], /öneriyorum|Onaylarsan/);
  assert.equal(relay.active.text, proposalReadback({ task: brief, summary: answer.proposal.goal }));
  assert.doesNotMatch(relay.active.text, /Goal:|Constraints:|Üzerine yazma/);
  assert.equal(relay.active.proposalId, proposals[0].id);
  assert.equal(getHermesProposal().task, brief);
  assert.equal(getHermesProposal().stage, "awaiting_readback");
  assert.equal(claimConfirmedProposal({ proposalId: proposals[0].id, sessionId: "s" }).ok, false);
  markModelTurnComplete();
  recordUserResponse("Tamam", { sessionId: "s" });
  const confirmed = claimConfirmedProposal({ proposalId: proposals[0].id, sessionId: "s" });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.proposal.task, brief, "execution must retain all unspoken constraints");
  resetHermesGate();
});

test("ordinary advice remains the brain's unmodified answer", () => {
  const spoken = [], transcripts = [];
  const reply = "Bu yaklaşımı öneriyorum; önce maliyetini birlikte değerlendirelim.";
  deliverBrainReply({ reply, proposal: null }, {
    stageProposal: () => assert.fail("discussion must not stage a task"),
    transcript: (text) => transcripts.push(text),
    speak: (text) => spoken.push(text),
    proposed: () => assert.fail("discussion must not emit a proposal"),
  });
  assert.deepEqual(spoken, [reply]);
  assert.deepEqual(transcripts, [reply]);
});

test("a failed task stage cannot announce a confirmation or a submitted task", () => {
  assert.throws(() => deliverBrainReply({ reply: "Başlattım.", proposal: { goal: "task" } }, {
    stageProposal: () => ({ ok: false, reason: "empty_task" }),
    transcript: () => assert.fail("must not announce a rejected proposal"),
    speak: () => assert.fail("must not voice a rejected proposal"),
    proposed: () => assert.fail("must not emit a rejected proposal"),
  }), /empty_task/);
});

test("short confirmation survives readback restart and older technical briefs stay out of speech", () => {
  resetHermesGate();
  const goal = "Windows masaüstündeki Fatih.txt dosyasını sil";
  const brief = `Goal:\n${goal}\n\nUser-provided context:\nC:\\Users\\Fatih\\Desktop\\Fatih.txt\n\nConstraints:\n- Yalnızca Fatih.txt silinsin\n\nAcceptance criteria:\n- Silme sonrası doğrula\n\nExpected output:\nSilme sonucu`;
  const staged = proposeHermesTask(brief, "normal", { sessionId: "s", summary: goal }).proposal;
  assert.equal(proposalReadback(staged), `${goal}\nBaşlatmamı onaylıyor musun?`);
  assert.equal(proposalReadback({ task: brief }), proposalReadback({ task: brief, summary: goal }));
  assert.doesNotMatch(proposalReadback({ task: brief }), /Goal:|User-provided context:|Constraints:|Acceptance criteria:|Expected output:/);
  assert.equal(restartProposalReadback({ proposalId: staged.id, sessionId: "s" }), true);
  assert.equal(getHermesProposal().task, brief);
  assert.equal(getHermesProposal().summary, goal);
  assert.equal(getHermesProposal().id, staged.id);
  resetHermesGate();
});

test("contextual task readbacks are spoken verbatim once and survive replay with the same proposal", () => {
  const cases = [
    { goal: "Masaüstündeki Fatih.txt dosyasını sil", readback: "Fatih.txt'yi masaüstünden sileceğim. Devam edeyim mi?" },
    { goal: "Masaüstüne yeni Fatih.txt dosyasını oluştur", readback: "Bu kez belgenin adını Fatih.txt koyacağım. Oluşturmamı onaylıyor musun?" },
  ];
  for (const { goal, readback } of cases) {
    resetHermesGate();
    const answer = decodeBrainReply(JSON.stringify({ reply: "", proposal: { goal, readback, constraints: ["Diğer dosyalara dokunma"] } }));
    const brief = `Goal:\n${goal}\n\nConstraints:\n- Diğer dosyalara dokunma`;
    const spoken = [], transcripts = [];
    deliverBrainReply(answer, {
      stageProposal: (proposal) => proposeHermesTask(brief, "normal", { sessionId: "s", summary: proposal.goal, readback: proposal.readback }),
      transcript: (text) => transcripts.push(text),
      speak: (text, options) => spoken.push({ text, options }),
      proposed: () => {},
    });
    assert.deepEqual(transcripts, [readback]);
    assert.equal(spoken.length, 1);
    assert.equal(spoken[0].text, readback, "do not add a stock opening or a second question");
    const staged = getHermesProposal();
    assert.equal(staged.readback, readback);
    assert.equal(staged.task, brief);
    assert.equal(claimConfirmedProposal({ proposalId: staged.id, sessionId: "s" }).ok, false);
    assert.equal(restartProposalReadback({ proposalId: staged.id, sessionId: "s" }), true);
    assert.equal(proposalReadback(getHermesProposal()), readback);
    assert.equal(getHermesProposal().id, spoken[0].options.proposalId);
    resetHermesGate();
  }
});

test("invalid spoken readbacks use the short goal without exposing technical details", () => {
  const goal = "Yalnızca Fatih.txt dosyasını sil";
  const task = `Goal:\n${goal}\n\nConstraints:\n- Diğer dosyalara dokunma`;
  for (const readback of ["", "Fatih.txt dosyasını sileceğim.", "Goal: Fatih.txt\nConstraints: sil\nOnaylıyor musun?", "x".repeat(601) + "?"]) {
    const text = proposalReadback({ task, summary: goal, readback });
    assert.ok(text.includes(goal));
    assert.doesNotMatch(text, /Goal:|Constraints:|Şunu yapacağım/);
    assert.equal((text.match(/\?/g) || []).length, 1);
  }
});
