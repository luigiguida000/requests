@echo off
rem Doppio clic: riporta TUTTI i file al loro posto (chiede conferma)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Annulla_Riordino.ps1" %*
pause
