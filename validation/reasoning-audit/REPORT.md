# Evren düşünme seviyesi incelemesi

Tarih: 5 Kasım 2026. Kapsam: bu Avalon çalışma kopyası, bilgisayarda kurulu Hermes ve Evren'in canlı API'si. İnceleme sırasında kayıtlı seçim ve uygulanmış seçim `evren / qwen3.8-flash-next / xhigh` idi. Hermes'in genel `agent.reasoning_effort` ayarı `none` idi.

## Sonuç

Düşünme kontrolü gerçek: sağlayıcıya giden parametreleri ve sağlayıcının ürettiği düşünme tokenlarını ayrı ayrı doğruladım. Bununla birlikte arayüzdeki her seçenek ayrı bir çalışma seviyesi değil. Ayrıca Hermes'in genel düşünme ayarı ile Avalon'un yalnız açma/kapama gönderen seçenekleri arasında gerçek bir entegrasyon hatası var.

Kayıtlı **Qwen xhigh** seçimi, kurulu Hermes'in istek oluşturucusu ve kullanılan SDK'dan geçince gerçekten `thinking: true, reasoning_effort: "xhigh"` oluyor. Evren aynı parametrelerle yapılan canlı denemelerde düşünme tokenları üretiyor. Bu seçenek yalnızca arayüz etiketi değil.

## Aynı kısa soruda canlı ölçüm

Soru: `37*43 + 19*23`; doğrusu `2028`. Her satır ayrı istek. Aynı istem, sıcaklık 0, seed 54231 ve 512 toplam üretim tokenı sınırı kullanıldı. Süreler tekil gözlemlerdir; sunucu yükü ve önbellek nedeniyle seviyelerin hız sıralaması olarak kullanılamaz.

| Model | Gönderilen ayar | Düşünme tokenı | Toplam süre | Sonuç |
|---|---|---:|---:|---|
| Qwen 3.8 Flash Next | kapalı | 0 | 6,15 sn | 2028, doğru |
| Qwen 3.8 Flash Next | low | 103 | 4,63 sn | 2028, doğru |
| Qwen 3.8 Flash Next | medium | 112 | 9,96 sn | 2028, doğru |
| Qwen 3.8 Flash Next | xhigh | 107 | 12,45 sn | 2028, doğru |
| Qwen 3.8 Flash Next | yalnız açık | 107 | 5,58 sn | 2028, doğru |
| DeepSeek V4.1 Flash | kapalı | 0 | 3,57 sn | 2038, yanlış |
| DeepSeek V4.1 Flash | low | 46 | 14,99 sn | 2028, doğru |
| DeepSeek V4.1 Flash | high | 46 | 15,00 sn | 2028, doğru |
| GLM 5.3 | low | 20 | 12,72 sn | 2028, doğru |
| Gemma 4 31B | kapalı | 0 | 5,40 sn | 2028, doğru |
| Gemma 4 31B | açık | 425 | 10,90 sn | 2028, doğru |

Bu tablo, genel Hermes ayarının eklenmediği sağlayıcı kontrol deneyidir. Avalon'un mevcut gerçek istek biçimindeki çakışma aşağıdadır. Qwen `low` burada doğrudan API ile sınandı; mevcut Avalon arayüzü Qwen için bu seçeneği sunmuyor.

Çıkarım: açık/kapalı farkı gözlendi. Farklı seviyeler aynı kolay soruda benzer, hatta aynı düşünme miktarını ve aynı doğru cevabı üretebiliyor. Low ile xhigh'ın her soruda farklı cevap vereceği veya xhigh'ın her seferinde daha doğru olacağı sonucu çıkmaz. Bu küçük örneklem genel başarı oranı ölçümü değildir.

MiMo V2.6 Pro'nun low, xhigh ve açık denemeleri HTTP 503 `model_capacity_exhausted` döndü. GLM'nin kapalı ve high denemeleri de kapasite nedeniyle tamamlanamadı. Bu durumlar düşünme ayarının çalışmadığını göstermiyor; bu modeller için eksiksiz seviye karşılaştırması elde edilemedi.

