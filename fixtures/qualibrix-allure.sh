#!/bin/sh
# Qualibrix "Allure commandline" for the Jenkins Allure plugin (Linux / macOS agents).
#
# The plugin runs this in the job's workspace as
#   allure --version
#   allure generate <results...> [-c] -o <report> [--config <file>] [--single-file]
# and serves what it produces. The report is built by the project's own
# fixtures/allure_html_reporter.js: the classic Allure layout plus the Qualibrix
# Run summary page after Overview, modules, healed-locator blocks and categories.
#
# Register the folder that contains this bin/ folder once in Jenkins:
#   Manage Jenkins > Tools > Allure Commandline > Add, name "qualibrix-allure",
#   "Install automatically" off, Installation directory = that folder.
case "$1" in
  --version|-v|version)
    # The plugin reads the first line; 3.x makes it pass Allure 3 arguments.
    echo "3.20.1"
    exit 0
    ;;
esac
REPORTER="${QUALIBRIX_ALLURE_REPORTER:-$PWD/fixtures/allure_html_reporter.js}"
if [ ! -f "$REPORTER" ]; then
  echo "[qualibrix-allure] $REPORTER not found. The Allure step must run in the project's workspace (it holds fixtures/allure_html_reporter.js), or set QUALIBRIX_ALLURE_REPORTER." >&2
  exit 1
fi
exec node "$REPORTER" --allure-commandline "$@"
