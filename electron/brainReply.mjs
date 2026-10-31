import { conversationLanguage, spokenText } from "./conversationLanguage.mjs";

export function proposalReadback({ task = "", summary = "", readback = "" }, language = conversationLanguage()) {
  const spoken = String(readback || "").trim();
  // A contextual readback includes its own single approval question. Legacy or
  // non-spoken payloads use the short goal; neither path reads execution metadata.
  if (spoken && spoken.length <= 600 && /[?？؟]$/.test(spoken) &&
      !/```|(?:^|\n)\s*(?:Goal|User-provided context|Constraints|Acceptance criteria|Expected output)\s*:/i.test(spoken)) return spoken;
  const brief = String(task || "").trim();
  // Older staged tasks have no summary; their app-generated brief starts with Goal.
  const goal = String(summary || "").trim() || (brief.startsWith("Goal:\n") ? brief.slice(6).split("\n\n")[0] : brief);
  return `${goal}\n${spokenText("approval", language)}`;
}

// Natural readback and full execution brief share the gate's immutable proposal identity.
export function deliverBrainReply(answer, { stageProposal, transcript, speak, proposed, language = conversationLanguage() }) {
  if (!answer.proposal) {
    transcript(answer.reply);
    speak(answer.reply, { priority: true });
    return;
  }
  const staged = stageProposal(answer.proposal);
  if (!staged.ok) throw new Error(`Could not stage the requested task: ${staged.reason}`);
  const text = proposalReadback(staged.proposal, language);
  transcript(text);
  speak(text, { critical: true, priority: true, proposalId: staged.proposal.id });
  proposed(staged.proposal);
}
