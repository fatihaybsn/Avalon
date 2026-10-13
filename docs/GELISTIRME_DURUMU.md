# JARVIS — geliştirme durumu

Son güncelleme: 13 Ekim 2026. Yetkili karar kaynağı [kaynak proje kaydı](source/JARVIS_Proje_Kaydi.md), kısa seçilmiş mimari [KESIN_MIMARI.md](KESIN_MIMARI.md), uygulama sırası ise bu klasördeki tek [geliştirme planıdır](JARVIS_Gelistirme_Plani_ve_Codex_Promptlari.md). Son 2/3/4 düzeltmeleri kapsamdadır: Gemini'nin araştırma/eylem sınırı, host olaylarından görev durumu kaydı, ses kısayolu/isteğe bağlı boşta kapanma/ses kapalıyken bildirim ve kullanıcı isteğiyle tek kare ekran açıklaması.

| Adım | İş | Durum | Gerçek engel / ön koşul |
|---|---|---|---|
| 01 | Temiz proje ve kısa kesin mimari | **Tamamlandı** | Kaynaklar taşındı, yerel depo ve temel metadata hazır. |
| 02 | Yeni OpenClaw merkezi ve model bağlantıları | **Tamamlandı** | Kapanış kararı (A): birincil model `opencode/space-bunny-free` aynen kalır; yürütme 10. adımda OpenCode istemcisi (worker) üzerinden bağlanır. OpenClaw sağlayıcı yolundaki `403` bilinen politika engelidir, arıza değildir. |
| 03 | İzin sınırları ve salt okunur araştırma | Başlamadı | 02'de seçilecek gerçek OpenClaw sürümü ve bağlantılar gerekli. |
| 04 | Sade masaüstü ve sohbet arayüzü | Başlamadı | 02–03 gerekli; Electron arayüzü oluşturulmadı. |
| 05 | Ortak yerel hafıza | Başlamadı | 02–04 gerekli; EmbeddingGemma ve Memory Core davranışı kurulup doğrulanmadı. |
| 06 | Görev kaydı, canlı olaylar ve paralellik | Başlamadı | 03–05 gerekli; host olay/kimlik eşlemesi uygulanmadı. |
| 07 | Hızlı temel Windows ve tarayıcı işlemleri | Başlamadı | 03 ve 06 gerekli; yeni Windows yardımcısı veya tarayıcı bağlantısı yok. |
| 08 | Windows GUI ve sınırlı tamamlayıcı MCP | Başlamadı | 06–07 gerekli; CUA/Windows-MCP bağlantısı ve araç filtresi yok. |
| 09 | Codex dış işçisi | Başlamadı | 03 ve 06–08 gerekli; Codex hesabı/CLI bağlantısı doğrulanmadı. |
| 10 | OpenCode işçisi ve ihtiyaca göre Vibe Coding | Başlamadı | 09 gerekli; OpenCode bağlantısı doğrulanmadı. |
| 11 | Hazır Talk/Google Live ve bağımsız ses | Başlamadı | 04 ve 06 gerekli; Google hesabı, provider-direct oturumu ve gerçek cihaz sesi doğrulanmadı. |
| 12 | Gemini dar araçları, canlı bulgular ve tek kare ekran | Başlamadı | 05–11 gerekli; JARVIS görev/bağlam bağlantısı yok. |
| 13 | Sesli onay ve kritik dış işlemler | Başlamadı | 03 ve 09–12 gerekli; mevcut OpenClaw onayını yetkili istemci sesine bağlayan uygulama yok. |
| 14 | Seçici unutma ve ham kayıt ömrü | Başlamadı | 05–06 ve 09–13 gerekli; 30 gün/60 saniye bakım ve seçici türev temizliği uygulanmadı. |
| 15 | Otomasyon, bildirim ve telefonda aynı JARVIS | Başlamadı | 11–14 gerekli; zamanlayıcı, bildirim ve Tailscale telefon bağlantısı kurulmadı. |
| 16 | Windows paketi ve günlük çalışma düzeni | Başlamadı | 01–15 gerekli; çalıştırılabilir uygulama henüz yok. |

