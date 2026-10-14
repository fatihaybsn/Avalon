# 10 — OpenCode dış işçisi ve seçilen işçinin yönetimi

14 Ekim 2026 kullanıcı kararıyla OpenCode kodlama işçisi de açık Full access kullanır. Bu, önceki Windows OS izolasyonu koşulunun bu işçi için değişmesidir. Native izin/kimlik ve OpenClaw görev sınırı korunur; çalışma klasörü ve ayrı profil bütün disk/ağ erişimini izole etmez. Genel JARVIS host exec deny politikası açılmaz.

08'in Space Bunny görüntü + guarded OpenClaw MCP yolu yeniden kurulmadı. Aynı backend hazırlığı 10 için ayrı `jarvis-opencode-main` runtime'ında yeniden kullanılır; 08'in GUI runtime'ı kalır. Ana model aynı `opencode/space-bunny-free`; model-scoped runtime normal OpenCode CLI yoludur. Provider HTTP'ye doğrudan model isteği, sessiz ücretli/model/işçi alternatifi veya ikinci koordinatör yoktur. 05 Dreaming değişmez.

## Bağlantı ve kurulum

Kurulu native Windows OpenCode `2.0.28`, gerçek server OpenAPI `3.1.0` ve aynı sürümün `@opencode/client` Promise typeları esas alındı. `@opencode/sdk` in-process host'u kullanılmaz. Dış server `127.0.0.1:18791` üzerinde HTTP Basic kimliğiyle JARVIS'e özel çalışır. Global kullanıcı OpenCode servisi ve FURY ayarları değiştirilmez.

README 4f kurulum sırasını izler. `scripts/jarvis-opencode-profile.mjs prepare <native-binary> --full-access` sürümü kontrol eder ve repo dışında profili hazırlar. `scripts/jarvis-opencode-server.ps1 -Action Start` server'ı normal başlatır; Check gerçek version/PID kimliğini doğrular. Provider key yalnız server'ın seçili model erişimine verilir; shell environment ayrı hazırlanır. `scripts/jarvis-worker-config.mjs --full-access` ana modelin CLI rotası ile tek `jarvis_worker` aracını açar. Genel host shell ve research sınırları korunur. Gateway değişikliği normal restart/reload ile yükler.

## Görev ve yönetim

09 ile ortak `worker-contract.ts`: request, purpose, scope, context, output, verification, somut projectRoot, worker, model ve güncel revision doğrulanır. Cwd/grant/proje/görev kimliği host'tan gelir. Model aracı kimlik/grant oluşturmaz. İlk devirde Codex veya OpenCode seçimi mevcut gerçek kullanıcı ifadesindeki tek açık işçi adına bağlıdır; belirsiz seçim sorulur, başka araca düşülmez. Codex'in modeli açık verilir; OpenCode bu aşamada seçili Space Bunny Free'yi kullanır.

`jarvis_worker` start/status/continue/steer/interrupt için tek model arayüzüdür. Host `jarvis.worker.*` RPC'leri aynı mevcut scope/session/device/user kimliğini denetler. Codex 09'un tek native harness'inde kalır; ikinci Codex yürütücüsü yoktur. OpenCode V2 session.create/prompt, delivery steer/queue, event stream, message/diff ve interrupt kullanır. Native session/inbox/message/request/event kimlikleri 06 WorkLedger'a bağlanır. Yeni görev DB/queue/model sınıflandırıcısı oluşturulmaz. Belirsiz native create/send, event akışının kaybı ve yeniden başlatma otomatik tekrar edilmez.

Space Bunny'nin kısa ortak yönergesi en basit yeterli çözümü seçer; araştırma/mimari/aşamalar yalnız gerektiğinde kullanılır. Gerçek çıktı/diff ve kontroller kullanıcı hedefiyle karşılaştırılır; gerekli düzeltme aynı işe gönderilir. Yeni koşul güncel görev revision'ıyla bağlanır. Model yalnız açıklanmış gerekçe ve somut bulguyu mevcut work note'a yazabilir; gizli reasoning veya opaque provider dump kayıt değildir. Notepad isteği varsa mevcut guarded draft/Windows araçları kullanılır; her iş için Notepad veya sabit üç/beş prompt şartı yoktur.

## Sorular, izin ve iptal

Native permission/form bekleyen kimlikleri status'ta kullanıcıya sunulur. Çözülmeden yeni devam/yönlendirme kimliği gönderilmez. `jarvis.worker.answer`, yalnız mevcut asli operator/user/device/session ve operator.approvals yetkisiyle OpenCode'un gerçek request ID'sine once/reject veya form cevabı iletir; modele sunulan araçlarda answer/resolver yoktur. Native schema cevabı doğrular, çözülen kimlik yeniden kullanılamaz. Sesli çözüm 13'tedir; Electron'a yeni form paneli bu aşamada eklenmedi. Yetkili karar arayüzü yoksa gerçek pending durumunda beklenir, model otomatik cevap vermez.

