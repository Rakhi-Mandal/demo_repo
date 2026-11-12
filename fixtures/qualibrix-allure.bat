@echo off
rem Qualibrix "Allure commandline" for the Jenkins Allure plugin (Windows agents).
rem The plugin runs this in the job's workspace as
rem   allure --version
rem   allure generate <results...> [-c] -o <report> [--config <file>] [--single-file]
rem The report is built by the project's fixtures/allure_html_reporter.js.
if /i "%~1"=="--version" goto version
if /i "%~1"=="-v" goto version
if /i "%~1"=="version" goto version
set "QUALIBRIX_REPORTER=%QUALIBRIX_ALLURE_REPORTER%"
if "%QUALIBRIX_REPORTER%"=="" set "QUALIBRIX_REPORTER=%CD%/fixtures/allure_html_reporter.js"
if not exist "%QUALIBRIX_REPORTER%" goto missing
node "%QUALIBRIX_REPORTER%" --allure-commandline %*
exit /b %ERRORLEVEL%

:version
echo 3.20.1
exit /b 0

:missing
echo [qualibrix-allure] %QUALIBRIX_REPORTER% not found. The Allure step must run in the project's workspace, or set QUALIBRIX_ALLURE_REPORTER. 1>&2
exit /b 1