## Seçilen sürüm ve bağlantı notları

- OpenClaw `2026.10.2` projeye sabitlendi (`dependencies`, `package-lock.json`, bütünlük `sha512:FuLLF+WI…`; npm `latest` etiketi 13 Ekim 2026'da doğrulandı). FURY'nin `2026.9.9` sabiti devralınmadı. Kurulum proje-yereldir; global OpenClaw kurulumu yoktu, üstüne yazılmadı.
- Node gereksinimi (resmî): `>=24.16.0 <25 || >=26.1.0` (Node 26 önerilir; 22/23/25 desteklenmez). Bu ortam: Node `v24.20.0` + npm `11.19.0` + PowerShell `7.6.6` — uygun. Proje `engines` buna çekildi. PowerShell tarafı: native Windows CLI/Gateway + Scheduled Task yolu (detay `docs.openclaw.ai/platforms/windows`).
- Kurulum notu: npm 11.19 ilkesi 4 geçişli paketin kurulum betiğini engelledi (`@google/genai`, `esbuild`, `koffi`, `protobufjs`); sessizce onaylanmadı. İlk kurulum zaman aşımında 3 paket yarım kaldı (`@openclaw/ai`, `fs-safe` + win32), silinip `npm install` ile yeniden çıkarıldı; CLI doğrulandı (`--version`, `config validate/get`).
- Profil: `--profile jarvis` → `%USERPROFILE%\.openclaw-jarvis`, workspace ayrı (`~/.openclaw-jarvis/workspace`). Gateway yalnız loopback (`bind: loopback`, port `18789`; uygulama günü port kapalıydı). Token `${JARVIS_GATEWAY_TOKEN}` ile dosyadışı; sırlar `config/jarvis.env.example` şablonundaki `%USERPROFILE%\.openclaw-jarvis\.env` yolunda, repoda yok. FURY state/auth/sohbet import edilmedi. Başlatma: `scripts/jarvis-gateway.ps1` (port doluysa kapatmadan hata verir — dummy dinleyiciyle test edildi); durum: `scripts/jarvis-status.ps1` (anahtar yokken `MISSING` gösterir, bağlı göstermez — çalıştırıldı). Şablon `openclaw config validate` ile canlı şemadan geçti; `config get` üç kritik yolu doğruladı. Çalışan Gateway'e karşı `gateway status` (reachable, CLI/Gateway `2026.10.2`), `gateway health` (`OK`), `models list --provider opencode --refresh` (7 hesap modeli) ve `infer model run` (ücretsizlerde belgelenen `403`, aşağıdaki satır) denendi. İlk `doctor --lint`'teki 3 uyarı anahtarsız duruma aitti; sağlayıcı uyarısı Zen eklentisi kurulunca kapandı; `--fix` uygulanmadı.
- Görev modeli: `agents.defaults.model.primary = "opencode/space-bunny-free"`, `fallbacks: []`, `utilityModel: ""` (başlık işleri de ana modele gider, sessiz yedek yok), `modelSelectionScope: session` (yol değiştirilebilir). Katalog (resmî): `space-bunny-free`, `https://opencode.ai/inference/v1/chat/completions`, araç çağrısı var, ek dosya var, akıl yürütme `low/medium/high/xhigh/max`, giriş metin+görsel+video / çıkış metin, bağlam ~1M (giriş/çıkış 524.288), ücretsiz, zero-retention. `403 FreeTierError` = model kısıtı (anahtar bozukluğu değil), `402` = kredi eksikliği. Erişim `OPENCODE_API_KEY` ile; `models list --provider opencode --refresh` hesap kataloğunu veriyor (7 model: opus-5, gpt-5.6-sol, gpt-5-nano, gemini-3.6-flash, minimax-m3, kimi-k3, big-pickle) ama `space-bunny-free` listede yok. Doğrudan deneme: `space-bunny-free` ve `big-pickle` → `403 "OpenCode's free tier can only be used from within OpenCode"` (belgelenen FreeTierError; anahtar bozukluğu değil). Ücretli Zen modelleri denenmedi (kredi harcaması olur). Canlı kanıt OpenCode istemcisinden: `opencode v2.0.27` aynı hesapla `space-bunny-free`'den doğru cevap aldı ("Dört"). Not: `2026.10.2` stokta Zen eklentisi yoktu (`opencode-go` vardı); resmi `@openclaw/opencode-provider v2026.10.2` ClawHub'dan jarvis profiline kuruldu, Gateway yeniden başlatmadan devraldı (generation 3). FURY kodu taşınmadı; yalnız `scripts/opencode-run.ps1:54` satırındaki çağrı biçimi salt-okunur referans alındı.
- Talk (config, ses 11'e kadar kapalı): `realtime.provider google`, `transport provider-websocket`, `brain agent-consult`, `consultRouting provider-direct` (normal konuşma `force-agent-consult`'a zorlanmaz), model `gemini-3.8-live`. Standart 3.8'e `thinking_config`/eski `affective-dialog`/`proactive_audio=false` gönderilmez (kurulu sürüm 3.8'e thinking göndermez). Mikrofon/ses motoru yazılmadı, hesap değiştirilmedi.
- Sürüm sözleşmesi (kurulu `2026.10.2` exports + resmî docs + çalışan Gateway'e karşı doğrulanan `status/health/models.list`): dış agent/session için `sessions_list/history/send` + görünürlük (`tools.sessions.visibility`), `openclaw sessions/cron/hooks` CLI; plugin araç/izin `definePluginEntry` + `api.registerTool` (+`contracts.tools`, `workspaceAccess`, `tools.allow`, `before_tool_call`/`requireApproval` 03'te); client-owned Talk `talk.client.create` (+`talk.client.toolCall` ilk araç `openclaw_agent_consult`, `talk.client.steer`) ve `talk.catalog`; dar Live araç uzatması 12'de; yerel memory builtin SQLite (`agents/<id>/agent/openclaw-agent.sqlite`, `memory.search`, `local` managed llama.cpp) 05'te; kayıt bakımı `session.maintenance` (varsayılan `pruneAfter 30d` vb.) 14'te. Doğrulanmamış noktaya sahte endpoint yazılmadı; bu eşleme yeni ürün/model araştırması değildir.

