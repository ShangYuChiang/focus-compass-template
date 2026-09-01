@echo off
set "FOCUS_INSTALL_SCRIPT=%~dp0install-desktop-toolchain.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File \"%FOCUS_INSTALL_SCRIPT%\"'"
