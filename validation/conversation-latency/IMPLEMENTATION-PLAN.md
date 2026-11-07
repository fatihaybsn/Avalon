# Sohbet gecikmesi: bulgular ve küçük çözüm planı

> **Görev sonucu tekrar kontrolü uygulandı — 7 Kasım 2026:** Bilinen Hermes sonuçlarında yalnızca `run_id/task/status/output` tekrar kimliğini belirliyor; ilk gönderimin JSON'u değişmiyor. Aynı sonuç için eşzamanlı gönderimler birleşiyor; hatalı kabul yeniden denenebiliyor ve geçersizleşmiş önbellek gecikmiş kabul tarafından geri getirilmiyor. Notlar, araştırma ek alanları ve farklı talimatlar tam-JSON kimliğini koruyor. Oturum ayrımı ve 100 kaynak sınırı korunuyor. Önce eklenen 11 testten 7'si hatayı gösterdi; düzeltme sonrası kaynak testi **22/22**, genel test **365/365**, Electron kontrolü ve TypeScript/masaüstü/mobil build başarılı. Bu genel koşuda Windows EPERM hatası oluşmadı; mevcut build boyutu/deprecation uyarıları sürüyor. Hermes patch, uyumluluk manifesti, kurulum ve doğrulama betiklerinin SHA-256 değerleri değişmedi. Üretim değişikliği yalnızca `attachConversationSource` içinde; başka çalışma yolu, native protokol veya model talimatı değiştirilmedi. Canlı model veya bilgisayar otomasyonu çalıştırılmadı.

> **Önceki uygulama sonucu — 7 Kasım 2026:** Kullanıcının onayladığı not arama planı uygulandı. O aşamadaki tek üretim değişikliği, `relayUserText` not arama koşuluna `ui.brainOpen === true` eklenmesiydi. Görev sonucu aktarımı ve otomasyon o aşamada değiştirilmedi. Aşağıdaki eski, daha geniş çözüm seçenekleri uygulanmadı.
>
> `test/conversationNotes.test.mjs`, gerçek relay ve kaynak gönderme fonksiyonlarını çevrimdışı çalıştırıyor: düzeltmeden önce 6 başarısız / 4 başarılı, düzeltmeden sonra 10/10 başarılı. Genel testler yeniden koşuldu: **353/353 geçti**. Electron kontrolü (60 modül + 3 otomasyon modülü), TypeScript ve masaüstü/mobil build, Python sözdizimi kontrolü başarılı. İlk genel koşuda mevcut launcher testinin geçici klasör temizliği Windows EPERM hatası verdi; aynı dosya ayrı koşuda 7/7, ardından genel koşu 353/353 geçti. Bu testte değişiklik yapılmadı. Canlı model veya otomasyon çalıştırılmadı.
>
> **Ek istek/çıktı denetimi:** Gerçek taşıyıcı ve main yanıt callback'iyle bir entegrasyon testi daha eklendi. Beyin kapalı örnekte Hermes `prompt.submit`: 1, not araması: 0, not okuma: 0, gizli not isteği: 0. Kullanıcı metni aynen iletildi; profil/tarih/bekleyen istekler/UI/runtime bağlamı ve v2 sözleşmesi korundu. Sahte native uçtan verilen örnek JSON yanıtı gerçek callback ile doğru transcript'e dönüştü; bu yanıt canlı model üretimi değildir. İlgili 68 test geçti. Genel paralel koşuda mevcut launcher testinin Windows EPERM temizleme hatası tekrarlandı; üretim veya launcher testi değiştirilmeden `node --test --test-concurrency=1 test/*.test.mjs` ile **354/354 geçti**. Varsayılan paralel test koşusundaki aralıklı temizlik sorunu devam ediyor. Uygulama kapalı ve Hermes günlüğünde yeni konuşma yoktu; düzeltme sonrası canlı yanıt/hız gözlemi yapılmadı.

Araştırma tarihi: 7 Kasım 2026. Aşağıdaki bölümler uygulama öncesindeki bulguları ve değerlendirilen seçenekleri kaydeder; güncel uygulama sonucu üsttedir.
Araştırma aşamasında uygulama kodu/ayarları değiştirilmedi, model veya dış servis çağrısı yapılmadı.

## 1. Sonuç ve güven sınırı

İki ayrı gecikme kaynağı var:

1. Avalon, görünür bir notu veya seçili iş sonucunu kullanıcının asıl mesajından önce ayrı bir `kind: context` Hermes isteğiyle yükleyebiliyor. Aynı oturumun sıralı kuyruğunda bu istek bitmeden gerçek mesaj başlamıyor. Kaynak saklamak için modelden boş bir onay üretmesi isteniyor. Gereksiz model turu ve ilgisiz bağlam uygulama tarafında düzeltilebilir.
2. İncelenen son Qwen/Evren çağrıları model/API aşamasında yaklaşık 124–127 saniye sürmüş. Yerel kayıtlar bunun sağlayıcı kuyruğu, ağ, SDK yeniden denemesi veya model çıkarımı olduğunu ayıramıyor. Birinci düzeltme bu bağımsız gecikmeyi ortadan kaldırma garantisi vermez.

