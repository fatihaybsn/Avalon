# 11–12 uygulama, düzeltme ve kurulum notları

14 Ekim 2026. Bu kayıt son ses/Talk çalışmasını ve 12'nin bağlantı düzeltmelerini
özetler. Gerçek kabul durumu için [geliştirme durumu](GELISTIRME_DURUMU.md),
kurulum sırası için [README](../README.md) esastır.

## Eklenen ve giderilen noktalar

- Hazır Google Talk medya yolu bağımsız sandboxed Electron penceresine bağlandı.
  Görünür arayüzün reload/tepsi ömrü ses sahibini kapatmaz. Mikrofon ve oynatma
  yerel kullanıcı eylemine bağlıdır; uzak olaylar sesi açamaz.
- Eksik custom tool-declaration/dispatch bağlantısı sabit native Talk üzerinde
  dar uzatmayla tamamlandı. Aynı authenticated Gateway router, gerçek kişi/cihaz/
  session authority kullanılır. Model genel tool proxy veya resolver almaz.
- Hafıza/durum/çıktı ve küçük Windows işleri için gereksiz ağır model turu kaldırıldı.
  Bu yapısal çağrı azaltımıdır; ölçülmüş gecikme veya Gateway başlangıç hızlanması
  iddiası değildir. Reader yalnız explicit public query ve mevcut Advanced yoludur.
- Kaynaklı reader sonucu mevcut WorkLedger/journal'a bağlandı. Aynı asıl çıktıyı
  okumak yeni araştırma başlatmaz; dış bulgu kullanıcı tercihine/onayına dönüşmez.
- Açık non-blocking consult ara sonucuyla kapanmış call sonrası client-content
  ayrıldı. Kapanmış callId yeniden kullanılmaz; güncelleme aktif konuşmayı
  `turnComplete:true` ile kesmez. Büyük JSON/metin ortasından kesilmez; eksik
  ayrıntı açık işaretlenir ve asıl output yolu gösterilir.
- Bağımsız iş yeni native session'da hazırlanır; voice/run kaydı gerçek dispatch'ten
  önce bağlanır. Yeni koşul doğru görev/revizyona gider. Provider çağrı iptali,
  kabul edilmiş eski işleri supersede etmez; görüşme kapanışının iptali yalnız
  o görüşmenin başlattığı işlere aittir. Belirsiz sonuç otomatik tekrar edilmez.
- Kullanıcı isteğine bağlı tek Electron karesi Google Live'a aktarılır; kamera
  describe_view desktop capture yerine kullanılmaz. Ekran verisi yetki vermez.
- Ses kapalıyken native Windows notification ve ilgili işe/çıktıya açılma eklendi.
  Bildirim engelliyse sonuç kayıtta kalır; bildirim mikrofon veya onay açmaz.

## Hızlı temizlik ve taşınabilirlik

Geçici `tmp/talk-original.mjs` ve `tmp/stage11-contract` içindeki sekiz kaynak
kopyası kaldırıldı; gerekli upstream kaynaklar `vendor/talk/sources` altında
provenance ile zaten korunur. Üretilen `vendor/talk/runtime.js` Git dışında tutulur;
masaüstü build/dev veya `npm run test:live` yeniden üretir. Regresyon testleri,
kullanılan yardımcılar ve kaynak karar tarihçesi kalıntı olarak silinmedi.
`.gitattributes` sabit vendor kaynaklarını Windows checkout'unda da LF tutar;
Git'in CRLF dönüşümü SHA256/provenance kontrolünü veya Talk uzatma eşleşmesini bozmaz.
Başka eski geçici Gateway/node profilleri bu hızlı kontrolde aktif/pasif oldukları
kesinleştirilmediği için topluca silinmedi; proje dışındaki kurulumlara dokunulmadı.

Native Talk kaynak manifesti yalnız sabit sürüm/dosya/orijinal SHA256 içerir.
Bilgisayara özel mutlak yol, patch çiftleri ve uzatılmış SHA256 artık Git dışındaki
`node_modules/openclaw/dist/jarvis-talk-extension.json` makbuzundadır. Yeni clone'da
`node scripts/extend-talk.mjs` kendi yoluyla bu makbuzu üretir; `npm ci` sonrasında
aynı komut yeniden uygulanır. Kurulu dosya sürümü/hash'i farklıysa işlem durur.
README'de bu adım Gateway başlangıcından önce 4g'ye; ses/araç kullanımı ve
`operator.talk` grant ihtiyacı masaüstü bağlantısından sonra 7a'ya eklendi.

## Doğrulama ve kalan engel

12 için 21 farklı ilgili host/Codex/Talk testi, root/desktop tip kontrolü ve
masaüstü derlemesi geçti. Bu testler sentetik cihaz/socket ve native kayıt
fixture'larıdır. Temizlikte yalnız değişen kurulum makbuzunun ilgili patch testi
yeniden çalıştırılır; bütün proje veya önceki Gateway/GUI/model testleri tekrarlanmaz.

Bilinen Gateway health/RPC yanıt vermeme sorunu bu çalışmada çözülmedi;
Gateway restart, genel onarım veya canlı model çağrısı yapılmadı. Google token
kataloğu/cihaz sesi, gerçek tek kare ve Windows notification/click/engellenme
kabulü bekler. Başlangıç hızı veya cihaz sorunsuzluğu garantisi verilmez.
13 sesli onay, 15 telefon ve 16 tam dağıtım başlatılmadı.