## Gerçek hata: Avalon Açık seçse de Hermes none ekleyebiliyor

Avalon'daki `enabled` seçeneği yalnız `thinking: true` üretir. Kurulu Hermes'in custom sağlayıcı profili, bilgisayardaki genel `none` ayarını üst düzey `reasoning_effort: "none"` olarak ekler. Gerçek SDK serileştirmesinde ortaya çıkan JSON:

```json
{"thinking": true, "reasoning_effort": "none"}
```

Bu yalnızca kaynak kodundan tahmin edilmedi: kurulu Hermes `ChatCompletionsTransport`, gerçek sağlayıcı profili, custom-provider override dönüştürücüsü ve gerçek SDK çalıştırıldı; HTTP isteği ağsız `httpx.MockTransport` ile yakalandı. Arayüzün desteklediği 31 seçeneğin tamamı bu yoldan geçirildi. Sonra çakışan gövdeler doğrudan Evren'e gönderildi.

- Qwen'de `thinking: true` tek başına HTTP 200 ve 107 düşünme tokenı üretti.
- Qwen'de `thinking: true, reasoning_effort: "none"` HTTP 400 döndü. Sağlayıcının mesajı, kabul edilen seviyeleri `xhigh`, `medium`, `low` olarak bildirdi.
- Gemma'da hem açık hem kapalı seçeneklerinin genel `none` ile birleştirilmiş hali HTTP 400 döndü: model `reasoning_effort` parametresini desteklemiyor.
- DeepSeek'te `thinking: true, reasoning_effort: "none"` HTTP 200 döndü ama **0 düşünme tokenı** üretti ve yanlış `2038` cevabını verdi. Yani bu yapılandırmada **Açık seçimi gerçekten kapalı davranışa dönüşebiliyor**. Kontrol deneyindeki açık low/high istekleri 46 düşünme tokenı ve doğru `2028` üretti.
- GLM aynı çakışan `thinking: true, reasoning_effort: "none"` gövdesinde 26 düşünme tokenıyla doğru cevap verdi. Çelişen kontrollerin sonucu modele göre değişiyor; bütün modeller için tek bir öncelik kuralı çıkarılamaz.
- Qwen'de yalnız `reasoning_effort: "none"` HTTP 200, 0 düşünme tokenı üretti. Dolayısıyla bu bilgisayardaki **Varsayılan**, sağlayıcının varsayılan düşünme davranışıyla aynı değil: Hermes'in mevcut kapalı ayarı devreye giriyor. Ek parametresiz doğrudan Evren isteğinde ise 104 düşünme tokenı gözlendi.
- Açıkça `low`, `high`, `xhigh` gönderen Avalon seçimlerinde SDK'nin `extra_body` birleştirmesi genel `none` değerini değiştiriyor. Mevcut Qwen xhigh seçimi bu çakışmadan etkilenmiyor.

Kurulu Hermes'in hata sınıflandırıcısını gerçek 400 hata gövdeleriyle de çalıştırdım. Qwen ve Gemma hatalarını `FailoverReason.format_error` olarak görüyor; düşünme parametresini otomatik kaldıran özel kurtarma yolunu tanımıyor. Dolayısıyla bu iki somut hata için otomatik düşünme kurtarmasına güvenilemez. Tam bir canlı Avalon sohbeti başlatılıp yeniden oynatılmadı; istek oluşturma/serileştirme ve API yanıtı ayrı ayrı doğrulandı.

## Arayüzde aynı anlama gelen seviyeler

| Model | Mevcut Avalon eşlemesi | Anlamı |
|---|---|---|
| Qwen | high → xhigh; xhigh → xhigh | İki seçim tamamen aynı istek kontrolleri |
| DeepSeek | minimal → low; low → low | İki seçim aynı kontroller |
| DeepSeek | medium → high; high → high | İki seçim aynı kontroller |
| GLM | minimal → low; low → low | İki seçim aynı kontroller |
| GLM | medium → high; high → high | İki seçim aynı kontroller |
| MiMo | none/minimal/low/medium/high/xhigh | API kataloğu bu seviyeleri ayrı ayrı bildiriyor; canlı etki kapasite nedeniyle karşılaştırılamadı |
| Gemma | açık/kapalı | Kademeli effort kontrolü yok |

