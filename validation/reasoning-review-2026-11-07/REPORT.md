# Avalon düşünme seviyeleri incelemesi — 7 Kasım 2026

Karar: Benzer yanıt süreleri tek başına arıza belirtisi değil. Basit işlerde low ve xhigh birbirine çok yakın düşünme miktarı kullanabiliyor. Bunun yanında Avalon'un model seçeneklerinde ve Hermes ile parametre birleştirmesinde doğrulanmış sorunlar var. Bütün farkı Evren'e bağlamak doğru olmaz.

## Doğrulama kapsamı

Mevcut çalışma kopyası, bilgisayarda kurulu Hermes, gerçek SDK serileştirmesi, Evren'in güncel model kataloğu/OpenAPI şeması ve canlı API yanıtları incelendi. Depodaki 5 Kasım ölçümleri ayrıca okundu; aşağıdaki ana bulgular 7 Kasım'da yeniden doğrulandı. Uygulama kodu veya kullanıcı/model ayarları değiştirilmedi; yalnız bu dizine inceleme dosyaları eklendi.

Kayıtlı model `evren/qwen3.8-flash-next/xhigh`. İlgili Hermes sağlayıcı girdisi gerçekten `thinking: true, reasoning_effort: xhigh` içeriyor. Genel `agent.reasoning_effort` değeri `none`. `agent.max_tokens` ve `model.max_tokens` için açık yapılandırma değeri yok. Bu son bilgi, çalışma anında hiç token sınırı olmadığı anlamına gelmez.

## 1. Bazı seçenekler farklı seviyeler değil

| Model | Avalon'da farklı görünen seçenekler | Evren'e gönderilen değer |
|---|---|---|
| Qwen 3.8 Flash Next | high / xhigh | İkisinde de xhigh |
| DeepSeek V4.1 Flash | minimal / low | İkisinde de low |
| DeepSeek V4.1 Flash | medium / high | İkisinde de high |
| GLM 5.3 | minimal / low; medium / high | Sırasıyla low; high |
| Gemma 4 31B | Açık / kapalı | Kademeli effort desteklemiyor |

Bu eşlemeler `electron/brainReasoning.mjs` içinde açıkça yapılıyor ve güncel Evren kataloğundaki alias bilgileriyle uyumlu. Dolayısıyla eş anlamlı seçeneklerin aynı davranışı göstermesi beklenen sonuç; arayüz bunları bağımsız seviyeler gibi sunmamalı.

Qwen için ayrıca eksik seçenek sorunu var: Avalon yalnız high/xhigh sunuyor, ancak canlı API low ve medium desteğini bildiriyor. Bu incelemede low ve xhigh çalıştırıldı; medium 5 Kasım kaydında HTTP 200 ve düşünme tokenlarıyla doğrulanmıştı. Güncel katalogda `reasoning_effort_values` null, alias haritası ise yalnız `high: xhigh`; alias listesi tek başına bütün desteklenen seviyelerin listesi değil. `BrainModelService.catalog()` yetenekleri dinamik işlemek yerine yalnız model kimliklerini yeniliyor. Listeyi yenilemek eksik seviyeleri getirmiyor.

## 2. Açık seçeneği ile genel none ayarı çakışıyor

Avalon'un Açık seçeneği yalnız `thinking: true` gönderiyor. Hermes'in custom sağlayıcı profili genel ayardan ayrıca `reasoning_effort: none` ekliyor. Böylece nihai JSON iki çelişen kontrol içeriyor.

Gerçek Hermes transport + custom-provider override + gerçek SDK, ağsız `httpx.MockTransport` ile çalıştırıldı. Mevcut 62 arayüz seçeneği, genel none/low/high ayarları altında toplam 186 kez serileştirildi. Çakışma yalnız kaynak kodundan tahmin edilmedi. Açık low/high/xhigh seçimleri kendi effort değerini SDK birleştirmesinde koruyor; yalnız Açık/Kapalı/Varsayılan seçenekleri genel effort değerinden etkileniyor.

Oluşan `thinking: true, reasoning_effort: none` gövdesi 7 Kasım'da doğrudan Evren'e gönderildi:

| Model | Canlı sonuç |
|---|---|
| Qwen | HTTP 400; kabul edilen açık seviyeler xhigh, medium, low |
| Gemma | HTTP 400; reasoning_effort parametresi desteklenmiyor |
| DeepSeek | HTTP 200, **0 düşünme tokenı**, hesap sorusuna yanlış 2038 cevabı |

