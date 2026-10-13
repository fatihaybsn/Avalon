# Avalon (JARVIS)

Windows 11'de doğrudan çalışan, OpenClaw merkezli kişisel asistan projesi.
Tek merkez **OpenClaw Gateway**, konuşma tarafı **Gemini Live**, ağır görev
modeli **Space Bunny Free**'dir. Mevcut durum: **03. aşama tamamlandı**
(Gateway/model temeli, görev izinleri, salt okunur araştırma ve native onay bağlantısı).
Masaüstü arayüzü, işçiler ve ses sonraki adımlardadır; bu sürüm geliştirme temelidir.

Ayrıntılı mimari: `docs/KESIN_MIMARI.md` · Aşama durumu: `docs/GELISTIRME_DURUMU.md`

## Gereksinimler

- Windows 11, PowerShell 7
- Node.js `>=24.16.0 <25 || >=26.1.0` (doğrulanan: `v24.20.0`; 22/23/25 ve 26.0 desteklenmez)
- npm `11.19.0`, Git
- Hesaplar: OpenCode (görev modeli), Tavily ücretsiz hesap (araştırma), Google AI Studio (konuşma, 11. adıma kadar gerekmez)

## Kurulum (sıfırdan)

```powershell
git clone https://github.com/fatihaybsn/Avalon.git
cd Avalon
npm ci
```

`npm ci` proje-yerel OpenClaw `2026.10.2` sürümünü kurar (bütünlük kilitli).
Global kurulum yapılmaz, mevcut kurulumların üstüne yazılmaz.

### 1) API anahtarları (kendi bilgisayarınızda, repoya girmez)

| Anahtar | Nereden | Ne için |
|---|---|---|
| `OPENCODE_API_KEY` | [opencode.ai/auth](https://opencode.ai/auth) | Görev modeli kataloğu |
| `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | 11. adımdaki ses (şimdilik opsiyonel) |
| `TAVILY_API_KEY` | [app.tavily.com](https://app.tavily.com/) | Salt okunur Advanced araştırma; ücretsiz plan |

OpenCode anahtarını komut geçmişine yazmadan kaydetmek için PowerShell 7'de:

```powershell
$secretInput = Read-Host 'OPENCODE_API_KEY' -AsSecureString
$secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretInput)
try {
  $secretValue = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
  [Environment]::SetEnvironmentVariable('OPENCODE_API_KEY', $secretValue, 'User')
  $env:OPENCODE_API_KEY = $secretValue
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr)
  $secretInput.Dispose()
  $secretValue = $null
}
```

Google anahtarı gerektiğinde aynı blokta `OPENCODE_API_KEY` adını tüm yerlerde
`GEMINI_API_KEY` ile değiştirin. Anahtarların değerlerini README'ye, sohbete veya
repo dosyalarına yazmayın. Tavily için hazır maskeli giriş yardımcısını kullanın:

```powershell
.\scripts\set-tavily-key.ps1
```

Tavily panelinde ücretsiz planı koruyun; ücretli abonelik, otomatik ödeme veya
Pay-as-you-go açmayın. Aramalar daima **Advanced** kullanır; Advanced isteği
2 kredidir. Hesabın planını ve kalan kotasını panelden kontrol edin.

### 2) Gateway token'ı üretin

```powershell
$token = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
[Environment]::SetEnvironmentVariable('JARVIS_GATEWAY_TOKEN', $token, 'User')
$env:JARVIS_GATEWAY_TOKEN = $token
$token = $null
```

### 3) Yeni PowerShell açın ve doğrulayın

```powershell
cd C:\yol\Avalon
.\scripts\jarvis-status.ps1
```

Anahtar satırları kullanıcı kaydı, bu süreç ve profil `.env` varlığını ayrı gösterir.
Kullanıcı ortamına saklandıysa hem kullanıcı kaydı hem bu süreç `PRESENT` olmalı;
yalnız kullanıcı kaydında varsa terminali/onu başlatan uygulamayı yeniden açın.
Alternatif saklama yolu `%USERPROFILE%\.openclaw-jarvis\.env` dosyasıdır.
Google anahtarı 11. adıma kadar opsiyoneldir. Gerçek profil varsa ayarlar
oradan okunur; yoksa şablon açıkça `TEMPLATE ONLY` olarak gösterilir.
`gateway_health: OK` yalnız kimliği doğrulanan Gateway için gösterilir;
ilk başlatma öncesinde `STOPPED` beklenir. Değerler ekrana yazılmaz.

### 4) Profili hazırlayın ve resmî eklentileri kurun (bir kerelik)

Önce bu bilgisayara ait yolları kullanarak ayrı profili oluşturun. Mevcut
profil varsa korunur; başka bilgisayarın state, kimlik veya anahtarını kopyalamayın.

```powershell
node scripts/init-jarvis-profile.mjs
.\node_modules\.bin\openclaw.cmd --profile jarvis plugins install clawhub:@openclaw/opencode-provider
.\node_modules\.bin\openclaw.cmd --profile jarvis plugins install @openclaw/tavily-plugin@2026.10.2 --pin
node scripts/jarvis-policy-config.mjs
node scripts/jarvis-policy-config.mjs --check "$env:USERPROFILE\.openclaw-jarvis\openclaw.json"
```

Stok pakette Zen sağlayıcısı yoktur (`opencode-go` vardır); resmî Zen eklentisi
bu yüzden ayrıca kurulur. Tavily paketi resmî OpenClaw 2026.10.2 desteğidir;
`npm ci` bu profil eklentilerini kurmaz. Paketler mevcut OpenClaw kurulum yolunu
kullanır; ayrı arama sunucusu kurulmaz. Kurulum veya erişim hatasında durun,
başka paket/sürüm/ücretli sağlayıcıya sessiz geçmeyin.

Politika betiği ilk değişiklik öncesindeki profili repo dışında
`openclaw.before-stage03.json` olarak yedekler. Model/Talk/auth ayarlarını korur;
03'ün araç, rol ve hook sınırlarını uygular. Profil önceki aşamadan geliyorsa
yine eklentileri kurup bu politika komutlarını çalıştırın. Projeyi başka klasöre
taşıdığınızda politika betiğini yeniden çalıştırın; plugin yolu yeni konuma bağlanır.

### 5) Gateway'i başlatın

```powershell
.\scripts\jarvis-gateway.ps1
```

Bu pencere açık kalır. Profil `%USERPROFILE%\.openclaw-jarvis` içindedir;
başlangıç mevcut ayarları ezmez. Önce 4. adımı tamamlayın; başlangıç 03
politikasını ve token kimliğini doğrulayamazsa durur. Port doluysa yabancı
süreci kapatmaz, hatayla durur. Kapatmak için `Ctrl+C`.

İkinci pencerede sağlık kontrolü:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis gateway status
.\node_modules\.bin\openclaw.cmd --profile jarvis gateway health
.\node_modules\.bin\openclaw.cmd --profile jarvis models list --provider opencode --refresh
```

