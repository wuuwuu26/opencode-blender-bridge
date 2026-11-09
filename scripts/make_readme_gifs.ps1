# Generate lightweight preview GIFs for the README from the rendered MP4s.
# Source videos live in the sibling local workspace (not distributed in this repo).
# Usage: powershell -File scripts/make_readme_gifs.ps1
$ErrorActionPreference = "Stop"
$ff = "C:\Users\25227\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.1-full_build\bin\ffmpeg.exe"
$root = "C:\Users\25227\Documents\workbuddy"
$out  = Join-Path $PSScriptRoot "..\docs\media"
New-Item -ItemType Directory -Force -Path $out | Out-Null

$items = @(
  @{ name = "go2";    src = "unitree_go2\go2_official\walk.mp4";           fps = 12 },
  @{ name = "g1";     src = "robot_variants\g1_humanoid\animation.mp4";  fps = 12 },
  @{ name = "z1";     src = "robot_variants\z1_arm\animation.mp4";        fps = 12 },
  @{ name = "drone";  src = "robot_variants\drone\animation.mp4";         fps = 12 }
)
# The 1:10 RC car is intentionally not published as a preview: the upstream
# chassis shell and tyre meshes interpenetrate, which shows as clipping when
# the wheel turns. Build it locally if needed, but do not add it here.

foreach ($it in $items) {
  $src = Join-Path $root $it.src
  $dst = Join-Path $out ($it.name + ".gif")
  if (-not (Test-Path $src)) { Write-Warning "missing $src"; continue }
  # two-pass palette for small, clean files
  $pal = Join-Path $out ("_pal_" + $it.name + ".png")
  & $ff -y -loglevel error -i $src -vf "fps=$($it.fps),scale=400:-1:flags=lanczos,palettegen=stats_mode=diff" $pal
  & $ff -y -loglevel error -i $src -i $pal -lavfi "fps=$($it.fps),scale=400:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" $dst
  Remove-Item $pal -ErrorAction SilentlyContinue
  $kb = [math]::Round((Get-Item $dst).Length / 1KB)
  Write-Output ("{0,-8} {1,6} KB  {2}" -f $it.name, $kb, $dst)
}
Write-Output "DONE"