Dış işçinin mevcut görev grant'ı, yalnız yönetici yanıtının sona ermesiyle düşürülmez; özgün TTL, session invalidation ve kullanıcı iptali geçerlidir, süre kendiliğinden uzatılmaz. Yeni kullanıcı görevi, bitmiş aynı conversation işinin grant'ını bırakır. Belirsiz/çoklu canlı kapsamda araç seçimi kapalıdır. Gateway kapanırken bilinen aktif işçiye native interrupt gönderilir. Receipt ve idle interrupt:false cevabı bütün alt süreçlerin durduğunu kanıtlamaz; force-kill yoktur. Manager CLI iptali de kendi bilinen native session'ına interrupt gönderir; 08'in önceki GUI cleanup yolu değiştirilmedi.

## 14 için ham kayıt envanteri

- OpenClaw: mevcut conversation/run geçmişi, plugin state WorkLedger/olay/proje metadata, Gateway logları; ikinci hafıza veritabanı yoktur.
- `%USERPROFILE%/.openclaw-jarvis/opencode/`: ayrı config, data/opencode/opencode.db, cache, state, native log/repo/snapshot ve home alanları. Bunlar işçi teknik kayıtlarıdır, ortak Memory Core değildir.
- `server.json` yalnız repo dışı generated server kimliği/password ve native binary/PID bilgisini taşır; provider key dosyaya kopyalanmaz. Server/shell environment ayrı tutulur. Full access nedeniyle disk sırlarının OS izolasyonu olduğu söylenmez.
- Manager başına `TEMP/jarvis-gui-turn-*` konumunda kısa MCP config ve staged bağlam vardır; hazır backend kendi sahipli scratch'ini temizler. Server'ın native session/konum kaydı kalabilir. Native `TEMP/opencode` alanı da envanterdedir; ephemeral bütün disk/provider izlerinin silinmesi değildir.
- Sahipli model çağrısız native fixture session/form/shell kayıtları private DB'de kaldı; fixtures olarak adlandırıldı. Bunlar kullanıcı notu veya genel hafıza değildir. 14'ün gerçek ham saklama/silme politikası henüz uygulanmadı.

## Doğrulama ve gerçek durum

17 ilgili OpenCode/Codex ortak sözleşme/kimlik/izin/ortam/soru/yönlendirme/iptal testi ve root TypeScript kontrolü geçti. Private server'da gerçek 401 auth reddi, version/PID, ayrı config/data/cache/state/DB yolları; native session/form pending→answered ve idle interrupt:false doğrulandı. Native shell çocuk sürecinde PATH mevcut; JARVIS_GATEWAY_TOKEN, GEMINI_API_KEY, JARVIS_DREAMING_GEMINI_API_KEY, OPENCODE_API_KEY ve server password varlıkları false, süreç exit 0 döndü. Sırlar yazdırılmadı.

Gateway'in eski manifest cache'i ve yardımcı modülün top-level await yükleme uyumsuzluğu giderildi; helper sync loader'a uyumludur. Gerçek jarvis.worker.setup iki işçiyi, authenticated/private OpenCode 2.0.28 ve ana Space Bunny CLI runtime'ını bildirdi. Güncel son yükleme sonucu geliştirme durumu kaydında tutulur.

10. adımın kod/server/config entegrasyonu ve burada listelenen dar native kontrolleri tamamlandı. Kullanıcı kararıyla [09–10 toplu üç promptlu not uygulaması kabulü](09_10_TOPLU_DOGRULAMA.md) bu adımın kapanışından ayrı ve henüz yapılmadı; canlı yönetim başarısı iddia edilmez. 09'un Codex canlı kabulü de ayrıdır. 11–16 başlatılmadı.

Resmi V2 kaynakları: [permissions](https://dev.opencode.ai/v2/docs/permissions/), [config](https://dev.opencode.ai/v2/docs/config/), [CLI/private server](https://dev.opencode.ai/v2/docs/cli/). Canlı sürümün OpenAPI'si ve kurulu client typeları bu sayfalardan daha belirleyicidir.

Son yükleme: sıcak reload drain timeout ardından safe/0 aktif iş native preflight ile normal Gateway restart yapıldı. 18:38:17 ready; worker.setup başarılı, Gateway health ok:true, plugins.errors/unavailable boş ve modelRuntime.degraded:false. Son kaynaklar bu gerçek yüklemede kullanılabilir; çok promptlu canlı proje kabulü henüz yapılmadı.

14 Ekim son kullanıcı kararı: kodlama model/düşünme alanı atlanırsa Codex Luna 6/xhigh, OpenCode Space Bunny Free/max kullanır. Açık kullanıcı seçimi önceliklidir; native OpenCode ModelRef.variant ve Codex sessions.create.thinkingLevel alanına iletilir. OpenCode gerçek katalogdaki enabled model/variant desteğiyle kontrol edilir. Ana Space Bunny yönetici CLI'si de max varyantını kullanır. Üç promptlu kabul son kullanıcı yönlendirmesiyle başlatılmadı.