### 6) Araştırma erişimini ve izin temelini doğrulayın

Tavily anahtarını tanımladığınız yeni terminalde:

```powershell
node scripts/check-tavily-access.mjs
npm run check
npm test
npm run test:gateway
```

Hesap kontrolü resmî araçla **tek gerçek Advanced arama** yapar ve kredi tüketir;
anahtar veya ham sağlayıcı yanıtını yazdırmaz. Başarıda `ok: true`,
`searchDepth: advanced` beklenir; bu sonuç ücretsiz planı veya kalan kotayı
kanıtlamaz. Hata durumunda eksik anahtar, erişim, kota ya da ağ kategorisi
bildirilir; otomatik tekrar veya alternatif sağlayıcı yoktur.

`npm test` 16 sınır testini çalıştırır; gerçek Tavily hesabına çağrı yapmaz.
Gateway testi ayrı geçici profilde gerçek onay kayıtlarını ve dosya etkisini
kontrol eder: deny/allow-always yazmaz, allow-once sabit parametrelerle yazar.
Test kendi Gateway sürecini ve başarılı profilini kapatıp temizler; ana
`jarvis` profiline test resolver'ı eklemez. Tavily'nin resmî paketi önce kurulmuş olmalıdır.

Araştırma yalnız `tavily_search` ve `web_fetch` kullanır. Host aramayı
Advanced, en çok 5 sonuç, general ve ek cevap kapalı olacak şekilde sabitler.
Genel `web_search`, `tavily_extract`, Firecrawl, browser, shell, yazma,
mesaj, otomasyon ve başka ajanla erişim genişletme bu rolde kapalıdır.
URL/query ve özel ağ sınırları host'tadır; fetch yönlendirmeleri kapalıdır.
Kota/erişim hatası aynı araştırma run'ını durdurur. Yeni kullanıcı isteği
kendi kapsamıyla değerlendirilir. [Tavily ayrıntıları](docs/TAVILY_KURULUM.md).

## Bilinen önemli davranış: ücretsiz modeller ve 403

