# 09 — Native Codex dış işçisi

Kullanıcının 14 Ekim 2026 kararıyla yalnız seçilen Codex işi Full access kullanır. Bu seçim proje dışındaki dosyalara ve ağa gerçek işletim sistemi erişimi verebilir; çalışma klasörü ve ayrı hesap profili dosya izolasyonu değildir. Ana JARVIS/research araç sınırları korunur. Space Bunny ana modeldir; genel OpenCode entegrasyonu 10'a aittir.

Tek yürütücü resmi `@openclaw/codex@2026.10.2`, sabit Windows stable Codex `0.160.0` binary ve native stdio app-server'dır. Ayrı agent `jarvis-codex`, kullanıcı tarafından bağlanan `openai:jarvis-codex` hesabını kullanır. FURY credential/state ve masaüstü alpha binary alınmaz. Model görev girişinde açık seçilir; ücretli veya başka model yedeği yoktur.

`jarvis.codex.start/status/continue/steer/interrupt` mevcut OpenClaw görev kapsamı ve kayıtlarına bağlanır. Giriş somut projectRoot, worker, revision ile request/purpose/scope/context/output/verification alanlarını doğrular; bu bilgiler ana görevden doldurulabilir. Full access başlangıcı ayrıca operator.admin, aynı kullanıcı/cihaz/session ve canlı grant ister. Registry'nin zorunlu operator.write tanımı bu ek handler kontrolünü kaldırmaz.

Native session/thread/turn/item/request olayları 06 kaydına bağlanır. Reasoning kullanıcı kaydına yazılmaz. Sonuç ve diff incelemesi JARVIS'e aittir; turn tamamlanması talebin kabul edildiği anlamına gelmez. Devam/yönlendirme aynı işçiyi kullanır. Gerçek native sorular bekler; model kullanıcı adına cevap vermez. Sesli karar 13'te bağlanacaktır. İptal native chat.abort/turn interrupt yoludur; receipt bütün alt süreçlerin durduğunu kanıtlamaz. Force-kill veya alternatif yürütücü yoktur.

JARVIS/Codex yönergeleri `plugins/jarvis/codex.ts` içinde göreve bağlanır: kısa işe kısa devir, gerekli rutin düzenleme/terminal/kontrol için tekrarlı soru yok, kapsam değişirse kullanıcı kararı, gerçek diff ve doğrulama üzerinden sonuç incelemesi. Bu yönerge Space Bunny'ye doğrudan provider isteği başlatmaz.

Kullanıcı girişi: `./scripts/jarvis-codex-profile.ps1 -Action Login`. Durum: aynı betik `-Action Check`. Normal Gateway başlatma: `pwsh -NoProfile -File ./scripts/jarvis-gateway.ps1`. Codex masaüstü uygulaması yeniden başlatılmaz.

Doğrulama: 11 dar config/kimlik/izin/soru/iptal testi, kurulu Gateway registry sözleşmesine karşı bir başlangıç regresyon testi ve tek tip kontrolü geçti. 06 iptal bağlantısının bir ilgili testi önceki uygulama turunda geçti. Gerçek giriş/başlangıç sonucu GELISTIRME_DURUMU.md içinde tutulur. Canlı model görevi ve native continue/steer/interrupt davranışı henüz uçtan uca doğrulanmadı; model adı varsayılıp sessiz model çağrısı yapılmadı.

Gerçek Gateway doğrulaması: native Codex ve JARVIS eklentileri yüklü, plugin errors/unavailable boş. Ayrı authReady:true, Full access etkin; canlı model turu henüz doğrulanmadı.

Son kullanıcı kararı: canlı kabul 10 sonrasında Codex ve OpenCode ile birlikte yapılacaktır. Görev, üç prompt akışı, Luna 6/en düşük düşünme tercihi ve soru/iptal kabul koşulları [09–10 toplu doğrulama](09_10_TOPLU_DOGRULAMA.md) içindedir. 09 uygulandı; canlı kapanış ertelendi, test geçmiş sayılmaz.
