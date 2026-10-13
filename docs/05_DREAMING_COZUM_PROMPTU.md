# 05 — Dreaming aday aktarımını tamamla

Yalnız 05'in kalan Dreaming bağlantısını çöz. Önce AGENTS.md, docs/KESIN_MIMARI.md,
docs/GELISTIRME_DURUMU.md ve docs/05_YEREL_HAFIZA.md dosyalarını oku.
06–16'yı başlatma. Native Windows 11 üzerinde çalış.

Mevcut çalışan parçalar: OpenClaw 2026.10.2 tek Memory Core; builtin SQLite
FTS/BM25 + yerel EmbeddingGemma vektör araması; `provider: local`, `fallback:
none`; kaynaklı/revizyonlu kısa not araçları, CAS ve yetkili ortak sohbet erişimi.
Araştırma notları başlangıç bağlamı olarak almaz. Embedding-only managed
llama.cpp kurulumu doğrulandı. Model dosyası ~313,4 MiB; bu toplam RAM değildir.

Düzenleme modeli mevcut Space Bunny Free'dir. `plugins/jarvis/opencode-memory.ts`
public CLI backend'i ve `opencode-guard.mjs` mevcut native OpenCode işçisine
bağlanır. CLI 2.0.27 / authenticated loopback worker 2.0.28 ile host effect
guard altında gerçek JSON yanıtı ve yazma teşebbüsünün etki öncesi reddi
doğrulandı. Yeni chat modeli/sağlayıcı veya ücretli yedek ekleme; mevcut hesap
kimliğini verilen API anahtarına geçirilmiş varsayma. Genel worker entegrasyonu
bu görev değildir.

Gözlenen hata: public `memory search --agent main --json` sonuç döndürürken
native recall persistence `memory-core dreaming SQLite state store is not
configured` hatasını yakalayıp yutabiliyor. Native sweep `candidates=0,
applied=0` dönüyor; bu başarı değildir. CLI araması yeni türev görünümü
indekslenmeden eski sonucu da döndürdü; store hatasını ve indeks tazeliğini
ayrı doğrula. `memory/dreaming/` native short-term adaylarından dışlanır;
native uygun tarihli kaynak yolu bu tek başına store sorununu çözmez.

`plugins/jarvis/dreaming.ts` şu anda BİLİNÇLİ engel bildirir; gerçek bir
admission denemesi yapmaz. Bu korumayı desteklenen bağlantı ile değiştir.
Mevcut `jarvis.memory.dreaming.status` durumunu gerçek host kanıtıyla güncelle.
Önce public Gateway/SDK/native memory tool sözleşmelerini araştır; CLI
sürecinin hatasını tüm Gateway yolları için imkânsızlık kanıtı sayma.
Kurulu sürüm ve resmî belgelerle sözleşmeyi doğrula. İç modül import'u,
SQLite şeması kopyası/müdahalesi veya FURY memory-forget/retention kodu kullanma.

Hedef: mevcut Memory Core'a seçilen kısa notlar için desteklenen, eklemeli
aday aktarımı; native Deep'in Space Bunny ile anlamsal düzenleme, doğrulama
ve kalıcı yazmasını uçtan uca kanıtlamak. Başka adayları topluca silen
backfill çözümü kurma. Yeni depo, servis, kuyruk, Mem0 veya Basic Memory yok.
Ham konuşma indeksleme/kopyalama, sessionMemory, rememberAcrossConversations
ve session backfill kapalı kalsın. Light/REM bu sürümde transcript ingestion
yaptığından etkinleştirme. Kaynak USER.md, MEMORY.md ve memory/; çıktılar ayrı
proje dosyalarında referanslı kalır.

Mevcut native cron tek kalmalı: `0 */6 * * *`, `Europe/Istanbul`, stagger 0
(00/06/12/18). Yeni scheduler kurma. Model yalnız gerekli seçilmiş adayları
ve gereken kısa ön bilgiyi almalı; tüm hafıza/ham sohbet prompt'a doldurulmaz.
Yerel arama ile seçilen bağlamın bulut Space Bunny'ye gönderilmesi farklıdır.
Tercih/karar/düzeltmelerin hemen yazılması Dreaming'i beklemez. Kaynak türü,
UUID/revizyon/tarih/proje ve türev referansları korunmalı; model/web çıktısı
kullanıcı beyanı olmaz. Eşzamanlı düzeltme önceki bilgiyi sessizce ezmemeli.

Doğrulama: izole, açıkça test olarak işaretli kısa notla yerel arama → native
aday → guarded mevcut Space Bunny → native yapılandırılmış düzenleme →
kalıcı kaynak referansı zincirini göster. Sadece cron kabulü, boş sweep,
append-only fallback veya sabit engeli kaldırmak yeterli değildir. İzin dışı
yazma/araç çağrısı host tarafından reddedilmeli; stale revizyon korunmalı.
Makinede ikinci ağır Gateway bellek tahsis hatası verdi; aynı profilde iki
Gateway açma, ana süreci veya başka işçileri genel force-kill ile kapatma.
Bekleyen dış çağrı sonucunu görmeden körlemesine tekrar etme.

Gereksiz deneyleri temizle, uygun tip/sınır kontrollerini çalıştır ve yalnız
gerçek durumu GELISTIRME_DURUMU.md içinde güncelle. README'ye bu Dreaming
hatasını ekleme. 14 seçici unutma/ham fiziksel temizliği yapılmış sayma.
Desteklenen yol, hesap veya sürüm hâlâ engelse somut kanıtını ve gereken
değişikliği açık bırak; 05 tamamlandı deme.