Öneri: **kaynakları ayrı konuşma turuyla yükleme; gerekli ve boyutu sınırlı kaynak verisini gerçek kullanıcı mesajının mevcut bağlamına ekle.** Buna gerçek bekleme durumunu gösteren ve mevcut iptal mekanizmasını kullanan küçük bir kullanıcı arayüzü iyileştirmesi eşlik etsin. Otomatik sağlayıcı değiştirme, yeni süreç/kuyruk motoru veya Hermes yaması gerekmiyor.

## 2. Gözlenen kayıtlar

Kaynak: `C:/Users/Fatih/AppData/Local/hermes/logs/agent.log` ve salt okunur incelenen Hermes `state.db`. Saatler günlükte yazıldığı biçimdedir; farklı zaman dilimindeki günlükler dönüştürülmeden birleştirilmemelidir.

| Oturum | Gözlem | Anlamı |
| --- | --- | --- |
| `20261107_143601_8974cd` | DeepSeek: ön kaynak turu 14:38:11–14:38:17, ardından kullanıcı mesajı 14:38:17–14:38:42; API süreleri yaklaşık 5,4 ve 24,2 s | Aynı mesaj akışında iki ayrı model turu var. |
| `20261107_143904_eb9eb7` | Qwen: 20.773 karakterlik kaynak 14:39:30'da kabul edilmiş, yaklaşık 127 s sonra boş onay dönmüş; gerçek 61 karakterlik mesaj ancak 14:41:37'de kabul edilmiş | Kullanıcının mesajı kaynak yükleme turunun arkasında beklemiş. |
| `20261107_144033_18cb43` | Qwen: 79 karakterlik gerçek mesaj 14:41:04'te kabul edilmiş; API kaydı 14:43:08'de yaklaşık 123,7 s göstermiş | Büyük kaynak ön turu olmadan da model/API aşaması yavaş. API kaydı, geçerli son yanıtın kullanıcıya ulaştığını kanıtlamıyor. |

Son iki Qwen oturumunda kapanıştan önce tamamlanmış asistan yanıtı veritabanında görülmedi. İkinci oturumdaki 6.288 giriş tokenı kısa kullanıcı metninin toplam model girdisini göstermediğini doğruluyor; yerleşik talimatlar ve geçmiş de girdiye dahildir.

Ayrı bulgular: 30 saniyelik başlık üretimi zaman aşımı; eski günlüklerde de bulunan eksik Jev MCP giriş noktası. Bunlar bu çözümün kapsamına alınmamalı; iki dakikalık model çağrısının bunlardan kaynaklandığı kanıtlanmadı.

İlgili `main.mjs` kaynak ekleme/mesaj iletme blokları 4 Kasım HEAD `f7940b4` sürümündeki karşılıklarıyla aynıydı. Bu nedenle gereksiz kaynak turunu son A–D yaması getirdi denemez. Ortak taşıyıcıda yaşam döngüsü değişiklikleri bulunduğu için bütün sürümün aynı olduğunu da iddia etmemek gerekir. Native kabul ve API zamanları, gözlenen uzun beklemenin önemli bölümünü doğrudan gösteriyor.

## 3. Üretim kodundaki kanıtlar

- `electron/main.mjs:464`: `attachConversationSource` kaynağı JSON'a çevirip `getConversationHermes().submit({kind: "context", ...})` çağırıyor. Hash, model turu gerçekten başarıyla tamamlandığında değil, kuyruğa kabulden sonra görülmüş olarak işaretleniyor.
- `electron/main.mjs:499–509`: görünür/seçili iş sonucu mesajın konusundan bağımsız yükleniyor. `... || ui.brainOpenNote` açık not bulunduğu her durumda hafıza aramasını tetikliyor. Geniş `belge/document/araştırma` eşleşmeleri basit bir dosya oluşturma isteğini de yakalayabiliyor.
- `electron/main.mjs:525`: gerçek mesaj kaynak turlarından sonra `kind: "conversation"` ile gönderiliyor; metin aynen korunuyor. Kaynak turları aynı oturumun seri kuyruğunda.
- `electron/main.mjs:3048–3077`: arka plan işi bittiğinde de kaynak ekleme çağrısı yapılıyor. Yalnızca kullanıcı mesajı yolunu düzeltmek bu gizli kuyruk işini ortadan kaldırmaz.
- `electron/main.mjs:424`: metin mesajı tamamlandı durumu JSON yanıtı çözülmeden önce yayınlanıyor. Bozuk yanıtın tamamlandı görünmesini önlemek durum düzenlemesinin parçası olmalı.
- `electron/hermesInteractiveTransport.mjs:273`, `:360`, `:651`: mevcut gönderim, dispatch sahipliği, AbortController ve iptal yolu kullanılabilir. `prompt.submit` için 45.000 ms, RPC kabul zaman aşımıdır; uçtan uca yanıt süresi değildir.
- `src/components/MessageComposer.tsx:28`: yalnızca “Yanıt hazırlanıyor…” var; geçen süre ve mesajı iptal etme eylemi yok.
- Native salt okunur kanıt: `tui_gateway/methods_prompt.py:869–871` mevcut `voice_context` değerini 6.000 karaktere kesiyor; `iris_contract.py:34–39` aynı sınırı uyguluyor; `prompt_turn.py:738–743` bağlamı gerçek model girdisine ekliyor. **Bu dosyalar değiştirilmemeli.**
- SQLite gözlemi: normal kullanıcı metni `content` içinde aynen dururken bağlamlı girdi `api_content` içinde tutuluyor. Mevcut bağlam mekanizmasıyla verilen seçili alıntı sonraki konuşma geçmişinde kullanılabilir; tam belgenin okunduğu anlamına gelmez.

