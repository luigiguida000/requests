#requires -Version 5.1
<#
  Annulla_Riordino.ps1
  Riporta i file al loro posto leggendo Registro_Mosse.csv, dall'ultima mossa alla prima.
  Non sovrascrive e non cancella nulla: se l'origine e' gia occupata segnala "Conflitto" e salta.
  Le cartelle create dal riordino restano (vuote): nessuna cancellazione.

  Parametri:
    -Mappa Mappa_Fase1_01   annulla solo quella mappa (default: tutte)
    -Prova                  mostra cosa farebbe senza spostare nulla
#>
param(
    [string]$Cartella = $PSScriptRoot,
    [string]$Mappa = '',
    [switch]$Prova
)
Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'
if (-not $Cartella) { $Cartella = 'D:\_Riordino' }

function LP([string]$p) {
    if ($p.StartsWith('\\?\')) { return $p }
    if ($p.StartsWith('\\')) { return '\\?\UNC\' + $p.Substring(2) }
    return '\\?\' + $p
}
function Padre([string]$p) {
    $t = $p.TrimEnd('\'); $i = $t.LastIndexOf('\')
    if ($i -lt 2) { return $null }
    if ($i -eq 2) { return $t.Substring(0, 3) }
    return $t.Substring(0, $i)
}
function Csv([object]$v) { '"' + ([string]$v).Replace('"', '""') + '"' }

$Registro = Join-Path $Cartella 'Registro_Mosse.csv'
if (-not (Test-Path -LiteralPath $Registro)) { throw "Registro non trovato: $Registro" }

# InCorso senza Spostato = mossa interrotta: la si controlla comunque (decide lo stato reale su disco).
$righe = @(Import-Csv -LiteralPath $Registro -Encoding UTF8 |
    Where-Object { $_.Esito -in 'Spostato', 'InCorso' -and (-not $Mappa -or $_.Mappa -eq $Mappa) })
$visti = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
$lista = New-Object System.Collections.Generic.List[object]
for ($i = $righe.Count - 1; $i -ge 0; $i--) {
    if ($visti.Add($righe[$i].Origine + '|' + $righe[$i].Destinazione)) { $lista.Add($righe[$i]) }
}
Write-Host "Mosse da annullare$(if ($Mappa) { " ($Mappa)" }): $($lista.Count)$(if ($Prova) { '  [PROVA: nulla verra spostato]' })"
if ($lista.Count -eq 0) { return }
if (-not $Prova) {
    if ((Read-Host 'Confermi il ripristino? (S = si)') -notmatch '^[sS]') { Write-Host 'Annullato.'; return }
}

$log = Join-Path $Cartella ("Registro_Annullamento_{0}.csv" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
$w = New-Object IO.StreamWriter($log, $false, (New-Object Text.UTF8Encoding($true)))
$w.AutoFlush = $true
$w.WriteLine('Ora,Mappa,Da,A,Esito,Dettaglio')
$cont = @{ Ripristinato = 0; 'Gia al suo posto' = 0; Conflitto = 0; Mancante = 0; Errore = 0 }
$n = 0
try {
    foreach ($r in $lista) {
        $n++; if ($n % 2000 -eq 0) { Write-Host "  $n / $($lista.Count)" }
        $lo = LP $r.Origine; $ld = LP $r.Destinazione
        $inD = [IO.File]::Exists($ld); $inO = [IO.File]::Exists($lo) -or [IO.Directory]::Exists($lo)
        $det = ''
        if ($inD -and -not $inO) {
            try {
                if (-not $Prova) {
                    [void][IO.Directory]::CreateDirectory((LP (Padre $r.Origine)))
                    [IO.File]::Move($ld, $lo)
                }
                $es = 'Ripristinato'
            } catch { $es = 'Errore'; $det = $_.Exception.Message }
        }
        elseif (-not $inD -and $inO) { $es = 'Gia al suo posto' }
        elseif ($inD -and $inO) { $es = 'Conflitto'; $det = 'origine occupata: nessuna sovrascrittura' }
        else { $es = 'Mancante' }
        $cont[$es]++
        $w.WriteLine((@((Get-Date -Format s), $r.Mappa, $r.Destinazione, $r.Origine, $es, $det) | ForEach-Object { Csv $_ }) -join ',')
    }
} finally { $w.Close() }
$cont.GetEnumerator() | Sort-Object Name | ForEach-Object { Write-Host ('{0,-18} {1}' -f $_.Name, $_.Value) }
Write-Host "Dettaglio: $log"
