@echo off
chcp 65001 >nul
REM ============================================================
REM  Bản chạy IM LẶNG cho Task Scheduler (không hiện pause).
REM  Tự ghi kết quả vào data\backups\backup-log.txt
REM  KHÔNG bấm tay file này — dùng backup-db.bat để bấm tay.
REM ============================================================
pushd "%~dp0\.."
if not exist "data\backups" mkdir "data\backups"
echo [%date% %time%] === Bat dau backup === >> "data\backups\backup-log.txt"
"C:\Program Files\nodejs\node.exe" --no-warnings "scripts\backup-db.mjs" >> "data\backups\backup-log.txt" 2>&1
echo [%date% %time%] === Ket thuc === >> "data\backups\backup-log.txt"
echo. >> "data\backups\backup-log.txt"
popd
