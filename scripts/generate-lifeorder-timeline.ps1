Add-Type -AssemblyName System.Drawing

$width = 2400
$height = 960
$bitmap = New-Object System.Drawing.Bitmap $width, $height
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(255, 255, 252, 246))

$font = 'Microsoft JhengHei'
$titleFont = New-Object System.Drawing.Font($font, 34, [System.Drawing.FontStyle]::Bold)
$ageFont = New-Object System.Drawing.Font($font, 26, [System.Drawing.FontStyle]::Bold)
$nameFont = New-Object System.Drawing.Font($font, 28, [System.Drawing.FontStyle]::Bold)
$bodyFont = New-Object System.Drawing.Font($font, 22)
$focusFont = New-Object System.Drawing.Font($font, 21, [System.Drawing.FontStyle]::Bold)
$text = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 30, 50, 58))
$muted = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 83, 96, 102))

$stages = @(
  @{ Age='0-20歲'; Name='探索自己'; Color='#6B9238'; Points=@('認識自己與探索興趣','建立學習能力與習慣','家庭支持與價值觀養成'); Focus='建立自我認同與價值觀基礎' },
  @{ Age='20-30歲'; Name='建立基礎'; Color='#3F75B5'; Points=@('學習與職涯發展','建立人際關係與社交圈','財務基礎與理財觀念'); Focus='能力累積與生活基礎建立' },
  @{ Age='30-45歲'; Name='平衡發展'; Color='#2D9A8A'; Points=@('事業發展與自我實現','家庭經營與關係深化','資產累積與風險規劃'); Focus='平衡工作、家庭與自我成長' },
  @{ Age='45-60歲'; Name='整合安排'; Color='#D86F1F'; Points=@('資產穩定與財務優化','培養下一代與傳承準備','生活品質與健康管理'); Focus='人生整合與傳承規劃開始' },
  @{ Age='60-75歲'; Name='豐盛投入'; Color='#8055A0'; Points=@('享受生活與興趣投入','分享經驗與回饋社會','重要安排逐步完成'); Focus='持續創造價值與心靈豐盛' },
  @{ Age='75歲以上'; Name='傳承心意'; Color='#D96F79'; Points=@('生命傳承與精神延續','珍惜當下與陪伴家人','留下愛與祝福'); Focus='安心生活、愛的傳承與祝福' }
)

$margin = 38
$gap = 18
$cardWidth = [int](($width - ($margin * 2) - ($gap * 5)) / 6)
$cardHeight = 790
$cardTop = 88

for ($i = 0; $i -lt $stages.Count; $i++) {
  $stage = $stages[$i]
  $x = $margin + $i * ($cardWidth + $gap)
  $color = [System.Drawing.ColorTranslator]::FromHtml($stage.Color)
  $pale = [System.Drawing.Color]::FromArgb(255, [Math]::Min(255, $color.R + 180), [Math]::Min(255, $color.G + 180), [Math]::Min(255, $color.B + 180))
  $cardBrush = New-Object System.Drawing.SolidBrush($pale)
  $accentBrush = New-Object System.Drawing.SolidBrush($color)
  $cardPen = New-Object System.Drawing.Pen($color, 2)
  $graphics.FillRectangle($cardBrush, $x, $cardTop, $cardWidth, $cardHeight)
  $graphics.DrawRectangle($cardPen, $x, $cardTop, $cardWidth, $cardHeight)
  $graphics.FillRectangle($accentBrush, $x, $cardTop, $cardWidth, 12)

  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Near
  $graphics.DrawString($stage.Age, $ageFont, $text, [System.Drawing.RectangleF]::new($x + 12, $cardTop + 40, $cardWidth - 24, 46), $format)
  $graphics.DrawString($stage.Name, $nameFont, $accentBrush, [System.Drawing.RectangleF]::new($x + 12, $cardTop + 102, $cardWidth - 24, 48), $format)

  $lineY = $cardTop + 178
  $graphics.DrawLine((New-Object System.Drawing.Pen($color, 2)), $x + 28, $lineY, $x + $cardWidth - 28, $lineY)
  $pointY = $cardTop + 215
  foreach ($point in $stage.Points) {
    $graphics.FillEllipse($accentBrush, $x + 28, $pointY + 11, 8, 8)
    $pointFormat = New-Object System.Drawing.StringFormat
    $pointFormat.Alignment = [System.Drawing.StringAlignment]::Near
    $pointFormat.LineAlignment = [System.Drawing.StringAlignment]::Near
    $pointFormat.Trimming = [System.Drawing.StringTrimming]::EllipsisWord
    $pointFormat.FormatFlags = [System.Drawing.StringFormatFlags]::LineLimit
    $graphics.DrawString($point, $bodyFont, $muted, [System.Drawing.RectangleF]::new($x + 48, $pointY, $cardWidth - 70, 84), $pointFormat)
    $pointY += 132
  }

  $focusTop = $cardTop + 635
  $focusBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $graphics.FillRectangle($focusBrush, $x + 22, $focusTop, $cardWidth - 44, 112)
  $graphics.DrawRectangle($cardPen, $x + 22, $focusTop, $cardWidth - 44, 112)
  $focusFormat = New-Object System.Drawing.StringFormat
  $focusFormat.Alignment = [System.Drawing.StringAlignment]::Center
  $focusFormat.LineAlignment = [System.Drawing.StringAlignment]::Center
  $focusFormat.FormatFlags = [System.Drawing.StringFormatFlags]::LineLimit
  $graphics.DrawString($stage.Focus, $focusFont, $accentBrush, [System.Drawing.RectangleF]::new($x + 34, $focusTop + 12, $cardWidth - 68, 88), $focusFormat)
}

$output = Join-Path $PSScriptRoot '..\public\assets\life-order-stage-details.png'
$bitmap.Save($output, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