## FURY seçici aktarım haritası

01'de FURY'den **hiçbir çalıştırılabilir işlev taşınmadı**. Aşağıdakiler yalnız plandaki olası uyarlanmış kaynak/hedeflerdir:

| FURY kaynak | Yeni hedef / adım | Sınır |
|---|---|---|
| `config/windows-app.ps1` | `native/windows/` · 07 | Uygulama çözümleme ve güvenilir pencere kimliği parçaları. |
| `voice/quick_actions.py` | `native/windows/` · 07 | Ses motorundan bağımsız dar uygulama/pencere, ses, medya ve güç işlevleri. |
| `config/recycle.ps1` | `native/windows/` · 07 | Korunan yol/bağlantı kontrolleriyle küçük Çöp Kutusu işlemi. |
| `scripts/codex-profile.ps1` | `scripts/` · 09 | FURY yolu/sır çıktısı olmadan kullanıcı kontrollü Codex profil ve oturum işlemleri. |
| `scripts/runtime.ps1` | `scripts/` · 16 | Gerekirse yalnız PID, başlangıç zamanı ve süreç sahipliği. |
| `scripts/codex-app-server.mjs` | Kopyalanmayacak · 09 | Yalnız teknik referans; güncel bağlantı API'si yeniden doğrulanır. |

Eski FURY `AGENTS.md`, ses kilidi/taşıma kodu, göç/patch paketleri, hesaplar, state, `.git` ve eski kabul kayıtları aktarılmaz. Kaynak dizin `C:\Users\Fatih\Desktop\FURY` proje dışında kalır.
