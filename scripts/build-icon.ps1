# Reproduce the vector icon as PNG and multi-resolution Windows ICO with Windows GDI+.
Add-Type -AssemblyName System.Drawing
$assetDirectory = Join-Path (Split-Path $PSScriptRoot) 'assets'
$bitmap = New-Object System.Drawing.Bitmap(1024,1024)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = 'AntiAlias'
$graphics.ScaleTransform(4,4)
function Brush($hex) { New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($hex)) }
function Pen($hex,$width) { New-Object System.Drawing.Pen([System.Drawing.ColorTranslator]::FromHtml($hex),$width) }
$background = Brush '#173d35'
$outline = New-Object System.Drawing.Drawing2D.GraphicsPath
$outline.AddArc(8,8,96,96,180,90); $outline.AddArc(152,8,96,96,270,90); $outline.AddArc(152,152,96,96,0,90); $outline.AddArc(8,152,96,96,90,90); $outline.CloseFigure()
$graphics.FillPath($background,$outline)
$grid = Pen '#60846b' 4
foreach($coordinate in @(64,112,160,208)) { $graphics.DrawLine($grid,48,$coordinate,208,$coordinate); $graphics.DrawLine($grid,$coordinate,48,$coordinate,208) }
$black = Brush '#101b19'; $white = Brush '#f5f1dd'; $rim = Pen '#537466' 3
$graphics.FillEllipse($black,45,99,98,98); $graphics.DrawEllipse($rim,45,99,98,98); $graphics.FillEllipse($white,117,51,86,86)
$network = Pen '#39baac' 5
foreach($line in @(@(152,157,182,179),@(182,179,207,143),@(182,179,167,206),@(182,179,217,203))) { $graphics.DrawLine($network,$line[0],$line[1],$line[2],$line[3]) }
$dot = Brush '#76e0c1'; $edge = Pen '#173d35' 3
foreach($node in @(@(152,157,9),@(182,179,11),@(207,143,9),@(167,206,9),@(217,203,9))) { $graphics.FillEllipse($dot,$node[0]-$node[2],$node[1]-$node[2],2*$node[2],2*$node[2]); $graphics.DrawEllipse($edge,$node[0]-$node[2],$node[1]-$node[2],2*$node[2],2*$node[2]) }
$bitmap.Save((Join-Path $assetDirectory 'app.png'),[System.Drawing.Imaging.ImageFormat]::Png)
$sizes = @(16,24,32,48,64,128,256)
$images = @()
foreach($size in $sizes) {
  $small = New-Object System.Drawing.Bitmap($size,$size)
  $g = [System.Drawing.Graphics]::FromImage($small)
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.DrawImage($bitmap,0,0,$size,$size)
  $memory = New-Object IO.MemoryStream
  $small.Save($memory,[System.Drawing.Imaging.ImageFormat]::Png)
  $images += ,$memory.ToArray()
  $g.Dispose(); $small.Dispose(); $memory.Dispose()
}
$stream = [IO.File]::Create((Join-Path $assetDirectory 'app.ico'))
$writer = New-Object IO.BinaryWriter($stream)
$writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Length)
$offset = 6 + 16*$sizes.Length
for($index=0; $index -lt $sizes.Length; $index++) {
  $dimension = if($sizes[$index] -eq 256){0}else{$sizes[$index]}
  $writer.Write([byte]$dimension); $writer.Write([byte]$dimension); $writer.Write([byte]0); $writer.Write([byte]0)
  $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$images[$index].Length); $writer.Write([uint32]$offset)
  $offset += $images[$index].Length
}
foreach($bytes in $images){$writer.Write([byte[]]$bytes)}
$writer.Dispose(); $stream.Dispose(); $graphics.Dispose(); $bitmap.Dispose()
foreach($resource in @($background,$outline,$grid,$black,$white,$rim,$network,$dot,$edge)){$resource.Dispose()}