## 4. En küçük güvenilir davranış değişikliği

### 4.1 Tek kullanıcı turu, ilgili ve sınırlı kaynak

1. `attachConversationSource` model isteği üretmesin. Kaynak toplama/bağlam oluşturma saf ve test edilebilir küçük bir yardımcıya ayrılsın; yeni kalıcı veri deposu kurulmasın.
2. Açık not veya seçili kart tek başına tam içerik yükleme sebebi olmasın. UI bağlamında kısa başlık ve kaynak kimliği bulunabilir. “Bu notu özetle”, “son araştırmadaki sonuç”, açık dosya/kaynak adı veya gerçek hafıza sorusu kaynak okumayı tetiklesin. Belirsiz durumda model aynı gerçek turda açıklama isteyebilsin. Yeni bir LLM uygunluk sınıflandırıcısı eklenmesin.
3. Mevcut arama ve kaynak sahipliği kontrolleri korunsun. İlgili bölüm, kaynak kimliği/yolu, varsa bölüm aralığı ve kısmi alıntı bilgisiyle gerçek mesajın `context` alanına girsin. Kullanıcının `task` metni değişmesin.
4. **Son oluşturulmuş bağlamın tamamı** için 5.500 JavaScript UTF-16 birimlik güvenli üst sınır önerilir; bu, native 6.000 karakter sınırının altında kalır. Sınır yalnızca belgeye uygulanmamalı: tarih, profil, bekleyen teklifler, UI, runtime ve çerçeve metni de hesaba katılmalı. Kesin alt bütçeler testlerde belirlenebilir.
5. Önce düşük öncelikli/veri alanlarının uzunluğu azaltılsın, sonra JSON üretilsin. Serileştirilmiş JSON'u `slice` ile kesip bozuk veri üretme. Zorunlu izin/sözleşme talimatlarını budama; mevcut native v1/v2 sözleşmesini koru. Kaynak sığmıyorsa açık kısmi alıntı kullan veya kapsamı daralt; sessizce tam belge okunmuş gibi davranma.
6. Uzun not/araştırma/iş çıktısı mevcut vault ve sonuç depolarında tam kalır. Gerekli takip sorularında ilgili başka bölüm seçilebilir. Çok uzun belgenin tamamını aynı anda gerektiren taleplerde kapsam sınırlılığı açık olmalı; bütün belgeyi 5.500 karaktere sığdırmanın anlam kaybetmeyen genel bir yolu yoktur.
7. Arka plan tamamlanma bildirimi tam sonucu mevcut depoya/UI'a yazmaya devam etsin; sırf model hatırlasın diye yeni model turu başlatmasın. Sonraki ilgili soru sonucu mevcut depodan alsın. Eski hash kümesi “model tüm kaynağı biliyor” kaydı gibi kullanılmasın. Gerekirse yalnızca oturuma bağlı, sınırlı kaynak referansı önbelleği tutulsun.
8. Geçmiş kayıtları otomatik yeniden yazma, not silme veya yeni sohbet açma. Önceden şişmiş sohbet geçmişi bu düzeltmeyle küçülmez; kullanıcı isterse yeni sohbet açabilir. Bunun zorunlu onarım adımı olduğu ileri sürülmemeli.

### 4.2 Uzun bekleme ve güvenli iptal

Bu parça sağlayıcıyı hızlandırmaz; sessiz beklemeyi ve tekrar gönderme belirsizliğini giderir.

