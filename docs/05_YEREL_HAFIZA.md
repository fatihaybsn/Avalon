# 05 — tek yerel hafıza ve kontrollü notlar

13 Ekim 2026. OpenClaw ve resmî `@openclaw/llama-cpp-provider`: **2026.10.2**. FURY kodu, SQLite şeması, state ve retention/forget işlemleri aktarılmadı.

## Kaynak ve indeks

Tek Memory Core slotu `memory-core`; backend OpenClaw builtin'dir. SQLite, ana ajanın mevcut `agents/main/agent/openclaw-agent.sqlite` dosyasındadır. Ayrı JARVIS hafıza veritabanı veya servisi yoktur. FTS/BM25 ve vektör hibriti motorun kendi davranışıdır; bu sürümde eski `query.hybrid`/watch ayarları eklenmez.

`memory.search.provider = local`, `fallback = none`, `sources = [memory]`. `rememberAcrossConversations` ve `experimental.sessionMemory` false, `extraPaths` boş; ana ajan aynı ayarı miras alır, araştırma araması kapalıdır. `session-memory` hook'u ve pre-compaction memory flush kapalıdır. `skipBootstrap` ve `contextInjection: never` korunur; tüm notların başlangıç prompt'una eklenmesi yapılmaz. Araştırma workspace'i ayrı ve boş, hafıza araçları kataloğunda yoktur.

Repo dışı JARVIS workspace'inde `MEMORY.md`, `USER.md`, `memory/README.md` ve `memory/records/` hazırlanır. Var olan notlar başlangıç betiğiyle ezilmez. İlk iki dosya kısa kaynak/kayıt yönlendirmesidir; kişisel bilgi uydurulmaz. Kalıcı rapor/kod/proje çıktısı kendi proje dosyasında kalır; nota yalnız mevcut dosyanın referansı alınır.

## Host araçları

Ana ajan, geçerli 03 kapsamı ve public SDK v2 invocation authority ile şu dar araçları kullanır:

| Araç | Sınır |
|---|---|
| `jarvis_memory_search` | En fazla 256 karakter sorgu, 6 sonuç, yalnız memory kaynağı; mevcut Memory Core manager ve native hit authorization. Session/wiki/all corpus açılmaz. |
| `jarvis_memory_get` | Yalnız `MEMORY.md`, `USER.md`, `memory/.../*.md`; en fazla 80 satır. Eski record revizyonu geri verilmez. |
| `jarvis_note_read` | UUID ile güncel kayıt; tarihçe güncel gerçek gibi sunulmaz. |
| `jarvis_note_write` | En fazla 1800 karakter. `source: task` yalnız bulgu/çıkarım; `source: user` yalnız admitted güncel kısa kullanıcı metninin tamamıyla birebir, boşlukları normalize edilmiş tercih/karar/düzeltme. Parafraz veya model özeti kullanıcı beyanı olmaz. Model/web kaynağı ayrı tutulur, URL olması doğrulanmış bulgu anlamına gelmez. |

Ham native `memory_search`/`memory_get` genel araç kataloğunda kapalı kalır; eklenti yalnız public Memory Core capability/manager API'sini kullanır, ikinci arama uygulaması yazmaz. Arama eski revizyon vektörlerini filtreler. Güncel revizyonun indekslenmesi gecikirse sonuç azalabilir; `jarvis_note_read` dosyadan hemen güncel bilgi verir. İndeks eskiliği başarılı güncelleme gibi gizlenmez.

Gerçek insan beyanı için **`jarvis.memory.write`** Gateway RPC'si de vardır. Önce mevcut `jarvis.scope.bind` ile görev bağlanır; params `sessionKey`, isteğe bağlı `agentId: main`, `runId`, `expectedRevision`, `category`, `content`, isteğe bağlı `id/sources/derivedFrom/artifacts` içerir. Kullanıcı/cihaz/session/proje/görev kaynağı admitted client + retained session authority'den alınır. `userId`, `sourceKind` veya tarih parametresi verilmez. Modelin genel gateway/exec erişimi kapalıdır; bu RPC model kataloğunda yoktur. Bu güven sınırı yerel operator kimliği içindir; sırf kullanıcı kelimesi geçen model metni yetki değildir.

Klasör seçilmeyen masaüstü sohbeti şimdi aynı run/idempotency kimliğiyle **`role: memory`** bağlar. Bu rol yalnız dar hafıza araçlarıdır; genel dosya/web/exec yetkisi vermez. Klasör seçilirse önceki project scope korunur. Main istemci yalnız güncel kısa `userInput`'u admitted operator çağrısında taşır; host tamamını doğrular, normalize eder ve **non-enumerable/ephemeral** retained scope'ta tutar. Native run scratch/config/event'e veya ikinci ham arşive kopyalanmaz; araştırma rolü bu alanı reddeder. Kaynaklı preference/decision/correction notu ancak tool `content`'i bu metnin tamamıyla eşleşirse yazılır; `userInputHash` kaynağa iliştirilir. Uzun mesajlar bu kısa kullanıcı kaydı kanalına sokulmaz. URL eklenirse aynı kullanıcı metninde gerçekten bulunmalıdır. Önemli notu seçmek modelin işidir; otomatik her-sohbet-kopyalama hook'u yoktur.

