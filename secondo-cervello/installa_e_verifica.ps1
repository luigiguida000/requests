# installa_e_verifica.ps1 - installa cervello.py nel vault e verifica che tutto funzioni.
# Uso: powershell -ExecutionPolicy Bypass -File .\installa_e_verifica.ps1 [-Vault "PERCORSO\DEL\VAULT"]
# Non modifica nessuna nota: copia uno strumento in <vault>\.cervello e scrive solo rapporti li' dentro.

param([string]$Vault)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONUTF8 = '1'

function Ferma($messaggio) { Write-Host "`nERRORE: $messaggio" -ForegroundColor Red; exit 1 }

# 1. Python
$python = $null
foreach ($c in @('python', 'py')) {
    $cmd = Get-Command $c -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source -notlike '*WindowsApps*') { $python = $c; break }
}
if (-not $python) { Ferma "non trovo Python. Installa Python 3 da python.org (spunta 'Add to PATH')." }
$versione = & $python -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ([version]$versione -lt [version]'3.9') { Ferma "serve Python 3.9 o piu' recente (trovato $versione)." }
Write-Host "Python $versione trovato." -ForegroundColor Green

# 2. Vault
if (-not $Vault) { $Vault = Read-Host "Percorso del vault (la cartella che contiene .obsidian)" }
$Vault = $Vault.Trim('"').Trim()
if (-not (Test-Path -LiteralPath $Vault -PathType Container)) { Ferma "la cartella '$Vault' non esiste." }
if (-not (Test-Path -LiteralPath (Join-Path $Vault '.obsidian'))) {
    Ferma "in '$Vault' non c'e' la cartella .obsidian: non sembra un vault Obsidian."
}

# 3. Copia dello strumento
$sorgente = Join-Path $PSScriptRoot 'cervello.py'
if (-not (Test-Path -LiteralPath $sorgente)) { Ferma "cervello.py deve stare nella stessa cartella di questo script." }
$cartella = Join-Path $Vault '.cervello'
New-Item -ItemType Directory -Force -Path $cartella | Out-Null
$destinazione = Join-Path $cartella 'cervello.py'
Copy-Item -LiteralPath $sorgente -Destination $destinazione -Force
Write-Host "Strumento copiato in $destinazione" -ForegroundColor Green

# 4. Autotest
Write-Host "`n== Prove su un vault finto ==" -ForegroundColor Cyan
& $python $destinazione autotest
if ($LASTEXITCODE -ne 0) { Ferma "l'autotest non e' passato. Copia tutto il testo qui sopra e mandalo a Claude." }

# 5. Recupera (deve dire 'Tutto in ordine')
Write-Host "`n== Scritture interrotte ==" -ForegroundColor Cyan
& $python $destinazione recupera --vault $Vault
if ($LASTEXITCODE -ne 0) { Ferma "il controllo delle scritture interrotte non e' riuscito." }

# 6. Primo controllo di salute (solo lettura)
Write-Host "`n== Salute del tuo vault (solo lettura) ==" -ForegroundColor Cyan
$rapporto = Join-Path $cartella ("salute-" + (Get-Date -Format 'yyyy-MM-dd') + '.md')
& $python $destinazione salute $Vault --rapporto $rapporto
if ($LASTEXITCODE -ne 0) { Ferma "il controllo di salute non e' riuscito." }
& $python $destinazione salute $Vault --json --massimo 5 | Out-File -Encoding utf8 (Join-Path $cartella 'salute-ultima.json')

# 7. Prova di ricerca (solo lettura)
Write-Host "`n== Prova di ricerca ==" -ForegroundColor Cyan
& $python $destinazione cerca "castello" --vault $Vault --quanti 3

Write-Host "`nTUTTO FUNZIONA." -ForegroundColor Green
Write-Host "Rapporto completo: $rapporto"
Write-Host "Per farlo leggere a Claude: incolla il contenuto del rapporto, oppure digli di aprire quel file."
Start-Process notepad.exe -ArgumentList "`"$rapporto`""