- Mevcut mesaj kimliğine hazırlık/kuyruk/model bekleme/yanıt işleme durumları bağlansın. Yaklaşık 20 saniye sonra “Yanıt henüz gelmedi” gibi dürüst bir bildirim ve geçen süre gösterilsin. Bu sayı önerilen UX eşiğidir, ölçülmüş sağlayıcı SLA'sı değildir. Alınmamış tokenlar için “model yazıyor” denmesin.
- Metin mesajı için hazırlığın başında mesaj+cihaz+oturum sahipliğine bağlı bir AbortController kaydı oluşturulsun. Küçük bir mesaj iptal IPC/API işlemi aynı sahipliği doğrulasın; run oluşmadan controller'ı iptal etsin, run oluşunca mevcut transport `stop`/native interrupt yolunu kullansın. Mevcut controller ve run sahipliği yeniden kullanılsın; yeni iş yürütme sistemi kurulmasın.
- `submit` öncesi iptal kontrolü, dispatch sonrası native iptal ve çok hızlı tamamlanma/run eşlemesi birlikte test edilmeli. Sadece run ID döndürüp hazırlık aşamasını iptal edilemez bırakmak tam çözüm değildir. Mesaj kabulü, modelin tamamlanmasıyla karıştırılmamalı.
- İptal isteyen UI terminal durumu erken ilan etmesin. Çalışan istekte sahiplik native sonlanma/uzlaştırma sınırına kadar korunsun. İptalden sonra geç gelen teklif/yanıt yanlış mesaja uygulanmasın; eski iptal yeni mesajı durdurmasın. İptal onayı gecikirse bu durum açık gösterilsin.
- İlk düzeltmede keyfi kısa bir zorunlu yanıt zaman aşımı ekleme. Sessiz bir `Promise.race` ile kuyruğu serbest bırakma veya ortak Hermes istemcisini kapatma, A–B yaşam döngüsü yarışını geri getirebilir. Daha sonra uçtan uca süre sınırı gerekirse model bekleme, izin bekleme ve native kapanış ayrı ele alınmalı.
- JSON ancak mevcut doğrulama/delivery yolu başarılı olduğunda tamamlandı sayılmalı. Ham JSON veya kısmi teklif sesli okunmamalı. Sesli v1/v2 yanıt üslubu, readonly araç sınırı, native izinler ve teklif onayı değişmemeli.
- MessageReceipts kimliği/tekilleştirmesi korunmalı. Uzayan beklemede otomatik yeniden gönderim yapılmamalı; tekrar deneme aynı kabul edilmiş işi çoğaltmamalı.

### 4.3 Küçük ve güvenli zamanlama kaydı

Mevcut günlük altyapısına yalnızca kimlik ve süre ekle: mesaj/run/oturum, gözlenen model, kaynak sayısı ve boyutu, kısmi alıntı bayrağı; kabul, hazırlık sonu, dispatch, varsa gerçek ilk çıktı olayı, native sonlanma, JSON doğrulama ve UI yayını zamanları. Monoton saatle süre ölç. Kaynak metni, API anahtarı, gizli izin girdisi veya modelin özel akıl yürütmesini kaydetme. Taşıyıcı gerçek ilk token olayını vermiyorsa TTFT ölçüldü deme.

## 5. Öngörülen dosya kapsamı

| Dosya | Gerekli değişiklik |
| --- | --- |
| `electron/main.mjs` | Kaynak ön turunu iki çağrı yerinden kaldır; gerçek mesaj için ilgili bağlamı kur; durum/mesaj sahipliği ve iptal bağlantısını düzenle. |
| Küçük yeni `electron/conversationSources.mjs` veya eşdeğeri | Kaynak seçimi, alıntı ve toplam bağlam bütçesi; mevcut arama/okuma işlevlerini kullan. Adı henüz karar değildir. |
| `src/components/MessageComposer.tsx`, `src/vite-env.d.ts` | Süre/durum ve mesaj iptali; ek durumların tipleri. Masaüstü ve mobil ortak bileşen davranışını doğrula. |
| `electron/applicationMethods.mjs`, `electron/preload.cjs`, `src/mobile/api.ts` | Mesaj kimliğine bağlı iptal işlemini mevcut IPC/uzak API sözleşmesine küçük ve uyumlu bir ek olarak taşı. Sahiplik denetimini main tarafında yap. |
| Mevcut tanılama yardımcısı, gerekirse `electron/voiceRelayLog.mjs` | Metinsiz boyut/zaman ölçümleri. |
| `test/voiceLifecycle.test.mjs`, `test/hermesInteractiveTransport.test.mjs`, yeni yardımcı/mesaj testleri | Aşağıdaki regresyonlar; üretim fonksiyonları gerçekten çalıştırılmalı. |

Transport mevcut stop ve sinyal sözleşmesi yeterliyse değiştirilmemeli; yalnızca ölçüm veya kanıtlanmış sahiplik açığı gerektirirse küçük değişiklik yapılmalı. Hermes Python kaynakları, patch/hash/commit, kurulum, Node-RED, GPT Researcher ve A–D iş kilidi mantığı kapsam dışıdır.

## 6. Önce yazılacak deterministik çevrimdışı testler

1. Açık 20.773 karakterlik ilgisiz not + “Masaüstüne boş metin belgesi oluştur”: sıfır tam kaynak okuma, yalnızca bir gerçek prompt gönderimi, kullanıcı metni aynen korunmuş.
2. Açık nota açık referans: yine tek prompt, kaynağı belirtilmiş alıntı, toplam son bağlam <=5.500; ayrı boş onay turu yok.
3. Görünür araştırma kartı + ilgisiz mesaj tam rapor yüklemez; belirli sonuç hakkındaki soru doğru ve aynı oturuma ait kaynağı alır. Başka cihaz/oturum verisi sızmaz.
4. Arka plan tamamlanması sıfır sohbet modeli çağrısı üretir; tam sonuç depoda/UI'da kalır, sonraki ilgili soruda kullanılabilir.
5. Çoklu kaynak, Türkçe, emoji, kaçış karakterleri ve büyük UI/profil: JSON geçerli, toplam bütçe korunmuş, alıntının kısmi olduğu açık. Sonraki bölüm sorusu önceki kesilmiş kısmı tam kaynak sanmaz.
6. Sahte saat ve gecikmeli sahte sağlayıcı: 124 saniyelik bekleme anında zaman göstergesi ve iptal çalışır; gerçek süre beklenmez, ağ kullanılmaz; otomatik ikinci istek yok.
7. Hazırlıkta, kuyrukta ve çalışırken iptal; geç tamamlanma; iptal onayının gecikmesi; eski iptal/yeni run; çok hızlı tamamlanma; normal kapanış ve yeniden bağlantı. Native sonlanmadan sahiplik bırakılmaz, geç teklif oluşturulmaz.
8. Bekleyen native izin/soru ve teklif onayı değişmez. Soru bekleme model bekleme olarak otomatik iptal edilmez. Normal görev, sesli v1/v2 ve readonly araç sözleşmeleri korunur.
9. Bozuk model JSON'u başarısız görünür; geçerli yanıt yalnızca doğrulama/delivery sonrası tamamlandı olur. Kısmi JSON sesli okunmaz.
10. Aynı mesaj kimliğiyle tekrar deneme ikinci model isteği üretmez. Yeni sohbet/uygulama açılışı eski arşiv, not, araştırma ve ayarları değiştirmez.

