# A–B yaşam döngüsü yarışının düzeltilmesi

## Kök neden ve kanıt

Python yardımcı öldüğünde OS kilidi serbest kalıyor, fakat asıl worker Hermes temizliğini hâlâ bekleyebiliyordu. Eski kontrol yalnızca sonlanmış, belirsiz kayıtları engellediği için `running` kayıt yeni başlangıcı dışlamıyordu. İki bağımsız worker, üretim `runEntry`/`runAutomation`, in-memory Node-RED sınırı ve kontrollü sahte Hermes temizliği kullanan kalıcı regresyon testi önce başarısız oldu: ikinci worker'ın ilk mesajı `result` yerine `entered` idi.

## Çözüm

Mevcut OS kilidi altında, yeni bir occurrence tüketilmeden ve iş gönderilmeden önce aynı kaynağın önceki çalışma kayıtları kontrol ediliyor. `running` veya `executionPending` kaydı canlı worker'a aitken yeni çakışan çalışma reddediliyor. Terminal görev statüsü güvenli sonlanma kanıtı sayılmıyor. `executionPending`, otomasyon adaptörü kapatılıp temizlik tamamlandıktan sonra temizleniyor; araştırmalarda da mevcut runner sonlanma sınırına bağlandı.

Ölü worker kayıtları mevcut uzlaştırma/checkpoint kurtarmasıyla işleniyor. Belirsiz Hermes işi, `running` statüsü nedeniyle artık inceleme kontrolünün dışında kalmıyor. Canlı temizliğin üzerinden inceleme onayıyla atlanamıyor. Normal kapanıştan sonra sonraki iş serbest; farklı akış ve bağımsız araştırma kapsamları etkilenmiyor. İç içe araştırma mevcut lease'i devralmaya devam ediyor.

Yeni kilit altyapısı, süreç motoru, bağımlılık veya scheduler eklenmedi. JSON/PID ile OS kilidi edinilmiyor; mevcut OS dışlamasına çalışma durumunun semantik kabul kontrolü eklendi. Silinebilir tanılama dosyası `active.lock` güvenlik kaynağı yapılmadı.

Güvenli kurtarma: önce iptal ve temizlik; takılmışsa PID/komut satırı doğrulanarak ilgili runner'ın kesin sonlandırılması; ardından uzlaştırma ve Hermes/dış etkilerin kontrolü; gerekiyorsa mevcut runId inceleme onayı. PID yeniden kullanımı şüphesinde başka süreç körlemesine durdurulmaz; doğrulanmış yeniden başlatma sonrası uzlaştırılır. TTL ile körlemesine açma veya kayıt silme yok. Kalıcı dosyalar/raporlar korunur; eski iş otomatik tekrarlanmaz.

## Testler

| Kontrol | Sonuç |
| --- | --- |
| Genel paket | **343/343 geçti**, 0 başarısız, 0 atlanan |
| Otomasyon test komutu | **53/53 geçti**; yeni yarış testi dahil |
| Python zamanlayıcı | **6/6 geçti** |
| Syntax | **60 Electron + 3 otomasyon modülü**, Python geçti |
| TypeScript / masaüstü / mobil build | Geçti |
| Whitespace | Geçti |

Beş yeni test: yardımcı çökmesi sırasında gecikmiş temizliğin iki worker'ı dışlaması ve onaylı yeniden başlangıç; terminal-ama-temizlenen kayıtta erken onayın reddi ve worker çökmesi sonrası kurtarma; normal kapanış/tekrar başlangıç; bağımsız akışın paralelliği; araştırmanın terminal-ama-temizlenen durumunun dışlanması ve ölü owner checkpoint'inin sonraki occurrence öncesi kurtarılması. Mevcut manuel/zamanlanmış/headless, sesli kullanım, izin ve araştırma testleri genel pakette geçti.

## Değişen dosyalar

- [automationRunner.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/automationRunner.mjs), [automationService.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/automationService.mjs)
- [researchRunner.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/researchRunner.mjs), [researchStore.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/electron/researchStore.mjs)
- [automationAdmission.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/automationAdmission.test.mjs), [automationLifetimeWorker.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/helpers/automationLifetimeWorker.mjs), [researchLock.test.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/test/researchLock.test.mjs), [test-automation.mjs](C:/Users/Fatih/Desktop/Avalon/Avalon/scripts/test-automation.mjs)
- [README](C:/Users/Fatih/Desktop/Avalon/Avalon/README.md), [otomasyon kılavuzu](C:/Users/Fatih/Desktop/Avalon/Avalon/docs/AUTOMATION.md): v2 geçişi, yeniden başlatma, kurtarma ve uygulama/başlatıcının birlikte geri dönüşü.
- Bu rapor.

Hermes kaynakları, yamaları, sabit sürümü ve kurulum sözleşmesinde Git farkı yok. Mevcut v2 başlatıcı biçimi değişmedi; bu düzeltme için yeniden oluşturulması gerekmedi. Canlı Hermes/GPT görevi veya dış servis işlemi çalıştırılmadı. Build yalnızca mevcut büyük chunk ve `inlineDynamicImports` uyarılarını verdi; dağıtım EXE'si üretilmedi. Önceki kullanıcı değişiklikleri korundu, commit oluşturulmadı.

Kalan sınır: OS süreç ölümü, harici araç yan etkilerinin geri alındığını kanıtlamaz. Bu durumda insan incelemesi gerekir; kayıtların elle silinmesi ve dış etkilerin doğrulanmadan yeniden çalıştırılması güvenli kurtarma değildir.