**`jarvis.memory.read`** RPC'si yetkili farklı main sohbetten UUID'nin güncel kaydını döndürür. 2026.10.2'nin session-scoped RPC sözleşmesi yalnız `operator.write` + authenticated profile ile çalıştığından bu salt okunur RPC de bu admission kapsamını ister; handler ayrıca `operator.read` denetler. Model araçlarının ayrık read/write davranışı korunur. Araştırma session'ı bu RPC'yi kullanamaz.

Gemini/Talk çağrı bağlama ve insan ses beyanının host ingress'i **12'ye bırakıldı**. Ayrı preference UI veya yeni ses protokolü eklenmedi. Şimdi araçlar, günlük sohbetin memory-only kapsamı ve admitted operator RPC'leri kullanılabilir; tercih/karar/düzeltme çağrısının kalıcılığı Dreaming'i veya embedding'i beklemez. Modelin kullanıcı metninden çıkardığı farklı cümle `source: user` olarak geçmez; yalnız task/inference kaydı olabilir.

## Revizyon ve izlenebilirlik

Dosya biçimi `memory/records/<UUID>/r00000001.md`. Kaynak metadata'sı okunabilir Markdown içinde bulunur: `id`, `revision`, `recordedAt`, `origin.kind/userId/deviceId/projectId/taskId/runId/sessionId/sessionKey`, `category`, `sources`, `derivedFrom: [{id, revision}]`, `artifacts`, `supersedes`, `priorPath`.

Yeni kayıt `expectedRevision: 0`; düzeltme okunan son revizyonu ister. Her revizyon exclusive create ile yazılır; farklı süreçlerde aynı önceki revizyona yazanlardan yalnız biri başarılı olur. İkinci işlem `REVISION_CONFLICT` alır; otomatik birleştirme/tekrar veya son yazan kazansın davranışı yoktur. Bozuk kayıt ezilmez. Son senkron yazmadan önce authority yeniden denetlenir; symlink/junction/hardlink, path traversal, ADS ve caller-supplied kayıt yolu kabul edilmez. Kaynak/türev referansları kayıt kimlikleriyle, ayrı proje dosyaları mevcut task root içindeki gerçek dosyalarla sınırlıdır.

Model/web, kategoriye `inference` yazarak mevcut kullanıcı notunu supersede edemez; başka principal'ın veya model için başka projenin kaydını da değiştiremez. Kullanıcının önceki beyanının geçersizleşmesi yine admitted insan yazımı gerektirir.

Bu metadata 14 için izlenebilir kaynaktır; **native session forget'in bu custom kayıtları otomatik temizleyeceği iddia edilmez**. Eski revizyonlar durur ve indekste de bulunabilir; retrieval'ın eski olguyu filtrelemesi fiziksel unutma değildir. Not/indeks/cache/Dreaming preimage/türev/ham sohbet temizliği 14'te ayrıca kapsanıp doğrulanmalıdır. Genel forget veya ham kayıt fiziksel silme uygulanmadı.

## Native Windows embedding

Resmî pinned eklenti ClawHub üzerinden kuruldu. Kurulum komutu:

```powershell
$env:JARVIS_GATEWAY_TOKEN = [Environment]::GetEnvironmentVariable('JARVIS_GATEWAY_TOKEN', 'User')
node node_modules/openclaw/openclaw.mjs --profile jarvis models auth login --agent main --provider llama-cpp --method local
```

Chat teklifi varsa reddedilir; yalnız embedding-only teklif kabul edilir. Kurulum doğrulanmış Windows build'ini, GGUF dosyasını ve loopback `localService`/router preset'ini kendisi üretir. Model `hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf`. CPU/CUDA seçimi resmî host discovery'ye aittir. Chat modeli eklenmez; ana model `opencode/space-bunny-free`, fallback listesi boş kalır.

Yaklaşık 313 MB / 0,3 GB **model dosyası** büyüklüğüdür. Runtime/CUDA bağımlılıkları, çalışma buffer'ları, SQLite indeksi ve gerçek RAM/VRAM ayrı tüketimlerdir. EmbeddingGemma konuşma, muhakeme veya özetleme modeli değildir. İndirme/kurulum eksikse görünür engel; local arama hatasında bulut embedding/model fallback yoktur. Durum:

Bu host'ta indirilen GGUF **328.577.056 byte (~313,4 MiB)**. İlk Windows runtime rename denemesi EPERM ile durdu; resmî ikinci deneme kuruldu. Native deep status gerçek embedding isteğinde `embeddingProbe.ok: true`, local/active ve sqlite-vec semantic/store ready gösterdi; force index üç başlangıç kaynak dosyasını işledi. Hiç chat modeli eklenmedi.

```powershell
.\scripts\jarvis-memory-status.ps1
.\scripts\jarvis-memory-status.ps1 -Deep
node node_modules/openclaw/openclaw.mjs --profile jarvis memory index --force --agent main
```