DeepSeek'in tek yanlış cevabı genel bir doğruluk oranı ölçümü değildir. Burada önemli bulgu, Açık seçimine rağmen düşünme tokenının sıfır olmasıdır. Kayıtlı Qwen xhigh sağlayıcı girdisi bu none çakışmasını kendi explicit effort değeriyle aşıyor.

Bu doğrulama tam bir canlı Avalon sohbet oturumunun ağ kaydı değildir: kurulu istek oluşturma/serileştirme yolu ve aynı gövdenin gerçek sağlayıcı yanıtı ayrı ayrı sınandı. Mevcut bir oturumun kendi reasoning pin'i varsa genel ayardan farklı davranabilir.

## 3. “Kolay soruda erken bitiriyor olabilir” ihtimali

Evet, bu açıklama gözlemlerle uyumlu. Yüksek effort, her soruda belirli bir asgari düşünme süresini doldurma taahhüdü değil. Ancak Evren'in sunucusundaki kapalı uygulamayı görmeden “xhigh tam olarak şu token tavanıdır” demek mümkün değil; seviye bir model talimatı, bütçe veya bunların birleşimi olabilir.

Güncel Evren OpenAPI şeması ek parametrelerin vLLM'e iletildiğini belirtiyor. [vLLM belgeleri](https://docs.vllm.ai/en/latest/features/reasoning_outputs/#thinking-budget-control) düşünme bütçesini bir üst sınır olarak tanımlıyor ve effort adlarının model şablonuna göre eşlenebildiğini açıklıyor. Bu genel mekanizma, Evren'in her modelde aynı sayısal bütçeyi kullandığının kanıtı değildir.

Yeni canlı deneyde aynı Qwen modeli, aynı istem, sıcaklık 0, iki seed (54231/54232), 8192 toplam üretim tokenı ve istek başına 60 saniye sınırı kullanıldı. İkinci tekrarda seviye sırası ters çevrildi. Basit soru `37*43 + 19*23`; daha karmaşık soru dört işçinin dört işe minimum maliyetle atanması. Atama sorusunun doğrusu bütün 24 permütasyon yerelde taranarak bulundu: 32.

Basit soruda iki tekrarda da low 103, xhigh 107 düşünme tokenı kullandı; dört yanıt da doğru. Low süreleri 20,064 ve 3,020 saniye; xhigh süreleri 11,464 ve 4,926 saniye. Aynı seviyedeki bu süre değişimi, yalnız kronometreyle düşünme derinliği ölçmenin güvenilir olmadığını gösteriyor.

Daha karmaşık atama sorusunun sonuçları:

| Seviye | Seed | Düşünme tokenı | Süre | Sonuç |
|---|---:|---:|---:|---|
| low | 54231 | 793 | 44,180 sn | Minimum 32, doğru atama |
| xhigh | 54231 | Final ölçüm alınamadı | 60,005 sn | İstemci süre sınırında durdurdu; son cevap yok |
| xhigh | 54232 | Final ölçüm alınamadı | 60,011 sn | İstemci süre sınırında durdurdu; son cevap yok |
| low | 54232 | 1304 | 44,678 sn | Minimum 32, doğru atama |

Bu küçük örneklemde kolay sorudaki yakın davranış daha karmaşık soruda aynı kalmadı. Fakat xhigh'ın süre sınırından sonra ne cevap vereceği bilinmiyor; bir kalite üstünlüğü veya genel başarısızlık oranı çıkarılamaz. Sonlanmayan xhigh denemelerinde 1936 ve 1806 düşünme karakteri görüldü; karakter sayısı token sayısının yerine geçmez. Toplam sekiz karşılaştırma isteği ve üç çakışma kontrolü tamamlandı; iki karşılaştırma isteğinin tamamlanması istemci zaman aşımıyla oldu.

Deneyler modelden dosya/araç erişimi istemedi. Düşünme metni diske kaydedilmedi; yalnız karakter sayısı, sağlayıcının token ölçümü ve son cevap saklandı. İstemci süre sınırına ulaşan istekler için final token ölçümü yoktur; bunları modelin doğal bitişi veya token bütçesinin dolması diye yorumlamamak gerekir. Çakışma kontrollerinin üç isteği bir atama/xhigh ölçümüyle zaman bakımından örtüştü; süre karşılaştırmaları izole sunucu performans deneyi değildir.

## 4. OpenCode karşılaştırması

OpenCode uygulaması ile Avalon'un “OpenCode Free” sağlayıcı seçeneği farklı şeyler. Avalon'da bu sağlayıcı seçildiğinde istek yine Hermes üzerinden gidiyor; OpenCode uygulamasının reasoning yönetimi çalıştırılmıyor.