Bu eşlemeler güncel Evren kataloğundaki alias bilgileriyle uyumlu. Ancak Qwen listesinin eksik olduğu canlı olarak doğrulandı: sağlayıcı low ve medium kabul edip düşünme üretiyor; Avalon sadece high/xhigh gösteriyor. Medium kontrolü HTTP 200, 112 düşünme tokenı ve doğru cevap döndü. Bu ek canlı kontrol `medium-control.json` dosyasında bulunur.

`BrainModelService.catalog()` katalogdan model kimliklerini yeniliyor; düşünme seçeneklerini sağlayıcının güncel yeteneklerinden yeniden üretmiyor. Bunlar `electron/brainReasoning.mjs` içinde sabit. Bu nedenle arayüzde **Listeyi yenile**, Qwen'de eksik low/medium seçeneklerini getirmiyor.

## Daha zor soru ve token sınırı

Beş işçinin beş işe tekil atanması problemi kullanıldı. Doğru minimum maliyet 38; bütün 120 permütasyon yerelde taranarak doğrulandı. Görev ve doğrulama verileri `benchmark-task.json` dosyasında.

İlk 2.048 token sınırlı denemede Qwen kapalı, doğru iş atamasını verip toplam maliyeti 35 diye yanlış bildirdi. High ve xhigh istekleri aynı parametrelerle çalıştı; ikisinde de 2.048 üretim tokenının tamamı düşünmeye gitti, `finish_reason: length` ve `reasoning_budget_exhausted: true` döndü, kullanıcıya verilecek son cevap oluşmadı. Bu, daha yüksek seviyenin sınırlı üretim bütçesinde yanıtı tüketebileceğini somut olarak gösteriyor.

Bu 2.048 sınırı deney için konuldu. Kurulu Hermes yapılandırmasında `agent.max_tokens` / `model.max_tokens` için açık bir değer bulunmadı; bu deneyden üretimde her xhigh yanıtın kesildiği sonucu çıkarılamaz. Düşünme tokenları ile son cevap aynı üretim bütçesini paylaşıyor.

Ardından Qwen low/xhigh için aynı soru 4.096 token sınırı ve akış üzerinden tekrar karşılaştırıldı. İkisi de 180 saniyelik süre sınırına ulaştı; low için 5.929, xhigh için 6.113 düşünme karakteri geldi, ikisinde de son cevap yoktu. İstekler istemci tarafından sonlandırıldığı için son token kullanım çerçevesi alınamadı. Bu karşılaştırma **xhigh kalite üstünlüğünü doğrulamıyor**; ikisinde de gerçek düşünme akışını doğruluyor. Medium ile başlayan ek zor soru denemesi tamamlanmadan iptal edildi ve sonuç sayılmadı. Sonuçlar `assignment-stream-results.json` içinde; düşünme metni saklanmadı.

## Ayar uygulama ve mevcut testlerin sınırı

Arayüzde seçim yapmak tek başına etkin oturumu değiştirmiyor; **Uygula** işlemi gerekiyor. `BrainModelService` güvenli geçiş noktasını bekliyor. Sağlayıcı alias'ları model ve düşünme seçimine göre ayrılıyor; çalışan görevler başladıkları rotayı koruyor. Bu davranışa ilişkin mevcut testler geçti.

**Bağlantıyı dene** testi ise tam sohbet yoluyla aynı değil: `sidecar/brain_provider.py` doğrudan transport oluşturuyor, seçimin `extraBody` değerini ekliyor; kurulu agent'ın genel düşünme ayarını ve custom sağlayıcı profilini aynı biçimde uygulamıyor. Soru basit bir araçla 2+3 hesabı. Test bağlantı/araç/yanıt biçimini sınar; low ile xhigh'ın düşünme derinliğini, başarı farkını veya sohbet yolundaki `none` çakışmasını ölçmez.

