// Turkish mode keeps the existing prompts. English mode changes presentation
// language only; task contracts, tool identifiers and approval rules stay shared.
export function conversationLanguage(source = process.env) {
  return source.IRIS_CONVERSATION_LANGUAGE === "en" ? "en" : "tr";
}

export function languageInstructions(language = conversationLanguage()) {
  if (language !== "en") return "";
  return "Avalon English mode is selected in the application for this turn. Use English for all user-facing conversation, task proposals and approval questions, native clarification questions and choice labels, progress explanations, and final task results, even when the user input or earlier history is Turkish. This setting overrides language preferences inferred from conversation history; a spoken request to switch languages does not change the application setting. Apply the mode supplied for each new turn; never save this mode as a lasting user preference in memory. When addressing the user, use 'sir' naturally and sparingly. Preserve the existing personality, detail, workflow, tool contracts and confirmation requirements. Keep names, literal quotations, paths, commands, identifiers, exact targets and scope intact. Preserve any language explicitly requested for an artifact or quoted content; explain the work in English.";
}

const SPEECH = {
  approval: ["Başlatmamı onaylıyor musun?", "Do you approve starting this task?"],
  greeting: ["Merhaba efendim, bugün ne yapıyoruz?", "Hello sir, what are we doing today?"],
  goodbye: ["Görüşürüz.", "Goodbye."],
  replyFailed: ["Yanıtı alamadım; konuşma bağlantısında bir sorun var.", "I couldn't get the reply; there is a problem with the conversation connection."],
  replyInvalid: ["Yanıtı işleyemedim; bu yanıttan görev başlatmadım.", "I couldn't process the reply; I haven't started any task from it."],
  connectionFailed: ["Konuşma bağlantısını kuramadım. Bağlantı ayarlarını kontrol et.", "I couldn't establish the conversation connection. Please check the connection settings."],
  actionFailed: ["Bu işlemi gerçekleştiremedim. Ekrandaki isteği kontrol et.", "I couldn't carry out this action. Please check the on-screen request."],
  taskQueued: ["Görevi sıraya aldım.", "I've queued the task."],
  taskSubmitted: ["Görevi başlatma isteğini gönderdim.", "I've sent the request to start the task."],
  taskDiscarded: ["Tamam, görevi göndermedim.", "Okay, I haven't sent the task."],
  taskStopRequested: ["Görevi durdurma isteğini gönderdim.", "I've sent the request to stop the task."],
  taskStatus: ["Görev durumu", "Task status"],
  unknown: ["bilinmiyor", "unknown"],
  hermesReady: ["Hermes bağlantısı hazır.", "The Hermes connection is ready."],
  hermesUnavailable: ["Hermes bağlantısını kuramadım.", "I couldn't connect to Hermes."],
  okay: ["Tamam.", "Okay."],
  choices: ["Seçenekler", "Options"],
};

export function spokenText(key, language = conversationLanguage()) {
  return SPEECH[key][language === "en" ? 1 : 0];
}