Mevcut `voiceLifecycle` testleri üretim fonksiyonlarını AST/VM üzerinden çalıştırsa da kaynak eklemeyi stub'layan test, gerçek fazladan model turunu kaçırabilir. Yeni entegrasyon regresyonu gerçek relay + gerçek yeni kaynak toplayıcı + sahte native istemciyle gönderim sayısını doğrulamalı. Sadece yeni yardımcının kopyalanmış davranışını test etmek yeterli değildir.

Uygulama sonrası kontroller: `npm test` (önceki çalışma tabanı 343 test; güncel sayı yeniden ölçülmeli), `npm run check:electron`, `npm run build`, `npm run check:python` ve mevcut Python zamanlayıcı testleri. Gerçek Hermes/GPT Researcher/otomasyon veya `test:brain`, `test:relay`, `test:research*` gibi canlı betikler çalıştırılmamalı. Bu araştırma aşamasında bu kontroller yeniden çalıştırılmadı.

## 7. Yetersiz veya riskli kestirmeler

- Yalnızca `|| ui.brainOpenNote` silmek: geniş kelime eşleşmeleri, seçili rapor ve arka plan kaynak turu kalır.
- Kaynağı kısaltıp ayrı turu bırakmak: bir fazla API çağrısı ve kuyruk gecikmesi sürer.
- 20 bin karakteri doğrudan `voice_context` içine taşımak: native 6.000 sınırında sessiz kesilir.
- Kaynak ve soruyu paralel göndermek: mevcut seri oturum/geçmiş sırası ve sahiplik beklentilerini bozar.
- 45 s RPC süresini değiştirmek veya 30 s'de kuyruğu boşaltmak: gerçek yanıt süresini çözmez; gecikmiş native çalışma ile yarış doğurabilir.
- Otomatik sohbet silmek, model değiştirmek, yeniden kurmak veya Jev hatasını bu yamanın içine almak: kanıtlanan en küçük nedenin dışına çıkar ve kullanıcı verisi/davranışı üzerinde ek risk yaratır.

## 8. Kabul ölçütü ve kalan belirsizlik

Normal bir kullanıcı mesajı, kaynak desteği gerektiğinde de, yalnızca bir gerçek sohbet turu başlatmalı. Kaynak depolamak için ek model turu olmamalı. Kaynak boyutu, sahiplik, iptal ve durum sonlandırma regresyonları geçmeli; mevcut çevrimdışı kontroller bozulmamalı. Konuşma ve otomasyon çıktıları birbirine karışmamalı.

Bu değişiklik gereksiz beklemeyi kaldırır ve uzun beklemeyi yönetilebilir yapar. Qwen/Evren'in kendisinin hızlı yanıt vereceğini kanıtlamaz. Daha sonra kullanıcı izinli kontrollü canlı ölçüm istenirse aynı kısa istem/aynı model/aynı rota ile dispatch–ilk çıktı–sonuç süreleri karşılaştırılabilir; otomatik sağlayıcı değişikliği yapılmamalı. Şimdi böyle bir ölçüm yapılmadı.

## 9. Kullanıcının takip sorusu: Markdown dosyaları ve otomasyon geçmişi

7 Kasım takip incelemesi. GitHub `https://github.com/fatihaybsn/Avalon` ve yerel Git geçmişindeki 15 commit incelendi; kod değiştirilmedi.

### Üç farklı veri yolu birbirine karıştırılmamalı