Araştırma yolunda düşünme kontrolü `gptResearch.mjs` → `gpt_researcher_worker.py` üzerinden ayrıca iletiliyor. Bu yol Hermes sohbetindeki genel `none` ayarını doğrudan kullanmıyor. Kurulu GPT Researcher'ın otomatik effort eklediği sabit model listesinde bu beş Evren model kimliği bulunmuyor; normal akışta seçilen kontrolün bu noktada değiştirildiğine dair bir bulgu yok. Tam araştırma işi bu incelemede çalıştırılmadı.

Mevcut model, oturum geçişi, araştırma seçimi ve otomasyon testlerinden **52/52 geçti**. Bu testlerin başarılı olması, yukarıdaki gerçek SDK/sağlayıcı çakışmasının kapsandığı anlamına gelmiyor.

## Düzeltme gereksinimleri

1. Avalon'un açık/kapalı/default seçeneklerinin genel Hermes effort değerinden nasıl etkileneceği açıkça tanımlanmalı. Yalnız boolean gönderen isteklerde ilgisiz veya çelişen `reasoning_effort` kalmamalı. Çözüm yalnız bu bilgisayarın genel ayarını değiştirerek gizlenmemeli; farklı genel ayarlarla da sınanmalı.
2. Qwen'in gerçek low/medium/xhigh desteği arayüze yansıtılmalı. Eş anlamlı high/xhigh ve minimal/low gibi seçenekler farklı derinlikler gibi görünmemeli.
3. Bağlantı testi gerçek sohbetin aynı sağlayıcı çözümleme/istek oluşturma yolunu kullanmalı; düşünme tokenı, kesilme nedeni ve son yanıtın varlığı ayrı raporlanmalı.
4. Seviyelerin kalite etkisi için daha fazla görev ve tekrarlı ölçüm gerekir. Mevcut bulgular gerçek düşünme davranışını ve somut hataları doğruluyor; evrensel bir kalite sıralaması vermiyor.

## Kanıt dosyaları ve kaynaklar

- `provider-evidence.json`: [canlı Evren model kataloğu](https://evren-llmapi.ssyz.org.tr/v1/models) ve [OpenAPI şeması](https://evren-llmapi.ssyz.org.tr/openapi.json) içinden ilgili alanlar.
- `ui-controls.json`: Avalon'un beş Evren modeli için doğrulanan 31 seçeneği ve ürettiği kontrol gövdeleri.
- `hermes-wire.json`: kurulu Hermes + gerçek SDK ile yakalanan nihai kontrol parametreleri; ağ veya yapılandırma yazımı yok.
- `stream-results.json`: kısa soruda 20 canlı kontrol isteği.
- `native-controls-results.json`: genel `none` eklenmiş mevcut entegrasyon biçiminin ek canlı kontrolleri.
- `live-results.json`: ilk sınırlı Qwen atama denemeleri; sonraki parti iptal edildi, tamamlanmış deney sayılmadı.
- `assignment-stream-results.json`: 4.096 token sınırında low/xhigh atama denemeleri; ikisi de süre sınırına ulaştı.
- `medium-control.json`: Qwen medium için kısa sorudaki ek canlı kontrol.
- `error-classification.json`: gerçek 400 gövdelerinin kurulu Hermes tarafından sınıflandırılması.
- `audit.mjs`, `stream-audit.mjs`, `hermes-wire.py`: tekrar çalıştırılabilir ölçüm kodu. Canlı Node betikleri Evren API isteği yapar; anahtarları yazdırmaz, model seçimini veya genel Hermes ayarını değiştirmez. Python betiği kurulu Hermes ortamı ile çalıştırılmalıdır.

Kaynak kodu: `electron/brainReasoning.mjs`, `electron/brainModels.mjs`, `sidecar/brain_provider.py`, `src/components/BrainModelPanel.tsx`, `electron/hermesInteractiveTransport.mjs`, `electron/gptResearch.mjs`, `sidecar/gpt_researcher_worker.py`; ayrıca kurulu Hermes'in `providers/custom` profili, `agent/transports/chat_completions.py`, `hermes_cli/runtime_provider_custom.py` ve hata sınıflandırıcısı.

İnceleme çıktıları bu dizine eklendi. Uygulama davranışını değiştiren bir düzeltme uygulanmadı.
