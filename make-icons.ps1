# FaceBoot icon generator
# Usage: place the source image at icons\source.jpg or icons\source.png, then run this script once.
# Requires Windows with .NET (built-in on all modern Windows installs).

param(
    [string]$SourceFile = ""
)

$sizes = @(16, 32, 48, 128)

if ([string]::IsNullOrWhiteSpace($SourceFile)) {
    $candidateSources = @(
        "$PSScriptRoot\icons\source.jpg",
        "$PSScriptRoot\icons\source.png"
    )

    $SourceFile = $candidateSources | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not (Test-Path $SourceFile)) {
    Write-Error "Source image not found. Save the FaceBoot logo image as icons\source.jpg or icons\source.png first."
    exit 1
}

Add-Type -AssemblyName System.Drawing

$src = [System.Drawing.Image]::FromFile((Resolve-Path $SourceFile))
$srcBitmap = [System.Drawing.Bitmap]::new($src)
$cropProfiles = @{
    16  = @{ X = 0.10; Y = 0.02; W = 0.72; H = 0.72 }
    32  = @{ X = 0.08; Y = 0.01; W = 0.76; H = 0.76 }
    48  = @{ X = 0.05; Y = 0.00; W = 0.84; H = 0.84 }
    128 = @{ X = 0.00; Y = 0.00; W = 1.00; H = 1.00 }
}

function Get-ContentBounds([System.Drawing.Bitmap]$bitmap) {
    $threshold = 242
    $minX = $bitmap.Width
    $minY = $bitmap.Height
    $maxX = -1
    $maxY = -1

    for ($y = 0; $y -lt $bitmap.Height; $y++) {
        for ($x = 0; $x -lt $bitmap.Width; $x++) {
            $pixel = $bitmap.GetPixel($x, $y)
            $isBackground = $pixel.A -lt 16 -or ($pixel.R -ge $threshold -and $pixel.G -ge $threshold -and $pixel.B -ge $threshold)
            if ($isBackground) {
                continue
            }

            if ($x -lt $minX) { $minX = $x }
            if ($y -lt $minY) { $minY = $y }
            if ($x -gt $maxX) { $maxX = $x }
            if ($y -gt $maxY) { $maxY = $y }
        }
    }

    if ($maxX -lt 0 -or $maxY -lt 0) {
        return [System.Drawing.Rectangle]::new(0, 0, $bitmap.Width, $bitmap.Height)
    }

    $paddingX = [int][Math]::Round(($maxX - $minX + 1) * 0.03)
    $paddingY = [int][Math]::Round(($maxY - $minY + 1) * 0.03)
    $x = [Math]::Max(0, $minX - $paddingX)
    $y = [Math]::Max(0, $minY - $paddingY)
    $right = [Math]::Min($bitmap.Width - 1, $maxX + $paddingX)
    $bottom = [Math]::Min($bitmap.Height - 1, $maxY + $paddingY)

    return [System.Drawing.Rectangle]::new($x, $y, $right - $x + 1, $bottom - $y + 1)
}

$contentBounds = Get-ContentBounds -bitmap $srcBitmap

function Get-CropRectangle([int]$size, [System.Drawing.Image]$image) {
    $profile = $cropProfiles[$size]
    if (-not $profile) {
        return [System.Drawing.Rectangle]::new(0, 0, $image.Width, $image.Height)
    }

    $x = $contentBounds.X + [int][Math]::Round($contentBounds.Width * $profile.X)
    $y = $contentBounds.Y + [int][Math]::Round($contentBounds.Height * $profile.Y)
    $w = [int][Math]::Round($contentBounds.Width * $profile.W)
    $h = [int][Math]::Round($contentBounds.Height * $profile.H)

    if ($x + $w -gt $image.Width) {
        $w = $image.Width - $x
    }

    if ($y + $h -gt $image.Height) {
        $h = $image.Height - $y
    }

    return [System.Drawing.Rectangle]::new($x, $y, $w, $h)
}

foreach ($size in $sizes) {
    $dst = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($dst)
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality

    $crop = Get-CropRectangle -size $size -image $src
    $g.DrawImage(
        $src,
        [System.Drawing.Rectangle]::new(0, 0, $size, $size),
        $crop,
        [System.Drawing.GraphicsUnit]::Pixel
    )
    $g.Dispose()

    $outPath = "$PSScriptRoot\icons\icon$size.png"
    $dst.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $dst.Dispose()
    Write-Host "Created $outPath ($size x $size)"
}

$src.Dispose()
$srcBitmap.Dispose()
Write-Host "`nAll icons generated. Reload the extension in chrome://extensions"