[OpenCode'un resmi model belgesi](https://opencode.ai/docs/models/#variants) seçenekleri modelin güncel katalog yeteneklerinden ürettiğini, seçilen varyantın sağlayıcı/model ayarlarından sonra uygulandığını ve effort ile token bütçesini ayırt ettiğini açıklıyor. [Güncel kaynak kodu](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/variant.ts) da bunu doğruluyor: `supports`/`resolve` model yeteneklerini ve protokolü kullanıyor; `openaiChat` effort iletirken bütçe destekleyen protokoller `budgets` üzerinden sayısal bütçe üretiyor.

Bu açıdan OpenCode'un tasarımını örnek almak yerinde. Avalon'un sabit seçenek listesi, eş anlamlı seviyeler ve Hermes ile genel ayar çakışması daha zayıf noktalar. Fakat aynı Evren endpoint'i, model, geçmiş ve token sınırlarıyla OpenCode uygulaması üzerinden karşılaştırmalı bir canlı koşu yapılmadı. Dolayısıyla “OpenCode aynı Evren modelini kesin daha derin düşündürüyor” veya “Evren low/xhigh değerini yok sayıyor” sonucu kanıtlanmış değil.

## 5. Diğer yollar ve düzeltme önceliği

`BrainModelService` seçimi Uygula sonrasında güvenli geçiş noktasında uyguluyor. Model/düşünme düzeyine göre ayrı sağlayıcı alias'ları üretiliyor; çalışan görevler başladıkları rotayı koruyor. Bu nedenle ayarı çalışan işin ortasında değiştirmek o işi yeniden ayarlamıyor.

`sidecar/brain_provider.py` içindeki Bağlantıyı dene, seçilmiş extra body ile basit 2+3 araç döngüsünü sınar. Gerçek sohbetin genel reasoning ayarını ve custom profilini aynı biçimde kullanmaz. Başarılı olması, bütün sohbet yolunun veya seviyeler arasındaki kalite farkının doğrulandığı anlamına gelmiyor.

Araştırma ayrıca `gptResearch.mjs` → `gpt_researcher_worker.py` yolundan ilerliyor. Seçilen düşünme gövdesi burada da gönderiliyor; işçi gelen üst düzey reasoning_effort'a öncelik verebiliyor. Tam GPT Researcher işi bu incelemede çalıştırılmadı; sohbet yolundaki none sonucunu araştırmaya otomatik genellemek doğru olmaz.

Önerilen sıra: önce genel ayar ile Açık/Kapalı/Varsayılan kontrollerinin çakışmasını gider; sonra desteklenen seviyeleri modele göre doğrula, eş anlamlı seçenekleri birleştir ve Qwen low/medium'u göster; ardından bağlantı testini gerçek sohbet yolu ve düşünme tokenı/kesilme nedeni ölçümüyle uyumlu hale getir.

İlgili mevcut model/oturum/gateway testleri yeniden çalıştırıldı: **57/57 geçti**. Testlerin başarılı olması yukarıdaki eksik senaryoların doğru çalıştığı anlamına gelmiyor.

## Tekrar üretme ve kanıtlar

`node validation/reasoning-review-2026-11-07/review.mjs` ağsız serileştirme incelemesini tekrarlar. `--live` eklemek mevcut Evren anahtarıyla sekiz sınırlı sağlayıcı isteği ve katalog/şema okuması yapar; model seçimini değiştirmez.

- `hermes-wire.json`: güncel genel ayar, yapılandırılmış Avalon sağlayıcı gövdeleri ve 186 nihai JSON kontrolü.
- `ui-controls.json`: bu çalışma kopyasının sunduğu bütün seçenekler.
- `provider-metadata.json`: 7 Kasım güncel Evren model yetenekleri ve OpenAPI istek şeması. MiMo bu katalog yanıtında görünmedi; güncel MiMo seviye davranışı sınanmadı.
- `conflicts.json`: çelişen kontrollerin üç canlı sağlayıcı yanıtı.
- `live-results.json`, `tasks.json`: iki görev, iki tekrar ve low/xhigh ölçümleri; cevapların bağımsız doğrulaması.
- `capture.py`, `review.mjs`: inceleme kodu; `opencode-variant.ts`: incelenen upstream kaynak anlık kopyası.

Üretim kodundaki ana noktalar: `electron/brainReasoning.mjs`, `electron/brainModels.mjs`, `electron/hermesInteractiveTransport.mjs`, `sidecar/brain_provider.py`, `src/components/BrainModelPanel.tsx`, `electron/gptResearch.mjs`, `sidecar/gpt_researcher_worker.py`; kurulu Hermes'te `plugins/model-providers/custom/__init__.py`, `agent/transports/chat_completions.py`, `hermes_cli/runtime_provider_custom.py`.
