export const APPROVAL_CHOICES = new Set(["once", "session", "always", "deny"]);

export function approvalChoiceFromTranscript(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/\u0307/g, "")
    .replace(/[^\p{L}\p{N}'’]+/gu, " ")
    .trim();
  if (!normalized) return "other";
  if (/^(hayır|hayir|reddet|iptal|vazgeç|vazgec|dur|izin verme|yapma)( lütfen| lutfen)?$/.test(normalized)) return "deny";
  if (/^(her zaman|her zaman izin ver|her zaman onayla|bundan sonra izin ver|bundan sonra her zaman izin ver)$/.test(normalized)) return "always";
  if (/^(bu oturum|bu oturum için|bu oturum icin|bu oturum boyunca|bu oturum için izin ver|bu oturum icin izin ver)$/.test(normalized)) return "session";
  if (/^(evet|tamam|olur|onaylıyorum|onayliyorum|izin ver|devam et|yalnızca bu kez|yalnizca bu kez|sadece bu kez|bir kez|bu kez)( lütfen| lutfen)?$/.test(normalized)) return "once";
  if (/^(no|nope|deny|denied|reject|cancel|stop|do not|don't)\b/.test(normalized)) return "deny";
  if (/\b(always|from now on|every time)\b/.test(normalized)) return "always";
  if (/\b(session|this conversation|until i quit)\b/.test(normalized)) return "session";
  if (
    /^(allow|approve)( it| this| that)? (once|this time)$/.test(normalized) ||
    /^(once|just once)$/.test(normalized)
  ) {
    return "once";
  }
  if (/^(yes|yeah|yep|ok|okay|sure|approve|approved|allow|go ahead|do it)( please)?$/.test(normalized)) {
    return "once";
  }
  return "other";
}

export function approvalAuthorized(pending, requestedChoice) {
  const choice = String(requestedChoice || "").toLowerCase();
  return Boolean(
    pending &&
      pending.stage === "awaiting_user" &&
      APPROVAL_CHOICES.has(choice) &&
      approvalChoiceFromTranscript(pending.userResponse) === choice,
  );
}
