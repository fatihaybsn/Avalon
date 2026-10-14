# 06 — güncel çalışma kaydı

Yalnız 06 kapsamı. OpenClaw **2026.10.2** Windows host'u görev/oturum, araç yetkisi, onay ve yürütme sahibi olarak kaldı. Electron yalnız istemci. `plugins/jarvis/work.ts` mevcut host olaylarının gözlem ve metadata uyarlamasıdır; kayıt okuyarak iş başlatan bir motor değildir.

## Doğrulanan sözleşme

Native isim ve parametreler kurulu paketin public SDK/type/schema kaynakları ile denetlendi. Ana model/sağlayıcı, ücretli fallback, Memory Core ve Dreaming değiştirilmedi.

| JARVIS'in kendi dar RPC'si | Native karşılığı / sınır |
|---|---|
| `jarvis.work.start` | Önce mevcut `jarvis.scope.bind` ile gerçek operator/device/session grant'ı. Normal yazılı giriş `chat.send` + `queueMode: followup`; bağımsız iş public `api.runtime.subagent.run`, fresh `agent:main:subagent:…` session. |
| `jarvis.work.status` | Retained metadata, `sessions.describe` **`{key, agentId}`**, `agent.wait` `{runId, timeoutMs:0}`; yalnız gözlem. Kullanıcıya ait kayıtlar native lexical range ile 50'şer okunur. |
| `jarvis.work.read` | Aynı güncel kayıt; açık `callId` istenirse bu görevin gözlediği native toolResult mevcut session'dan okunur. En çok 100 mesajdan aranan tek çıktı ve en çok 12.000 karakter; eksikse açık hata. CallId olmadan exact run'ın native terminalReply/error çıktısı gelir; yoksa `outputUnavailable:true`. Memory Core/Dreaming beklenmez. |
| `jarvis.work.steer` | Gerçek kullanıcı + aynı native incarnation + tek exact aktif run + mevcut task grant + `expectedRevision`; `chat.send` + `queueMode: steer`, yeni input UUID. Interrupt/supersede seçilmez. |
| `jarvis.work.cancel` | Gerçek operator write/session admission ile exact `chat.abort` `{sessionKey, agentId, runId}`. Başka task'ın canlı grant'ı kullanılamaz. Eski araç yetkisi restore edilmez. |

Bu beş isim **bu eklentinin kaydettiği RPC'lerdir**, stok OpenClaw endpoint'leri olarak sunulmaz. Native dispatch public `openclaw/plugin-sdk/gateway-method-runtime.dispatchGatewayMethod` ve mevcut manifest `authenticated-request` sözleşmesinden geçer; arbitrary plugin'e yasak trusted `runtime.gateway.request` veya synthetic/admin client kullanılmaz. [Native session kontrolü](https://docs.openclaw.ai/gateway/protocol/rpc-session-control), [Gateway protokolü](https://docs.openclaw.ai/gateway/protocol).

## Kalıcılık, kimlik ve kanıt

Mevcut native plugin state tablosunda üç `retention: retained` namespace var: `work-records`, `work-projects`, `work-evidence`. Yeni SQLite dosyası/şema veya görev veritabanı yok. Bu namespace'ler TTL veya count evict kotası almaz; kısa ömürlü yetki/lock'lar ayrı process-local alandadır. Native JSON'un 1 MiB sınırı korunur; dolma/yazma hatası görünürdür, eski kayıt silinerek yer açılmaz. Desteklenen atomik `update` ve bounded lexical range yetenekleri zorunludur; düşük güvenli depoya fallback yapılmaz. Bu sürümde public atomic updater compatibility sözleşmesi kullanılmaktadır; sürüm değişiminde yeniden doğrulanmalıdır. [Native retained state](https://docs.openclaw.ai/plugins/sdk-runtime/state-and-system).

Her task; project ID ve o kabulün project revision'ını, task revision'ını, record version'ını, gerçek user/device sahibini, owner agent/sessionKey/sessionId/native runId'yi, kaynak isteği, kullanıcı tarafından kabul edilmiş planı, gözlenen işlem/callId/revision'ı, sonucu/engeli, modelin bulgu/kaynak/gerekçe/sonraki adım/bekleyen kararını ve zamanı ilişkilendirir. Project revision metadata kabul sayacıdır; paralel task'ın çalışmasını supersede etmez. İlk kabul edilmiş temel özgün kullanıcı isteğidir; modelin önerisi ayrı `model.plan` alanında kalır. UI'daki **Bu planı kabul et** gerçek kullanıcı isteği üzerinden güncel öneriyi kabul eder.

Worker thread/turn/session alanları yalnız host `linkWorker` yoluna gerçek native kimlik geldiğinde eklenir. 09/10 dış worker bağlantısı bu aşamada kurulmadı. VoiceSession ve provider callId için birleştirme/varsayılan kimlik oluşturulmadı; 11/12 daha sonra aynı project/task'a ayrı ilişki ekler.

`before_tool_call` bir **gözlem/admission**, native tool `start` somut **başlama**, `after_tool_call` desteklenen **sonuç** kanıtıdır. Raw params, kod, stdout, reasoning ve bütün log kayda/context'e doldurulmaz. Olay kimliği/run sequence ve callId ile tekrarlar ikinci işlem sayılmaz; eski sequence yeni gözlemi geriye götürmez. Geç gelen eski tool sonucu başlama revizyonunu korur.

