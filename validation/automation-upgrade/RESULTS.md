# Otomasyon düzenlemesi — 6 Kasım 2026

Tamamlandı. Başlangıçtaki kullanıcı değişiklikleri korunarak uygulandı. Gerçek Hermes/GPT Researcher görevi, canlı uçtan uca uygulama testi, tarayıcı veya masaüstü otomasyonu çalıştırılmadı. Test dosyaları yalnızca geçici test klasörlerinde üretildi.

## Son doğrulama

| Kontrol | Sonuç |
| --- | --- |
| Başlangıç npm test | 251 / 251 geçti |
| Son npm test | **283 / 283 geçti**, 0 başarısız, 0 atlanan |
| Otomasyon test grubu | Son genel pakette 38 test geçti (31 yeni kapsam testi + mevcut 7 test) |
| Native Hermes taşıyıcısı | Yeni belirsiz prompt.submit teslim testi dahil genel paket içinde geçti |
| Python zamanlayıcı mock testleri | **6 / 6 geçti** — python -B test/research_scheduler_test.py |
| GPT Researcher çevrimdışı işlem hattı | Geçti — kurulu araştırma Python'u ile scripts/test-gpt-researcher-offline.py; model/arama/tarayıcı sahte, yalnızca yerel test HTTP stub'ı |
| Electron/otomasyon syntax | 55 Electron + 3 automation modülü geçti |
| Python syntax | npm run check:python geçti |
| TypeScript + masaüstü/mobil build | npm run build geçti |
| Git whitespace | git diff --check geçti |
| Bağımlılıklar | Yeni runtime veya geliştirme bağımlılığı eklenmedi |

Test günlükleri bu klasörde yerel olarak saklanır (Git'in mevcut *.log kuralına tabidir): unit-tests.log, build.log, syntax.log, python.log, scheduler-tests.log, research-offline.log. automation-tests.log ve contracts.log ara hedefli kontrolleri kaydeder; son genel test sonucu unit-tests.log içindedir.

Ara kontrol sırasında araştırma Python ortamındaki eksik tzdata nedeniyle zamanlayıcı testleri başarısız oldu. Saat dilimi verisi bulunan mevcut sistem Python'u ile altı test geçti; bağımlılık kurulmadı. Node-RED registry envanter testinin çeviri yaşam döngüsü test fixture'ında stublandı; son sonuçlarda asenkron test hatası yoktur. Build yalnızca mevcut büyük chunk ve inlineDynamicImports deprecation uyarılarını verdi.

## Kabul senaryoları

- Eski doğrusal araştırma, prompt/amaç/kaynak ayarları, aynı turdan rapor aktarımı ve eski arşiv okumaları.
- Araştırma → Hermes → Hermes talimat ve çıktı referansları; dosya içeriklerinin IPC'de tekrarlanmaması.
- Koşullu yönlendirme, eksik rapor düzeltmesi, geri bildirim ve deneme sınırı.
- Node-RED'in gerçek switch/change dosyalarının bellekte çalışması; üretim host ayarlarıyla yalnızca izinli düğümlerin yüklenmesi.
- Hata/ikinci çıkış/catch davranışı; JSON sırasından bağımsız doğru son deneme kimliği.
- Yinelenen mesaj/çalışma/occurrence, iptal, zaman aşımı, bağlantı kopması ve kalıcı kesinti uzlaştırması.
- Belirsiz native teslim/iptal sonrası sonraki manuel ve zamanlanmış başlangıçların engellenmesi ve doğru çalışma için açık kullanıcı incelemesi.
- Native onay/yanıt, başlatma onayı, yanlış/stale onayın reddi, gizli değerlerin yanıt dosyasına yazılmaması.
- Onay öncesi iptalin görev başlatmaması; yanlış tipteki onay ayarının sessizce atlanmaması.
- Çalışan akışın immutable kopyası, güvenli JSON şablonu/içe aktarım, desteklenmeyen düğümlerin reddi.
- Boş/bozuk JSON, zorunlu alan/dosya ve çalışma kökü kontrolleri.
- Manuel başlangıçta kayıtlı çıktı klasörünün korunması ve zamanlama motorunun yeniden kullanılmaya devam etmesi.

## Düzenlenen dosyalar

Bu görevin değiştirdiği veya eklediği dosyalar:

- automation/flows.cjs; automation/host.cjs
- automation/nodes/avalon.js; automation/nodes/avalon.html
- automation/nodes/examples/research-hermes.json; automation/nodes/examples/research-revision.json
- electron/automationRunner.mjs; electron/automationRuntime.mjs; electron/automationService.mjs
- electron/automationHermes.mjs; electron/hermesRuntime.mjs; electron/hermesInteractiveTransport.mjs
- electron/researchRunner.mjs; electron/main.mjs; electron/preload.cjs; electron/applicationMethods.mjs
- src/components/AutomationPanel.tsx; src/components/WorkCard.tsx
- src/types.ts; src/vite-env.d.ts; src/lib/tasks.ts
- src/mobile/api.ts; src/mobile/MobileApp.tsx; src/styles/research.css
- test/automation.test.mjs; test/helpers/automationSimulation.mjs
- test/automationRunner.test.mjs; test/hermesInteractiveTransport.test.mjs
- scripts/test-automation.mjs; scripts/check-electron.mjs
- README.md; INSTALL-WINDOWS.md; docs/AUTOMATION.md; bu sonuç dosyası

Çalışma ağacında bunlardan önce var olan diğer araştırma/model değişiklikleri geri alınmadı ve bu görevin değişikliği olarak sunulmaz.

## Temizlik ve sınırlar

Eski doğrusal akış derleyicisi, Electron tarafındaki adım-sırası yürütücüsü, yalnızca ok/kimlik taşıyan eski mesajlaşma, kopya Hermes aday-yol kodu, yinelenen iptal UI'sı ve otomasyon kurup canlı host başlatan eski test kodu kaldırıldı. Mevcut araştırma hafızası ve Hermes zamanlayıcı mekanizması korundu.

Bu sürüm tek etkin mesaj kolunu, koşullu kolları ve sınırlı geri dönüşleri destekler; paralel çoğaltma/subflow/function/exec/inject/JSONata desteklemez. Hermes düğümü yerel interactive taşıyıcıyı kullanır; uzak runs_api desteklenmez. Güvenli şablonlar prompt/koşul sabitlerini ve yerel yolları içermez; kullanıcı bu ayarları kendi ortamında yeniden girer.

Çalışma klasörü denetimi bir işletim sistemi sandbox'ı değildir; native araç yetenekleri ve izinler mevcut Hermes kurulumuna bağlıdır. Varlık kontrolleri bir dosyanın yeni üretildiğini veya raporun doğru olduğunu kanıtlamaz. Kesinti sonrası otomatik akış devamı ve harici işlemlerde kesin bir kez yürütme garantisi yoktur. Belirsiz Hermes işi açık kullanıcı incelemesi gerektirir.

Dağıtım paketi/kurulum dosyası yeniden üretilmedi; gerçek UI, servis ve bilgisayar işlemleri kullanıcı talebi gereği canlı olarak doğrulanmadı. Ayrıntılı kullanım ve sözleşme: [docs/AUTOMATION.md](../../docs/AUTOMATION.md).
