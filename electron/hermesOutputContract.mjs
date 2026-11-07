const EVALUATION_OUTCOMES = Object.freeze(["approved", "revision_required", "needs_review", "failed"]);
const names = (value, separator) => Object.freeze([...new Set((value || "").split(separator).map((item) => item.trim()).filter(Boolean))]);

// These are literal top-level field names, not JSON paths or a provider schema.
export function normalizeHermesOutputContract(step) {
  return Object.freeze({
    outputType: step.outputType || "text",
    requiredFields: names(step.requiredFields, ","),
    requiredFiles: names(step.requiredFiles, /\r?\n/),
    outcomes: step.outputType === "evaluation" ? EVALUATION_OUTCOMES : Object.freeze([]),
  });
}

export function hermesOutputInstructions(contract) {
  const structured = ["json", "evaluation"].includes(contract.outputType);
  return [
    structured ? "Yalnızca geçerli bir JSON nesnesi döndür." : "Sonucu ve üretilen dosyaları açıkça belirt.",
    structured && contract.requiredFields.length ? "Zorunlu üst seviye JSON alanları (adları birebir kullan, iç içe yol olarak yorumlama): " + JSON.stringify(contract.requiredFields) + ". Her alan bulunmalı; null veya boş metin olamaz." : "",
    contract.outcomes.length ? "Zorunlu outcome alanı şu değerlerden biri olmalı: " + JSON.stringify(contract.outcomes) + ". Açıklama için isteğe bağlı reason alanını kullan." : "",
    contract.requiredFiles.length ? "Gerekli göreli dosyalar: " + JSON.stringify(contract.requiredFiles) : "",
  ].filter(Boolean).join("\n");
}