Sonuç yoksa `missing`; açık hata/`isError`/`success:false` varsa `error`; bir tool sonucu gelmesi yalnız `result` olur. Dosya write/edit için host'un sabit beklenen içerik hash'i ile aynı gerçek hedefin son içeriği ayrıca karşılaştırılır. Yalnız eşleşen gerçek postcondition `effect:verified` olur. Agent-end veya native wait `ok` **native çalışma bitti** demektir; kullanıcı hedefinin karşılandığına eşit değildir. Kalıcılık/gözlem hatası istemcide güncel kaydı okunamaz yapar. [Hook sonuç sözleşmesi](https://docs.openclaw.ai/plugins/hooks/tool-policy).

`jarvis_work_read` modeli yalnız kendi güncel host kaydıyla bilgilendirir. `jarvis_work_note` yalnız kısa açıklama/proposed plan/finding/source/rationale/next step/pending decision yazar; state, grant, acceptedPlan, worker ID veya başarıyı değiştiremez. Ek LLM sınıflandırıcısı ve yeni role promptu yok; yalnız bu iki kısa araç sözleşmesi var.

## Yönlendirme ve ortak kaynaklar

Yönlendirme `delivered → accepted → applying → applied` olarak ayrı tutulur. Native giriş kabulü ilk iki duruma kanıt olabilir; transcript receipt, sessizlik veya model açıklaması applied kanıtı değildir. `confirmSteer` yalnız host adaptörü tarafından, current grant + exact input/call/revision + somut verified effect ve native kanıt assertion'ıyla son iki durumu kaydedebilir. Bugün bütün yönlendirmelerde bu nedensel kanıtın var olduğu ileri sürülmez; model `progressClaim`'i varsa açıkça doğrulanmamış açıklamadır. Native `chat.send` steer, desteklenmeyen/idle sink'te followup'a geçebilir; bu **aynı run'da uygulanmış değişiklik** diye gösterilmez. Native yeni giriş/iş sonuçları ayrıca okunur, belirsiz işlem yeniden gönderilmez.

Electron başka sohbet seçince veya yeni bağımsız işe geçince abort/steer/supersede göndermez. Gerçek testte parent-linked `sessions.create` aktif parent için native write sınırından reddedildi. Bu nedenle bağımsız iş fresh subagent key ile oluşturulur; ilişkisi aynı kalıcı project ID üzerinden tutulur, parent konuşması veya grant kopyalanmaz. Yeni owner session için 03 host grant'ı yeniden alınır. İstek/klasör aynı olsa da başka task'ın capability'si devralınmaz.

Başlangıç native `agents.defaults.maxConcurrent=3` ve `agents.defaults.subagents.maxConcurrent=3`; uygulamada ek backlog/semaphore/workflow yok. Bağımsız ağır işler mevcut subagent lane'ine gider. Paylaşılan mouse/keyboard için tek `input:mouse-keyboard` sahibi; file, window ve browser target kimlikleri için ayrı lease vardır. Uygulama adıyla makine kilidi yok. Mevcut dosya write/edit hook'u gerçek canonical dosya kimliğiyle lease alır; error/abort/cancel/run-end/grant expiry/reload'da bırakır. GUI/browser **araç bağlantıları** 07/08'e aittir; bu generic sahiplik sınıfının test edilmesi gerçek mouse/browser kontrolü hazır demek değildir.

## Restart ve gerçek durum

Retained kayıt yeni plugin generation'da native row/run gözlemiyle uzlaştırılır. Eski shell süreçleri, lock'lar ve tool grant'ları yeniden yaratılmaz. Native terminal kanıt yoksa `unknown`; mevcut run ID gözlenmesi bile eski process/tool authority'nin devam ettiğini göstermez. `status/read`, timeout veya reconnect hiçbir dispatch yapmaz. Native pause bu yolda desteklenmediğinden `pauseSupported:false` açıkça gösterilir.

Electron sağ paneli record ID/revision, owner session/run, kabul edilmiş plan, son operasyon/etki, sonuç/engel, açıklama ve bekleyen karar, steer aşaması ve kaynak sahibini gösterir. Start, bağımsız start, read, steer, plan kabulü ve exact cancel dar main/preload IPC'sinden geçer. Eski host gözlemi bağlantı kesilince güncel sayılmaz. Ses bağlamı henüz bağlı değildir.

Bu ingress paired/signed operator cihazı gerektirir. Token ile bağlanmış fakat device/session admission taşımayan generic CLI `jarvis.work.status` çağrısı `Authenticated operator session required` ile reddedilir; cihazsız çağrıya sessiz muafiyet verilmez. Gerçek Electron imzalı istemci yolundan okuma ayrıca sınanır.

## Kontroller ve çalıştırma

```powershell
node scripts/jarvis-work-config.mjs
node scripts/jarvis-policy-config.mjs --check "$env:USERPROFILE/.openclaw-jarvis/openclaw.json"
npm run check
npm test
npm run test:desktop
npm run test:work:gateway
npm run desktop:build
npm run test:desktop:electron
```

Gerçek sonuçlar ve sonraki aşama engelleri `GELISTIRME_DURUMU.md` içinde tutulur. Fixture hook'u yalnız geçici test profilinde bulunur; üretime yüklenmez. Başarısız testte native hata/OOM veya endpoint/schema uyuşmazlığı saklanmaz; profile/model erişimi doğrulanmadan ready işaretlenmez.
