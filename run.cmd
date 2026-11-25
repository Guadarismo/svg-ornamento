@echo off
setlocal
cd /d "%~dp0"
set "NODE_BIN=node"
if exist "%~dp0portable\node\node.exe" set "NODE_BIN=%~dp0portable\node\node.exe"
"%NODE_BIN%" server.js
pause