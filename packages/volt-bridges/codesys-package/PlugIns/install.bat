@echo off
REM VoltBridge CODESYS — starts the bridge HTTP daemon on port 8556.
REM The bridge connects to the CODESYS Scripting Engine to serve
REM the volt CLI (pull/push/status/build) over loopback HTTP.
REM
REM This script runs once after package installation to register
REM the bridge with the CODESYS Scripting Engine.

echo VoltBridge installed to %AP_ROOT%\VoltBridge
echo Start the bridge by running: %AP_ROOT%\VoltBridge\VoltBridge.Codesys.exe
echo Or configure CODESYS to auto-start it via Tools ^> Scripting ^> Startup Scripts.
