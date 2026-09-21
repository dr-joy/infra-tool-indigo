@echo off
chcp 65001 >nul
REM ============================================================
REM  Bấm đúp vào file này để backup database (có ghi ngày giờ).
REM  Bản sao được lưu ở: data\backups\  và  OneDrive\TaskManagerBackups\
REM ============================================================
pushd "%~dp0"
node --no-warnings scripts\backup-db.mjs
echo.
echo Nhan phim bat ky de dong cua so...
pause >nul
popd
