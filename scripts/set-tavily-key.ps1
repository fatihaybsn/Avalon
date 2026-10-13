[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
# The key is typed/pasted at a masked prompt, never a command argument/history.
$secretInput = Read-Host 'Tavily ücretsiz hesap API anahtarı (gizli giriş)' -AsSecureString
$secretPtr = [IntPtr]::Zero
$plainKey = $null
try {
  $secretPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secretInput)
  $plainKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPtr)
  if ([string]::IsNullOrWhiteSpace($plainKey) -or -not $plainKey.StartsWith('tvly-') -or $plainKey -match '\s') { throw 'Anahtar biçimi geçersiz; hiçbir değer kaydedilmedi.' }
  [Environment]::SetEnvironmentVariable('TAVILY_API_KEY', $plainKey, 'User')
  $env:TAVILY_API_KEY = $plainKey
  Write-Output 'TAVILY_API_KEY kullanıcı ortamına ve bu terminale kaydedildi; anahtar yazdırılmadı.'
  Write-Output 'Önceden açık uygulamalar için yeniden başlatma gerekir. Tavily hesabında ücretsiz planı koruyun; ücretli plan veya otomatik ödeme açmayın.'
} finally {
  if ($secretPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPtr) }
  $plainKey = $null
  $secretInput.Dispose()
}
