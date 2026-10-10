#requires -Version 5.1
<#
  Riordino_Sicuro.ps1
  Esegue le mappe Mappa_Fase1_*.csv al posto di "Riordino_Fase1.ps1 -Esegui", con protezioni.

  Cosa fa:
    1. ANALISI (non tocca nulla): legge ogni mappa, riconosce le colonne origine/destinazione,
       scarta tutto cio' che e' protetto (programmi, giochi, cloud, sistema, progetti, cataloghi media)
       e scrive Sicuri_<mappa>.csv, Esclusi_<mappa>.csv e Analisi_Sicurezza.txt.
    2. ESECUZIONE a blocchi: una mappa alla volta, solo dopo la tua "S".
       Ogni mossa e' scritta in Registro_Mosse.csv PRIMA (InCorso) e DOPO (Spostato).
       Mai sovrascritture, mai cancellazioni, mai spostamenti tra dischi diversi.
    3. VERIFICA dopo ogni mappa (Verifica_<mappa>.txt). Se trova anomalie si ferma.

  Si puo' interrompere e rilanciare: le mosse gia' fatte vengono saltate.
  Per tornare indietro: Annulla_Riordino.ps1 (legge Registro_Mosse.csv).
#>
param(
    [string]$Cartella = $PSScriptRoot,
    [string]$Filtro = 'Mappa_Fase1_*.csv',
    [switch]$SoloAnalisi,
    [switch]$PermettiFotoConCatalogo
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
if (-not $Cartella) { $Cartella = 'D:\_Riordino' }
$Cartella = $Cartella.TrimEnd('\')

# ---------- utilita' ----------
function LP([string]$p) {
    if ($p.StartsWith('\\?\')) { return $p }
    if ($p.StartsWith('\\')) { return '\\?\UNC\' + $p.Substring(2) }
    return '\\?\' + $p
}
function Csv([object]$v) { '"' + ([string]$v).Replace('"', '""') + '"' }
function Padre([string]$p) {
    $t = $p.TrimEnd('\'); $i = $t.LastIndexOf('\')
    if ($i -lt 2) { return $null }
    if ($i -eq 2) { return $t.Substring(0, 3) }
    return $t.Substring(0, $i)
}
function NomeFile([string]$p) { $p.Substring($p.LastIndexOf('\') + 1) }
function Riga($w, [object[]]$campi) { $w.WriteLine((($campi | ForEach-Object { Csv $_ }) -join ',')) }

# ---------- regole di protezione sul percorso ----------
$Regole = [ordered]@{
    'sistema'             = '^[a-z]:\\(windows|program files[^\\]*|programdata|recovery|\$recycle\.bin|system volume information|config\.msi|\$winreagent|\$windows\.~bt|\$windows\.~ws|windowsapps|msocache|perflogs|boot|efi)(\\|$)|\\(appdata|application data)\\'
    'cloud'               = '\\(onedrive[^\\]*|dropbox[^\\]*|google drive[^\\]*|googledrive|my drive|il mio drive|icloud[^\\]*|box|box sync|mega|megasync|pcloud[^\\]*|sync|nextcloud|owncloud)\\'
    'giochi/programmi'    = '\\(steamlibrary|steamapps|steam|epic games|gog games|gog galaxy|origin games|ea games|ea app|ubisoft[^\\]*|battle\.net|riot games|xboxgames|modifiablewindowsapps|rockstar games|games|giochi|emulatori|roms|programmi|portableapps|portable apps)\\'
    'sviluppo'            = '\\(\.git|\.svn|\.hg|node_modules|\.venv|venv|__pycache__|\.idea|\.vs|\.vscode)\\'
    'catalogo media'      = '\\([^\\]*lightroom[^\\]*|[^\\]*\.lrdata|plex media server|kodi|[^\\]*calibre[^\\]*|itunes|musicbee|digikam[^\\]*|capture one[^\\]*|[^\\]*\.photoslibrary|jellyfin|emby)\\'
    'estensione protetta' = '\.(exe|dll|sys|msi|msix|msp|appx|bat|cmd|ps1|lnk|url|ini|inf|lrcat|lrcat-data|lrcat-wal|lrcat-shm|lrdata|cocatalog|itl|db|db-wal|db-shm|sqlite|sqlite3|vhd|vhdx|avhdx|vmdk|vdi|qcow2|pst|ost|sav|pak)$'
}
$EstFoto = '\.(jpe?g|png|tiff?|heic|heif|dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|orf|rw2|raf|srw|pef|raw|rwl|3fr|iiq|psd|xmp|mp4|mov|avi|mts|m2ts|mkv)$'

# ---------- controllo "marcatori" nelle cartelle antenate (con cache) ----------
$CacheCartelle = @{}
function MotivoCartella([string]$dir) {
    if ($null -eq $dir -or $dir.Length -le 3) { return '' }
    $k = $dir.ToLowerInvariant()
    if ($CacheCartelle.ContainsKey($k)) { return $CacheCartelle[$k] }
    $m = MotivoCartella (Padre $dir)
    if (-not $m -and [IO.Directory]::Exists((LP $dir))) {
        $exe = $false; $dll = $false
        try {
            foreach ($e in [IO.Directory]::EnumerateFileSystemEntries((LP $dir))) {
                $n = NomeFile $e; $nl = $n.ToLowerInvariant()
                if ($nl -in '.git', '.svn', '.hg') { $m = "progetto con controllo versione ($n)"; break }
                if ($nl -in '.dropbox', '.dropbox.cache', '.tmp.drivedownload') { $m = "cartella cloud ($n)"; break }
                if ($nl -in 'steam_appid.txt', '.egstore', 'unins000.exe', 'unins000.dat' -or $nl -like 'goggame-*.info') { $m = "gioco/programma installato ($n)"; break }
                if ($nl -like '*.lrcat' -or $nl -like '*.cocatalog' -or $nl -eq 'digikam4.db' -or $nl -eq 'metadata_db_prefs_backup.json' -or $nl -like '*.itl') { $m = "catalogo media ($n)"; break }
                if ($nl -in 'package.json', 'pyproject.toml', 'pom.xml', 'cargo.toml', 'go.mod', 'cmakelists.txt' -or $nl -like '*.sln' -or $nl -like '*.csproj') { $m = "progetto software ($n)"; break }
                if ($nl.EndsWith('.exe')) { $exe = $true } elseif ($nl.EndsWith('.dll')) { $dll = $true }
                if ($exe -and $dll) { $m = 'programma (exe + dll nella stessa cartella)'; break }
            }
        } catch { $m = 'cartella illeggibile' }
    }
    $CacheCartelle[$k] = $m
    return $m
}

# ---------- ricerca cataloghi foto su tutto il disco ----------
function CercaCataloghi([string]$radice) {
    $trovati = New-Object System.Collections.Generic.List[string]
    $pila = New-Object System.Collections.Generic.Stack[string]
    $pila.Push($radice)
    while ($pila.Count -gt 0) {
        $d = $pila.Pop()
        try {
            foreach ($f in [IO.Directory]::EnumerateFiles((LP $d))) {
                if ($f -match '\.(lrcat|cocatalog)$|\\digikam4\.db$') { $trovati.Add($f.Substring(4)) }
            }
            foreach ($s in [IO.Directory]::EnumerateDirectories((LP $d))) {
                if ([IO.File]::GetAttributes($s) -band [IO.FileAttributes]::ReparsePoint) { continue }
                $n = NomeFile $s
                if ($n -match '^(\$recycle\.bin|system volume information|windows|windowsapps)$' -or $n -like '*.lrdata') { continue }
                $pila.Push($s.Substring(4))
            }
        } catch { }
    }
    return , $trovati
}

# ---------- lettura mappa ----------
function LeggiMappa([string]$file) {
    $byte = [IO.File]::ReadAllBytes($file)
    $enc = 'UTF8'
    $haBom = $byte.Length -ge 3 -and $byte[0] -eq 0xEF -and $byte[1] -eq 0xBB -and $byte[2] -eq 0xBF
    if (-not $haBom -and ([Text.Encoding]::UTF8.GetString($byte)).Contains([char]0xFFFD)) { $enc = 'Default' }
    $prima = Get-Content -LiteralPath $file -TotalCount 1 -Encoding $enc
    $c = @{ ';' = $prima.Split(';').Count; ',' = $prima.Split(',').Count; "`t" = $prima.Split("`t").Count }
    $delim = ($c.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 1).Key
    $righe = @(Import-Csv -LiteralPath $file -Delimiter $delim -Encoding $enc)
    if ($righe.Count -eq 0) { return $null }

    $nomi = @($righe[0].PSObject.Properties | ForEach-Object { $_.Name })
    $r0 = $righe[0]
    $ePerc = { param($col) ([string]$r0.$col) -match '^[a-z]:\\' }
    $candO = @($nomi | Where-Object { $_ -match 'orig|sorg|source|^da$|^from$|old|vecch' } | Where-Object { & $ePerc $_ })
    $candD = @($nomi | Where-Object { $_ -match 'dest|target|nuov|^a$|^to$|new' } | Where-Object { & $ePerc $_ })
    if ($candO.Count -eq 1 -and $candD.Count -eq 1) { $colO = $candO[0]; $colD = $candD[0] }
    else {
        $perc = @($nomi | Where-Object { & $ePerc $_ })
        if ($perc.Count -eq 2) { $colO = $perc[0]; $colD = $perc[1] }
        else { throw "Non riconosco le colonne origine/destinazione in $file. Intestazione: $($nomi -join ' | ')" }
    }
    # destinazione = cartella (non percorso completo del file)?
    $camp = @($righe | Select-Object -First 50)
    $uguali = @($camp | Where-Object { (NomeFile ([string]$_.$colO)) -eq (NomeFile ([string]$_.$colD)) }).Count
    $conEst = @($camp | Where-Object { (NomeFile ([string]$_.$colD)) -match '\.[a-z0-9]{1,5}$' }).Count
    $modoCartella = ($uguali -eq 0 -and $conEst -eq 0)

    $out = New-Object System.Collections.Generic.List[object]
    foreach ($r in $righe) {
        $o = [string]$r.$colO; $d = [string]$r.$colD
        if ($o -and $d -and ($modoCartella -or $d.EndsWith('\'))) { $d = $d.TrimEnd('\') + '\' + (NomeFile $o) }
        $out.Add([pscustomobject]@{ Origine = $o; Destinazione = $d })
    }
    return [pscustomobject]@{ Righe = $out; ColO = $colO; ColD = $colD; ModoCartella = $modoCartella; Delim = $delim; Enc = $enc }
}

# ---------- classificazione di una riga ----------
function Classifica([string]$o, [string]$d) {
    if ($o -notmatch '^[a-z]:\\' -or $d -notmatch '^[a-z]:\\') { return 'percorso non assoluto o vuoto' }
    if ($o -match '\\\.{1,2}(\\|$)' -or $d -match '\\\.{1,2}(\\|$)' -or $o.Contains('/') -or $d.Contains('/')) { return 'percorso non normalizzato' }
    if ($Fatti.Contains($o)) { return 'gia spostato in un lancio precedente' }
    if ($o.Substring(0, 2) -ne $d.Substring(0, 2)) { return 'destinazione su altro disco (sarebbe copia+cancella)' }
    if ($o.StartsWith($Cartella + '\', 'OrdinalIgnoreCase')) { return 'file della cartella di lavoro _Riordino' }
    foreach ($k in $Regole.Keys) {
        if ($o -match $Regole[$k]) { return "origine: $k" }
        if ($k -ne 'estensione protetta' -and $d -match $Regole[$k]) { return "destinazione: $k" }
    }
    if ($ProteggiFoto -and $o -match $EstFoto) { return 'foto/video con catalogo Lightroom/C1/digiKam presente' }
    $lo = LP $o
    if (-not [IO.File]::Exists($lo)) {
        if ([IO.Directory]::Exists($lo)) { return 'origine e una cartella (non gestita)' }
        return 'origine non trovata'
    }
    if ([IO.File]::GetAttributes($lo) -band [IO.FileAttributes]::System) { return 'file di sistema (attributo S)' }
    if ([IO.File]::Exists((LP $d)) -or [IO.Directory]::Exists((LP $d))) { return 'destinazione gia esistente' }
    if ($DestVisti.Contains($d)) { return 'destinazione duplicata nelle mappe' }
    $m = MotivoCartella (Padre $o); if ($m) { return "origine: $m" }
    $m = MotivoCartella (Padre $d); if ($m) { return "destinazione: $m" }
    return ''
}

# =====================================================================
$Registro = Join-Path $Cartella 'Registro_Mosse.csv'
$Fatti = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$DestVisti = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
if (Test-Path -LiteralPath $Registro) {
    foreach ($r in (Import-Csv -LiteralPath $Registro -Encoding UTF8)) { if ($r.Esito -eq 'Spostato') { [void]$Fatti.Add($r.Origine) } }
    Write-Host "Registro esistente: $($Fatti.Count) mosse gia fatte (verranno saltate)." -ForegroundColor Yellow
}

$mappe = @(Get-ChildItem -LiteralPath $Cartella -Filter $Filtro | Sort-Object Name)
if ($mappe.Count -eq 0) { throw "Nessuna mappa $Filtro in $Cartella" }

Write-Host "`n=== FASE A: ANALISI (non sposta nulla) ===" -ForegroundColor Cyan
$disco = $mappe[0].FullName.Substring(0, 3)
Write-Host "Cerco cataloghi foto su $disco (1-3 minuti)..."
$Cataloghi = CercaCataloghi $disco
$ProteggiFoto = ($Cataloghi.Count -gt 0 -and -not $PermettiFotoConCatalogo)

$rep = New-Object System.Collections.Generic.List[string]
$rep.Add("Analisi sicurezza - $(Get-Date -Format 'yyyy-MM-dd HH:mm')")
$rep.Add("Cataloghi foto trovati: $($Cataloghi.Count)")
foreach ($c in $Cataloghi) { $rep.Add("   $c") }
if ($ProteggiFoto) { $rep.Add('   => foto/video ESCLUSI: se sono gestiti da Lightroom vanno spostati DA DENTRO Lightroom, altrimenti il catalogo si rompe.') }

$Piano = [ordered]@{}
$totS = 0; $totE = 0
foreach ($mf in $mappe) {
    $nome = $mf.BaseName
    $mp = LeggiMappa $mf.FullName
    if ($null -eq $mp) { $rep.Add("$nome : vuota"); continue }
    $sicuri = New-Object System.Collections.Generic.List[object]
    $esclusi = New-Object System.Collections.Generic.List[object]
    $i = 0
    foreach ($r in $mp.Righe) {
        $i++; if ($i % 5000 -eq 0) { Write-Host "  $nome : $i / $($mp.Righe.Count)" }
        $mot = Classifica $r.Origine $r.Destinazione
        if ($mot) { $esclusi.Add([pscustomobject]@{ Origine = $r.Origine; Destinazione = $r.Destinazione; Motivo = $mot }) }
        else { [void]$DestVisti.Add($r.Destinazione); $sicuri.Add($r) }
    }
    $sicuri | Export-Csv -LiteralPath (Join-Path $Cartella "Sicuri_$nome.csv") -NoTypeInformation -Encoding UTF8
    $esclusi | Export-Csv -LiteralPath (Join-Path $Cartella "Esclusi_$nome.csv") -NoTypeInformation -Encoding UTF8
    $Piano[$nome] = $sicuri
    $totS += $sicuri.Count; $totE += $esclusi.Count

    $rep.Add('')
    $rep.Add("== $nome : righe $($mp.Righe.Count) | sicure $($sicuri.Count) | escluse $($esclusi.Count)")
    $rep.Add("   colonne: origine='$($mp.ColO)' destinazione='$($mp.ColD)'$(if ($mp.ModoCartella) { ' (cartella + nome file)' }) separatore='$($mp.Delim)' codifica=$($mp.Enc)")
    foreach ($s in ($mp.Righe | Select-Object -First 3)) { $rep.Add("   es.: $($s.Origine)  ->  $($s.Destinazione)") }
    foreach ($g in ($esclusi | Group-Object Motivo | Sort-Object Count -Descending)) { $rep.Add(('   {0,7}  {1}' -f $g.Count, $g.Name)) }
}
$rep.Add(''); $rep.Add("TOTALE: sicure $totS | escluse $totE")
$rep | Set-Content -LiteralPath (Join-Path $Cartella 'Analisi_Sicurezza.txt') -Encoding UTF8
$rep | ForEach-Object { Write-Host $_ }
if ($SoloAnalisi) { Write-Host "`nSolo analisi: fine. Nulla e' stato spostato."; return }

# =====================================================================
Write-Host "`n=== FASE B: ESECUZIONE A BLOCCHI ===" -ForegroundColor Cyan
$nuovo = -not (Test-Path -LiteralPath $Registro)
$w = New-Object IO.StreamWriter($Registro, $true, (New-Object Text.UTF8Encoding($true)))
$w.AutoFlush = $true
if ($nuovo) { $w.WriteLine('Ora,Mappa,Origine,Destinazione,Byte,Esito,Dettaglio') }
try {
    foreach ($nome in $Piano.Keys) {
        $lista = $Piano[$nome]
        if ($lista.Count -eq 0) { Write-Host "$nome : niente da spostare."; continue }
        $risp = Read-Host "`nSposto $($lista.Count) file di $nome ? (S = si, altro = esci)"
        if ($risp -notmatch '^[sS]') { Write-Host 'Interrotto da te. Nulla di non registrato e'' stato toccato.'; break }

        $mossi = New-Object System.Collections.Generic.List[object]
        $errori = New-Object System.Collections.Generic.List[string]
        $n = 0
        foreach ($r in $lista) {
            $n++; if ($n % 2000 -eq 0) { Write-Host "  $n / $($lista.Count)" }
            $lo = LP $r.Origine; $ld = LP $r.Destinazione; $byte = ''
            try {
                if (-not [IO.File]::Exists($lo)) { throw 'origine non piu presente' }
                if ([IO.File]::Exists($ld) -or [IO.Directory]::Exists($ld)) { throw 'destinazione occupata' }
                $byte = (New-Object IO.FileInfo($lo)).Length
                Riga $w @((Get-Date -Format s), $nome, $r.Origine, $r.Destinazione, $byte, 'InCorso', '')
                [void][IO.Directory]::CreateDirectory((LP (Padre $r.Destinazione)))
                [IO.File]::Move($lo, $ld)
                Riga $w @((Get-Date -Format s), $nome, $r.Origine, $r.Destinazione, $byte, 'Spostato', '')
                $mossi.Add([pscustomobject]@{ O = $r.Origine; D = $r.Destinazione; B = $byte })
            } catch {
                $msg = $_.Exception.Message
                Riga $w @((Get-Date -Format s), $nome, $r.Origine, $r.Destinazione, $byte, 'Errore', $msg)
                $errori.Add("$($r.Origine) : $msg")
            }
        }

        # ---- verifica ----
        $anom = New-Object System.Collections.Generic.List[string]
        foreach ($x in $mossi) {
            $ld = LP $x.D
            if (-not [IO.File]::Exists($ld)) { $anom.Add("MANCA a destinazione: $($x.D)"); continue }
            if ([IO.File]::Exists((LP $x.O))) { $anom.Add("ANCORA in origine: $($x.O)") }
            if ((New-Object IO.FileInfo($ld)).Length -ne $x.B) { $anom.Add("DIMENSIONE diversa: $($x.D)") }
        }
        $ver = @("Verifica $nome - $(Get-Date -Format 'yyyy-MM-dd HH:mm')",
            "Previsti: $($lista.Count) | Spostati: $($mossi.Count) | Errori: $($errori.Count) | Anomalie verifica: $($anom.Count)", '')
        if ($errori.Count) { $ver += 'ERRORI (file lasciati al loro posto):'; $ver += $errori }
        if ($anom.Count) { $ver += 'ANOMALIE:'; $ver += $anom }
        $ver | Set-Content -LiteralPath (Join-Path $Cartella "Verifica_$nome.txt") -Encoding UTF8
        $col = if ($anom.Count) { 'Red' } elseif ($errori.Count) { 'Yellow' } else { 'Green' }
        $ver | Select-Object -First 25 | ForEach-Object { Write-Host $_ -ForegroundColor $col }
        if ($anom.Count) { Write-Host "`nANOMALIE: mi fermo. Manda Verifica_$nome.txt a Claude." -ForegroundColor Red; break }
    }
} finally { $w.Close() }
Write-Host "`nFine. Registro: $Registro  -  Per annullare: Annulla_Riordino.bat"
