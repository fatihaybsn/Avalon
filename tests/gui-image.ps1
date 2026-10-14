param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$Code)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$bitmap=[Drawing.Bitmap]::new(480,180)
$graphics=[Drawing.Graphics]::FromImage($bitmap)
$font=[Drawing.Font]::new('Arial',56,[Drawing.FontStyle]::Bold)
try {
 $graphics.Clear([Drawing.Color]::White)
 $graphics.DrawString($Code,$font,[Drawing.Brushes]::DarkBlue,24,30)
 $bitmap.Save($Path,[Drawing.Imaging.ImageFormat]::Png)
} finally {$font.Dispose();$graphics.Dispose();$bitmap.Dispose()}
