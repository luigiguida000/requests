# Installa 5 skill per Claude Code su Windows (CLI + app desktop):
# find-skills, gstack, unslop, hyperframes, agent-browser
# Uso:  powershell -ExecutionPolicy Bypass -File .\installa-skill-windows.ps1
$ErrorActionPreference = 'Continue'
$S = Join-Path $env:USERPROFILE '.claude\skills'
New-Item -ItemType Directory -Force -Path $S | Out-Null

function Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' +
              [Environment]::GetEnvironmentVariable('Path','User')
}
function Run($c) { cmd /c $c }   # evita il blocco degli script .ps1 di npm/npx

Step '1/6 Prerequisiti (Git, Node.js, Bun, FFmpeg) via winget'
foreach ($id in 'Git.Git','OpenJS.NodeJS.LTS','Oven-sh.Bun','Gyan.FFmpeg') {
  winget install --id $id -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
}
Refresh-Path
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  powershell -c "irm bun.sh/install.ps1 | iex"; Refresh-Path
  $env:Path += ";$env:USERPROFILE\.bun\bin"
}

Step '2/6 Find Skills (Vercel)'
Run 'npx -y skills add vercel-labs/skills --skill find-skills -a claude-code -g -y'

Step '3/6 gstack (Garry Tan)'
$G = Join-Path $S 'gstack'
if (-not (Test-Path $G)) { git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git $G }
$bash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
& $bash -lc 'cd ~/.claude/skills/gstack && ./setup < /dev/null'

Step '4/6 Unslop (Damir Sokolovsky)'
$T = Join-Path $env:TEMP ('unslop-' + [guid]::NewGuid())
git clone --depth 1 https://github.com/heydamir/unslop $T
if (Test-Path "$T\skills\unslop") {
  Remove-Item -Recurse -Force (Join-Path $S 'unslop') -ErrorAction SilentlyContinue
  Copy-Item -Recurse "$T\skills\unslop" $S
}
Remove-Item -Recurse -Force $T -ErrorAction SilentlyContinue

Step '5/6 Hyperframes (HeyGen)'
Run 'npm i -g hyperframes'
Run 'hyperframes skills update'

Step '6/6 Agent Browser (Vercel)'
Run 'npm i -g agent-browser'
Run 'agent-browser install'
Run 'npx -y skills add vercel-labs/agent-browser -a claude-code -g -y'

Step 'Verifica'
foreach ($k in 'find-skills','gstack','office-hours','design-shotgun','diagram','unslop',
               'hyperframes','hyperframes-cli','media-use','agent-browser') {
  if (Test-Path (Join-Path $S "$k\SKILL.md")) { Write-Host "  OK      $k" -ForegroundColor Green }
  else { Write-Host "  MANCA   $k" -ForegroundColor Red }
}
Write-Host "`nFatto. Chiudi e riapri Claude (app e terminale) per caricare le skill." -ForegroundColor Yellow