## Dreaming'in gerçek kapsamı

05 bütünü henüz tamamlanmadı. Mevcut Memory Core cron'u `0 */6 * * *`, `Europe/Istanbul`: 00:00/06:00/12:00/18:00; mevcut job public API ile stagger sıfıra ayarlandı. Light/REM ham transcript ingestion nedeniyle kapalı; Deep yapılandırılmıştır. Yeni scheduler, aday kuyruğu veya hafıza servisi yoktur.

Düzenleme için mevcut OpenCode işçisi ve Space Bunny seçildi. `jarvis-opencode-memory/space-bunny-free` aynı modelin public CLI backend yönlendirme kimliğidir. V2 host `execute.before`/permission hook'larıyla gerçek JSON model cevabı alındı; gerçek yazma teşebbüsü etki oluşmadan engellendi. EmbeddingGemma yalnız arama embedding'idir. İşçinin mevcut hesabı kullanıldı; yeni User API anahtarına geçildiği iddia edilmez.

Kalan engel model erişimi değildir: 2026.10.2 public CLI search, recall kaydını `memory-core dreaming SQLite state store is not configured` hatasıyla ekleyemiyor. Native CLI hatayı yutabiliyor; başarılı arama/boş sweep düzenleme başarısı sayılmaz. Gerçek denemede aday/applied sıfır, yapılandırılmış düzenleme ve DREAMS başarı kaydı yoktur. `memory/dreaming/` native adaylardan dışlanır; `memory/current/YYYY-MM-DD-UUID.md` revizyonlu türev hazırlığı store engelini çözmez. Otomatik Dreaming kontrolü açık engel bildirir ve bulut çağrısını başlatmaz. Desteklenen Gateway kaynaklı additive admission gerekir. Private SQLite/import, tüm grounded adayları değiştiren backfill veya ham ingestion kullanılmadı.

Kaynaklar değişmez UUID/revizyon dosyalarıdır; türev orijinal yol/revizyonu taşır. Tercihler/kararlar/düzeltmeler bu tura bağlı olmadan hemen kaydedilir. Yerel embedding/SQLite araması cihazdadır; Space Bunny veya ileride Gemini'ye seçilen bağlam gönderildiğinde seçilmiş bilgi buluta gider. Tüm hafıza/ham sohbet otomatik prompt'a doldurulmaz. Worker session'ları fiziksel silinmedi; 14 seçici unutma tamamlanmış değildir.

## Doğrulama

- `npm run check`; 25 sınır testi (`npm test`), iki gerçek child process ile CAS, memory-only rolün dosya/web reddi, ephemeral kaynak metni ve tam kullanıcı cümlesi/parafraz ayrımı dahil. Masaüstü 14 test (`npm run test:desktop`) de geçti.
- Ayrı gerçek Windows Gateway'de paired client/profile/session scope; admitted user notu, stale revision reddi, ikinci yetkili chat okuması, research reddi; native altı saat cron + timezone + lightContext. Önceki allow-always/deny/allow-once gerçek onay testleri de geçti.
- Arama wrapper'ının memory-only native manager seçenekleri, hit authorization, ham path ve eski vektör sonuçlarının filtresi mock runtime ile sınandı; gerçek embedding başarısının yerine geçmez.
- Gerçek yerel force index sonrası üç dosya/üç chunk, FTS available, vector index complete/dims 768. Türkçe `kayıt revizyonu` sorgusunda MEMORY.md hem vectorScore 0.6259 hem textScore 0.3496 verdi; diğer iki memory kaynağı da vektörle bulundu. Kayıt sonuçlarına host doğrulanmış record/revizyon/kaynak metadata'sı eklenir; web kayıtlarına native dosya sınıflandırması ne olursa olsun `untrusted`, model kaydına `agent`, admitted user kaydına `owner` etiketi verilir.
- Ana gerçek profil `config validate` warnings olmadan geçti; health loaded plugins/errors ve hot reload gözlendi. Kurulum/indeks sonuçlarının nihai durumu `GELISTIRME_DURUMU.md` içindedir.
- Son root'suz memory-only/public-runtime Gateway denemesi de geçti. Fixture native `/readyz` ile sidecar hazır olmasını bekler; açık port başarı sayılmaz. Yeni desktop controller build edildi; önceden çalışan eski main otomatik yeniden başlatılmadı. Yeni başlatma `npm run desktop:start`; daha önceki paketlenmiş EXE bu kaynak değişikliğini kendiliğinden almaz.

Resmî sözleşmeler: [Memory config](https://docs.openclaw.ai/reference/memory-config), [managed llama.cpp](https://docs.openclaw.ai/plugins/llama-cpp), [Dreaming](https://docs.openclaw.ai/concepts/dreaming), [provenance/forget sınırları](https://docs.openclaw.ai/concepts/memory-provenance). Uygulama sırasında kurulu 2026.10.2 manifest ve public SDK typelarıyla da eşleştirildi.