- Yerel Hermes kurulumunda `C:/Users/Fatih/AppData/Local/hermes/SOUL.md` (667 bayt), `memories/USER.md` (1.379 bayt) ve `memories/MEMORY.md` (2.188 bayt) mevcut. İçerikleri bu inceleme için dökülmedi. Native `agent/system_prompt.py:522–555`, etkin hafıza/profil bloklarını ve SOUL kimlik metnini normal sistem talimatına ekliyor. Avalon ayrıca `main.mjs:948` içindeki `loadUserContext` ile USER/MEMORY metnini topluyor; relay profil kısmında ilk 2.000 karakteri kullanıyor. Bunlar kaynak depolama amaçlı ayrı `kind: context` çağrısıyla aynı mekanizma değildir. Girdi boyutuna katkıları olabilir; bu dosyaları kaldırma önerilmiyor.
- Somut sorunlu gizli isteğin kaynağı salt okunur SQLite ile kesinleştirildi: mesaj ID 5866, oturum `20261107_143904_eb9eb7`, kaynak yolu `brain:Edge-AI-AI-system-Engineering.md`. Notun `content` alanı 19.987 karakter, tüm gizli istek 20.773 karakter. Bu, kullanıcının kalıcı profil/kimlik dosyası değil; notlar bölümündeki ayrı bir belgedir. Arayüzde açık olması veya geniş konu eşleşmesi bu yolu tetikleyebiliyor; kullanıcı mutlaka o notu istemiş olmayabilir.
- Node-RED görev girdileri ayrı: `automationRunner.mjs:47–53` dalın başarılı önceki çıktı referanslarını doğruluyor; `:190–218` araştırma ve Hermes adımlarına uygun yoldan iletiyor. `automationHermes.mjs:96–109`, ayrı görev oturumu açıp `inputs` referanslarını çalışma talimatına ekliyor; gerekli dosyaları Hermes araçlarıyla okuyor. `automationMemory.mjs:48–122`, akışa özel `inputs/<flowId>/inputs.json`, yerel Markdown belgeleri ve turlar arası kayıtları araştırma girdilerine ekliyor. Bu modüllerde sohbetin `attachConversationSource` / `relayUserText` yoluna çağrı bulunmadı. Buradaki kaynak aktarımı korunmalı.

**5.500 karakterlik öneri yalnızca sohbetin mevcut `voice_context` alanı içindir. Otomasyonun belge/rapor girdilerine uygulanmamalıdır.** Otomasyonun mevcut farklı boyut sınırları ve gerekli dosya referansları bu düzeltmenin kapsamı dışındadır.

### Tarihsel doğrulama

| Zaman / commit | Kanıt |
| --- | --- |
| 31 Ekim `e76789e` | İlk commit yalnızca LICENSE içeriyor; daha eski uygulama kaynakları bu geçmişte yok. |
| 31 Ekim `3173f28` | İlk toplu kaynak yayımında gizli kaynak çağrısı, `ui.brainOpenNote` koşulu, seçili iş sonucu yükleme ve tamamlanan Hermes sonucunu sohbete ekleme zaten mevcut. |
| 31 Ekim–4 Kasım arasındaki sonraki 13 commit | `attachConversationSource`, `relayUserText` ve `announceHermesCompletion` karşılaştırıldı. İlk iki blok bütün kaynak sürümlerinde aynı. Üçünün de mevcut çalışma kopyası ilk yayım sürümüyle aynı. |
| 4 Kasım `15f8a00` | Node-RED araştırma otomasyonu eklendi; main değişiklikleri servis/düzenleyici/IPC/kapanış bağlantıları. Sohbet kaynak fonksiyonunu eklemiyor veya değiştirmiyor. |
| 4 Kasım `93c702d` | Akışa kalıcı girdi ve parçalı rapor sentezi eklendi; sohbet kaynak fonksiyonları değişmiyor. |
| Güncel yerel A–D değişiklikleri | main farkları CLI aday çözümü, ortak çalışma güvenliği talimatı ve otomasyon IPC bağlantıları. İncelenen sohbet kaynak blokları aynı. |

Kaynak doğrulama bağlantıları: `https://github.com/fatihaybsn/Avalon/blob/3173f28/electron/main.mjs`, `https://github.com/fatihaybsn/Avalon/commit/15f8a00`, `https://github.com/fatihaybsn/Avalon/commit/93c702d`.

Bu tarihçe, gizli çağrının Node-RED/Hermes kartı eklenince sohbete yanlışlıkla bağlandığı varsayımını desteklemiyor. Gerçek ilk geliştirilme anı veya yazarı, toplu yayım öncesi commit bulunmadığından belirlenemez. Son A–D değişikliklerinin tamamının gecikmeyle ilişkisiz olduğu gibi daha geniş bir iddia da çıkarılmamalıdır.

### Önceden neden fark edilmeyebilir?

Gizli çağrı her mesajda zorunlu değil: uygun görülen kaynak varsa ve aynı oturumun süreç içi hash kümesinde yoksa çalışıyor. Aynı kaynak tekrarında atlanabiliyor; uygulama yeniden açılınca bu RAM kümesi yeniden başlıyor. Açık not, kaynak uzunluğu, oturum geçmişi ve model/API hızı sonucu değiştiriyor. Son DeepSeek kaynak turu yaklaşık 6 saniyede, Qwen kaynak turu 127 saniyede bitmiş. Dolayısıyla eski bir tasarım kusuru yeni bir yavaş model çağrısıyla çok görünür hale gelebilir. Hangi dış servis etkeninin değiştiği kanıtlanmış değil.

### Otomasyonu bozmadan uygulanacak sınır

Normal sohbetin gereksiz kaynak onay turu yerine ilgili kaynak gerçek mesaj bağlamına konulsun. Normal sohbette not/rapor hakkında konuşma desteği korunmalı; tüm kaynak erişimi kapatılmamalı. Yalnızca `attachConversationSource` çağrılarını silmek, önceden otomatik okutulan sonucun sohbet tarafından bilinmesini azaltabilir; öneri bu nedenle silme ile birlikte mevcut depolardan ilgili kaynağı seçerek getirmeyi içeriyor.

