@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -File "%~dp0scripts\Stop.ps1"
