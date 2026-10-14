param()
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
try {
    $p = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($p.kind -ne 'ocr' -or @($p.PSObject.Properties.Name | Where-Object { $_ -notin @('path','kind') }).Count) { throw 'Exact OCR request required' }
    $file = Get-Item -LiteralPath $p.path -Force
    if ($file.PSIsContainer -or $file.Length -gt 25MB -or $file.Extension.ToLowerInvariant() -notin @('.png','.jpg','.jpeg','.bmp','.tif','.tiff')) { throw 'OCR supports bounded PNG/JPEG/BMP/TIFF images only; rasterize PDF through an explicitly selected adapter' }
    if ($file.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked OCR input refused' }
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType=WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType=WindowsRuntime]
    $null = [Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType=WindowsRuntime]
    $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
    function Await-WinRT($operation, [Type]$type) {
        $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
        if (-not $task.Wait(20000)) { throw 'OCR timeout; no automatic replay' }
        return $task.Result
    }
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
    if ($null -eq $engine) { throw 'OCR_BLOCKED: no installed Windows OCR language' }
    $storage = Await-WinRT ([Windows.Storage.StorageFile]::GetFileFromPathAsync($file.FullName)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRT ($storage.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
        $decoder = Await-WinRT ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
        if ($decoder.PixelWidth -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or $decoder.PixelHeight -gt [Windows.Media.Ocr.OcrEngine]::MaxImageDimension -or [long]$decoder.PixelWidth * [long]$decoder.PixelHeight -gt 16000000) { throw 'OCR image dimensions exceed inspection budget' }
        $bitmap = Await-WinRT ($decoder.GetSoftwareBitmapAsync([Windows.Graphics.Imaging.BitmapPixelFormat]::Bgra8, [Windows.Graphics.Imaging.BitmapAlphaMode]::Premultiplied)) ([Windows.Graphics.Imaging.SoftwareBitmap])
        try {
            $result = Await-WinRT ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
            $text = [string]$result.Text
            @{confirmed=$true; ocrPerformed=$true; engine='Windows.Media.Ocr'; language=$engine.RecognizerLanguage.LanguageTag; frames=$decoder.FrameCount; text=$text.Substring(0,[Math]::Min($text.Length,20000)); partial=($text.Length -gt 20000 -or $decoder.FrameCount -gt 1); trust='untrusted-document-data'; authority='none'} | ConvertTo-Json -Compress
        } finally { if ($bitmap) { $bitmap.Dispose() } }
    } finally { if ($stream) { $stream.Dispose() } }
} catch {
    @{confirmed=$false; error=$_.Exception.Message.Substring(0,[Math]::Min($_.Exception.Message.Length,512))} | ConvertTo-Json -Compress
    exit 1
}