Otomasyonun önceki adım çıktıları, Markdown destek belgeleri, JSON çıktı sözleşmesi ve native izinleri aynı kalmalı. Gizli “okudum” sohbet turunu otomasyon tarafına taşımak da gereksiz: otomasyon zaten kendi girdisini ayrı çalışma isteğine veriyor. Ortak taşıyıcı değişirse hem sohbet hem otomasyon regresyonları çalıştırılmadan güvenli olduğu ilan edilmemeli. Bu inceleme uygulama veya test koşumu değildir.

## 10. Somut mesajda tetikleyici kesinleştirildi: açık not değil, “belge” eşleşmesi

Kullanıcının “neden bu belge, klasörde başkaları da var” sorusu üzerine normal kullanıcı mesajlarının saklanan `api_content` içindeki `Visible interface (data)` nesnesi salt okunur çözüldü. Qwen oturumu `20261107_143904_eb9eb7`, mesaj 5869: `brainOpen=false`, `brainOpenNote=null`, seçili görev kimlikleri null. DeepSeek mesaj 5863 ve diğer Qwen mesaj 5867 için de bu alanlar aynı. Üç normal mesajın metninde “belge” bulunuyor.

Dolayısıyla bu somut örneği “not ekranda açık kaldığı için oldu” diye anlatmak doğru değil. `relayUserText` içindeki geniş regex'in `belge` eşleşmesi hafıza aramasını başlatıyor. Açık not bulunmadığı için arama sorgusu kullanıcının mesajı oluyor. `searchMemory` (`main.mjs:2468`) kişisel hafıza ve vault sonuçlarını güven/puan/güncellenme zamanına göre sıralıyor; relay ilk iki güvenilir kabul edilen sonucu tam okuyor. Kaydedilen gizli kaynak, bu yoldan seçilen `brain:Edge-AI-AI-system-Engineering.md`. Klasörde bulunması tek başına her belgenin gönderilmesine yol açmıyor. Bir notun teknik eşleşme puanı, kullanıcının o kaynağı gerçekten istediğini kanıtlamıyor.

Geçmiş aramanın tam puanları veya anlamsal/sözcüksel katkı dağılımı bu kayıtlarda yok; neden özellikle bu notun en yüksek puanı aldığına dair kesin puan açıklaması yapılamaz. Güncel indeksle yeniden arama yapmak da geçmiş sıralamanın kanıtı olmaz ve ağ çağrısı gerektirebilir; yapılmadı. Açık notun ayrı tetikleyici olabildiği genel kod bulgusu geçerli, ancak somut gecikmedeki tetikleyiciyle karıştırılmamalı.

Regresyonda özellikle `brainOpen=false` ve “metin belgesi oluştur” ifadesi kullanılmalı: bu, kaynak arama isteği değil bir dosya oluşturma isteğidir. İlk somut küçük düzeltme bu niyet ayrımını sağlamalı; ardından ilgili kaynak gereken konuşmada ayrı onay turu kaldırılmalı. Sağlayıcının kaynak turu olmadan da gözlenen 123,7 saniyelik gecikmesi bağımsız bulgu olarak kalır.

## 11. Güncel kullanıcı tercihi: Neural Map kapalıyken otomatik not arama olmasın

Kullanıcı, beyin simgesi açıkken kaynak işlemi için beklemeyi kabul ediyor. Bu tercih önceki daha geniş hızlandırma önerisinin kapsamını daraltıyor: beyin açıkken gizli kaynak turunu kaldırmak artık bu ihtiyacı karşılamak için şart değil. Henüz uygulama talimatı veya kod değişikliği yok; aşağıdakiler inceleme bulguları.

- Kastedilen simge kesinleştirildi: `src/components/HudShell.tsx:326–332`, `BrainCircuit` düğmesi, “Neural Map” başlığı; `src/App.tsx:1643` `brainOpen` değerini tersine çeviriyor, `:1757` aynı değerle BrainGraph not/bağlantı görünümünü açıyor. Ayarlardaki model seçimi veya `IRIS_BRAIN_RELAY` bununla aynı anahtar değil.
- `App.tsx:1337–1348` panel durumunu `brainOpen` olarak gönderiyor; panel kapalıyken açık not/fokus alanları null oluyor. Backend `relayUserText` ise not arama koşulunda `ui.brainOpen === true` aramıyor. Bu nedenle kelime eşleşmesi panel kapalıyken de not aratıyor; somut mesaj kayıtları bunu doğruluyor.
- Arama öncesi ayrıca `searchBrain` aktif semantik indeks ve anahtar varsa `embedQuery` bekleyebiliyor (`main.mjs:2404–2410`). Arama kapısı bu ilave hazırlığı da engeller; bu incelemede ağ çağrısı yapılmadı ve somut gecikmedeki embedding süresi ölçülmüş değil.
- Sadece not arama koşulunu kapatmak bütün otomatik kaynak turlarını kapatmaz: seçili iş sonucu `main.mjs:499–503` ve tamamlanan Hermes işi `:3073–3077` panelden bağımsız `attachConversationSource` çağırabiliyor. İkisi de aynı sohbet kuyruğunda kullanıcı mesajını bekletebilir. Bunlar otomasyonun zorunlu adımlar arası girdi aktarımından farklıdır.
- Panel kapatma yalnızca UI değerini değiştiriyor; daha önce kabul edilmiş kaynak turuna native iptal göndermiyor. Beyin açıkken başlayan kaynak isteği, panel kapatıldıktan sonra da devam edip sonraki mesajı bekletebilir. Sadece yeni aramaya kapı koymak bu durumu çözmez. Mevcut tur iptal edilecekse yalnızca ona ait mevcut stop/AbortController kullanılmalı; geçmişi veya kuyruğu zorla temizleme.