`space-bunny-free` gibi ücretsiz katman modelleri OpenClaw içinden çağrıda
`403 FreeTierError` verir ("yalnız OpenCode istemcisinden kullanılabilir").
Bu anahtar bozukluğu değildir. Aynı model OpenCode uygulamasının kendisi
üzerinden çalışır (doğrulandı). Bu yüzden birincil model kayıtta
`opencode/space-bunny-free` durur, yürütmesi 10. adımda OpenCode işçisine
bağlanacak; sessizce ücretli modele geçilmez.

**13 Ekim 2026 kullanıcı teyidi:** OpenCode istemcisi/işçisi üzerinden kullanım bilinçli ve onaylı bağlantı tercihidir. Bu tercih başlangıçtaki doğrudan HTTP hedefini günceller. Sonraki ajanlar 403'ü kurulum arızası veya mimari ihlali sayıp modeli değiştirmemeli, ücretli yedek açmamalı veya çalışan işçi yolunu yeniden yazmamalıdır. Ret sağlayıcının ücretsiz katman kısıtıdır; Gateway araç izni değildir. OpenClaw tek görev/izin/hafıza merkezi olarak kalır; aşamaların gerçek entegrasyon durumu `docs/GELISTIRME_DURUMU.md` içindedir.

## Başka bir sağlayıcı ekleme (ör. OpenAI)

Anahtarınızı OpenAI'dan alıp profilde saklayın (etkileşimli yardımcı sorar):

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis models auth login --provider openai
```

Sonra birincil modeli değiştirin (yol değiştirilebilir; yedek zinciri açılmadıkça
sessiz geçiş olmaz):

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis config set agents.defaults.model.primary "openai/gpt-5-mini"
```

> Not: bu iki komut bu depoda denenmedi; genel OpenClaw komutlarıdır.
> Geçerli model adını `models list --provider openai --refresh` ile görün.

## Günlük kullanım

- Durum: `.\scripts\jarvis-status.ps1`
- Başlat: `.\scripts\jarvis-gateway.ps1` · Durdur: `Ctrl+C`
- Arayüz (Gateway çalışırken): `http://127.0.0.1:18789/`
- Tanı: `.\node_modules\.bin\openclaw.cmd --profile jarvis doctor --lint`

## Güvenlik

- Sırlar (`OPENCODE_API_KEY`, `GEMINI_API_KEY`, `TAVILY_API_KEY`, `JARVIS_GATEWAY_TOKEN`) yalnız
  kullanıcı ortam değişkenlerinde veya repo dışı profil `.env` dosyasında durur; repoda, prompt'ta, log'da olmaz.
  Şablon: `config/jarvis.env.example`.
- Olağan proje yazmaları görev kapsamıyla yürür; başka hedef için ek izin gerekir.
  Kritik onay yalnız allow-once/deny ve sabit parametrelerle mevcut OpenClaw
  kayıtlarından geçer. Modele genel resolver/config aracı verilmez. Shell, UAC,
  genel kalıcı silme ve force-kill kapalıdır; satın alma/ödeme henüz açılmadı.
- Araştırmaya USER/MEMORY/sohbet/anahtar/proje içeriği eklenmez. Web içeriği ve
  okuyucu özeti veri olarak etiketlenir; onay veya kullanıcı emri sayılmaz.
- Eski FURY klasörü proje dışındadır; state/auth Sohbet içe aktarılmaz.

## Proje yapısı

03 izin eklentisi ve profiller uygulanmıştır. Sınırlar, gerçek test kanıtı ve kapalı bağlantılar: [03 yetki sınırları](docs/03_YETKI_SINIRLARI.md). Kontroller: `npm run check`, `npm test`, `npm run test:gateway`. Resmî Tavily Advanced + web_fetch yapılandırıldı; gerçek Advanced API erişimi doğrulandı ([güvenli kurulum](docs/TAVILY_KURULUM.md)). Genel web_search kapalıdır; sesli onay 13'e aittir.

```
config/    jarvis.openclaw.json (Gateway+model+Talk şablonu), jarvis.env.example
scripts/   profil hazırlama, politika uygulama, maskeli Tavily anahtarı, erişim kontrolü, başlatma/durum
plugins/   jarvis (public SDK görev kapsamı/hook, native araştırma ve onay sınırı)
tests/     politika/okuyucu ve yalnız geçici Gateway'e yüklenen onay fixture
docs/      KESIN_MIMARI.md, GELISTIRME_DURUMU.md, gelistirme plani, kaynak proje kaydi
```
