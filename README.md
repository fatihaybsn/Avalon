# Avalon (JARVIS)

Windows 11'de doğrudan çalışan, OpenClaw merkezli kişisel asistan projesi.
Tek merkez **OpenClaw Gateway**, konuşma tarafı **Gemini Live**, ağır görev
modeli **Space Bunny Free**'dir. Mevcut durum: **02. aşama tamamlandı**
(Gateway + model temeli); ses, arayüz ve işçiler sonraki adımlarda.

Ayrıntılı mimari: `docs/KESIN_MIMARI.md` · Aşama durumu: `docs/GELISTIRME_DURUMU.md`

## Gereksinimler

- Windows 11, PowerShell 7
- Node.js `24.16+` (doğrulanan: `v24.20.0`; 22/23/25 desteklenmez)
- npm `11.19.0`, Git
- Hesaplar: OpenCode (görev modeli), Google AI Studio (konuşma, 11. adıma kadar gerekmez)

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

```powershell
setx OPENCODE_API_KEY "anahtariniz"
setx GEMINI_API_KEY "anahtariniz"   # opsiyonel, 11. adıma kadar gerekmez
```

### 2) Gateway token'ı üretin

```powershell
$token = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
setx JARVIS_GATEWAY_TOKEN $token
```

### 3) Yeni PowerShell açın (setx sonrası şart) ve doğrulayın

```powershell
cd C:\yol\Avalon
.\scripts\jarvis-status.ps1
```

Üç anahtar da `PRESENT`, port `CLOSED` görünmeli. Değerler ekrana yazılmaz.

### 4) OpenCode Zen eklentisini kurun (bir kerelik)

Stok pakette Zen sağlayıcısı yoktur (`opencode-go` vardır); resmi Zen eklentisi
ayrı kurulur:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis plugins install clawhub:@openclaw/opencode-provider
```

### 5) Gateway'i başlatın

```powershell
.\scripts\jarvis-gateway.ps1
```

Bu pencere açık kalır; ilk çalışta profil ayarını şablondan kopyalar
(`%USERPROFILE%\.openclaw-jarvis`), mevcudu ezmez. Port doluysa yabancı
süreci kapatmaz, hatayla durur. Kapatmak için `Ctrl+C`.

İkinci pencerede sağlık kontrolü:

```powershell
.\node_modules\.bin\openclaw.cmd --profile jarvis gateway status
.\node_modules\.bin\openclaw.cmd --profile jarvis gateway health
.\node_modules\.bin\openclaw.cmd --profile jarvis models list --provider opencode --refresh
```

## Bilinen önemli davranış: ücretsiz modeller ve 403

`space-bunny-free` gibi ücretsiz katman modelleri OpenClaw içinden çağrıda
`403 FreeTierError` verir ("yalnız OpenCode istemcisinden kullanılabilir").
Bu anahtar bozukluğu değildir. Aynı model OpenCode uygulamasının kendisi
üzerinden çalışır (doğrulandı). Bu yüzden birincil model kayıtta
`opencode/space-bunny-free` durur, yürütmesi 10. adımda OpenCode işçisine
bağlanacak; sessizce ücretli modele geçilmez.

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

- Sırlar (`OPENCODE_API_KEY`, `GEMINI_API_KEY`, `JARVIS_GATEWAY_TOKEN`) yalnız
  kullanıcı ortam değişkenlerinde durur; repoda, prompt'ta, log'da olmaz.
  Şablon: `config/jarvis.env.example`.
- Eski FURY klasörü proje dışındadır; state/auth Sohbet içe aktarılmaz.

## Proje yapısı

```
config/    jarvis.openclaw.json (Gateway+model+Talk şablonu), jarvis.env.example
scripts/   jarvis-gateway.ps1 (başlatma), jarvis-status.ps1 (durum okuma)
docs/      KESIN_MIMARI.md, GELISTIRME_DURUMU.md, gelistirme plani, kaynak proje kaydi
```