İstenen davranış için en küçük aday: sohbetin yeni otomatik vault aramasını, aynı cihaz ve oturuma ait açık `brainOpen === true` şartına bağlamak; eksik/başka oturuma ait UI durumunda arama yapmamak. Panelden bağımsız iş sonucu turlarını ve panel kapatılırken sürmekte olan isteği ayrı değerlendirmeden “kapalıyken artık hiç ek bekleme yok” denmemeli. Tam sonuçların depolanması, UI bildirimleri ve otomasyonun girdi referansları korunmalı. Düğme bir sağlayıcı gecikmesi kontrolü değildir; normal model isteğinin uzun sürmesi ayrıca mümkün.

Uygulama istenirse test matrisine panel açık/kapalı, UI bilgisi eksik/başka oturuma ait, seçili sonuç, arka plan tamamlanması ve açıkken başlayıp panel kapatılan kaynak isteği eklenmeli. Kullanıcı beyin açıkken beklemeyi kabul ettiği için yalnızca performans amacıyla açık moddaki davranışı yeniden tasarlama gereği yok.

## 12. Son ve geçerli hedef: beyin KAPALIYKEN arama yapılmayacak

Kullanıcının son mesajı hedefi kesinleştirdi: **beyin kapalıyken otomatik not araması yapılmayacak.** Aradaki açık/kapalı ters anlatımını esas alma. Bu bölüm güncel uygulama hedefidir. Kullanıcı halen araştırma istiyor; uygulama kodu değiştirilmedi.

Üretim `relayUserText` ve `attachConversationSource` fonksiyonları TypeScript AST ile alınarak VM içinde çalıştırıldı. Kaynak okuma ve Hermes istemcisi sahte; ağ/gerçek Hermes/otomasyon yok. Önerilen `ui.brainOpen === true` koşulu yalnızca bellekteki fonksiyon metnine eklendi; depodaki kod değiştirilmedi. Üç kontrol assertion ile geçti:

| Beyin kapalı test durumu | Not araması | Ek kaynak turu | Gerçek kullanıcı turu |
| --- | --- | --- | --- |
| Mevcut üretim kodu, “Masaüstüne metin belgesi oluştur” | 1 | 1 | 1 |
| Yalnızca önerilen arama kapısı | 0 | 0 | 1 |
| Aynı kapı, ayrıca seçili iş sonucu var | 0 | 1 | 1 |

Son satır, koşulun not aramasını gerçekten engellediğini fakat sohbetin bütün ek kaynak turlarını engellemediğini kanıtlıyor. Tamamlanan iş bildirimindeki kaynak yükleme de ayrı bir giriş noktasıdır. Bu nedenle “tüm hız problemi çözülür” denemez. Somut hatalı not araması ve o notu modele önceden okutmanın 127 saniyelik ek beklemesi bu yolla önlenebilir. Kaynaksız gerçek model isteğinde ölçülmüş 123,7 saniye ise bundan bağımsızdır. Eski sohbet geçmişi ve halihazırda çalışmakta olan istekler de tek koşulla temizlenmez.

Otomasyon ayrımı tekrar doğrulandı: runner kendi `selectedInputs`/`memory.prepare` yolunu, Hermes adaptörü ise ayrı görev oturumu ve `instructions` girdisini kullanıyor. Bu dosyalarda `brainOpen`, `relayUserText`, `attachConversationSource`, `searchMemory` bağımlılığı bulunmadı. Arama kapısı sohbet girişinde uygulanmalı; ortak `submit`, native bellek veya otomasyon girdileri genel olarak kapatılmamalı. Böylece otomasyonun kaynakları korunabilir. Sohbette sonuca otomatik erişme davranışı değiştirilecekse, işin kendisini ve sonuçların depolanmasını değiştirmeden ele alınmalı.

Güncel mevcut koda karşı çevrimdışı test koşumu: `node --test test/automationHermes.test.mjs test/automationRunner.test.mjs test/automationMemory.test.mjs test/hermesWorkPolicy.test.mjs` — **26/26 geçti**, sıfır başarısızlık. Bu, mevcut otomasyon/izin/çıktı regresyon tabanıdır; henüz uygulanmamış değişikliğin tüm entegrasyon testlerini geçtiği anlamına gelmez. Üretim kodunda değişiklik yok, canlı sağlayıcı çağrısı yok. Uygulama sonrası kapalı durum regresyonları ve ilgili tam testler yeniden koşulmalı.
