@echo off
title LuvTK Ent - Server
cd /d "%~dp0"
echo Starting LuvTK Ent server on http://localhost:3005 ...
start "" http://localhost:3005
node server/index.js
pause
