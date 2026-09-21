@echo off
chcp 65001 >nul
title Task Manager
pushd "%~dp0"

REM --- Neu app DA chay roi (cong 4000 dang mo) thi chi mo trinh duyet ---
netstat -ano | findstr ":4000 " | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo App dang chay san. Dang mo trinh duyet...
  start "" http://localhost:4000
  timeout /t 2 >nul
  popd
  exit /b 0
)

REM --- Build giao dien neu chua co (lan dau, hoac sau khi xoa dist) ---
if not exist "dist\index.html" (
  echo Dang build giao dien lan dau, vui long doi mot chut...
  call npm run build
)

echo.
echo ============================================
echo    TASK MANAGER dang khoi dong...
echo    Trinh duyet se tu dong mo sau giay lat.
echo.
echo    *** KHONG dong cua so nay khi dang dung app ***
echo    (Dong cua so nay = tat app)
echo ============================================
echo.

set OPEN_BROWSER=1
node --import tsx server/index.ts

echo.
echo App da dung. Nhan phim bat ky de dong...
pause >nul
popd
