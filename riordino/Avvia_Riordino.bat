@echo off
rem Doppio clic: analisi + esecuzione a blocchi con conferma
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Riordino_Sicuro.ps1" %*
pause
