```groovy
pipeline {
    agent any

    options {
        timestamps()
    }

    parameters {
        choice(
            name: 'EXECUTION_MODE',
            choices: ['suite', 'spec'],
            description: 'suite = run sanity/regression folder, spec = run one spec file'
        )
        choice(
            name: 'BROWSER',
            choices: ['chromium', 'chrome', 'msedge', 'firefox', 'webkit'],
            description: 'Playwright project name'
        )
        booleanParam(
            name: 'HEADED',
            defaultValue: false,
            description: 'Run browser in headed mode'
        )
        string(
            name: 'TARGET',
            defaultValue: 'regression',
            description: 'For suite mode use sanity or regression. For spec mode use a spec path like regression/test_kortis_01.spec.js'
        )
        string(
            name: 'PROJECT_ID',
            defaultValue: '',
            description: 'Database project id used to resolve dynamic test-data fields'
        )
        string(
            name: 'QUALIBRIX_API_URL',
            defaultValue: '',
            description: 'Backend URL used to resolve DB-backed dynamic test data'
        )
    }

    stages {
        stage('Install') {
            steps {
                sh '''
                    set -e
                    npm ci
                    npx playwright install --with-deps
                '''
            }
        }

        stage('Prepare Dynamic Test Data') {
            steps {
                script {
                    if (params.QUALIBRIX_API_URL?.trim() &&
                        params.PROJECT_ID?.trim()) {

                        withEnv([
                            "DYNAMIC_API_URL=${params.QUALIBRIX_API_URL.trim()}",
                            "DYNAMIC_PROJECT_ID=${params.PROJECT_ID.trim()}"
                        ]) {
                            sh '''
                                set -eu

                                python3 - <<'PY'
import json
import os
import urllib.request
from pathlib import Path

api_url = os.environ["DYNAMIC_API_URL"].rstrip("/")
project_id = os.environ["DYNAMIC_PROJECT_ID"]
endpoint = api_url + "/api/projects/dynamic-test-data"

data_files = sorted(
    p for p in Path(".").rglob("*.test-data.json")
    if not any(part in {
        "node_modules", ".git", "test-results",
        "playwright-report", "allure-results"
    } for part in p.parts)
)

root_data = Path("test-data.json")
if root_data.is_file() and root_data not in data_files:
    data_files.append(root_data)

for data_file in data_files:
    with data_file.open("r", encoding="utf-8-sig") as f:
        base_payload = json.load(f)

    request_body = json.dumps({
        "projectId": project_id,
        "payload": base_payload
    }).encode("utf-8")

    req = urllib.request.Request(
        endpoint,
        data=request_body,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=60) as response:
        result = json.loads(response.read().decode("utf-8"))

    if "payload" not in result:
        raise RuntimeError(
            f"API response does not contain 'payload' for {data_file}"
        )

    with data_file.open("w", encoding="utf-8") as f:
        json.dump(result["payload"], f, indent=2, ensure_ascii=False)
        f.write("\\n")

    print(f"Applied DB-backed dynamic test data to {data_file}")

if not data_files:
    print("No companion dynamic test-data files were found.")
PY
                            '''
                        }
                    } else {
                        echo 'Dynamic test-data preparation skipped: QUALIBRIX_API_URL or PROJECT_ID is missing.'
                    }
                }
            }
        }

        stage('Run Tests') {
            steps {
                script {
                    def target = params.TARGET.trim()

                    if (!target) {
                        error('TARGET cannot be empty.')
                    }

                    if (params.EXECUTION_MODE == 'suite') {
                        target = target == 'sanity' ? 'sanity' : 'regression'
                    } else {
                        if (target.startsWith('-') ||
                            target.contains('..') ||
                            !(target ==~ /[A-Za-z0-9_./-]+\\.spec\\.(js|ts|mjs|cjs)/)) {
                            error("Invalid spec path: ${target}")
                        }
                    }

                    def args = [
                        'npx', 'playwright', 'test', target,
                        "--project=${params.BROWSER}"
                    ]

                    if (params.HEADED) {
                        args.add('--headed')
                    }

                    withEnv([
                        "PLAYWRIGHT_ARGS=${args.collect { "'${it.replace("'", "'\\''")}'" }.join(' ')}"
                    ]) {
                        sh '''
                            set -e
                            eval "set -- $PLAYWRIGHT_ARGS"
                            "$@"
                        '''
                    }
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts(
                artifacts: 'test-results/**, playwright-report/**, allure-results/**, allure-report/**',
                allowEmptyArchive: true
            )

            script {
                if (fileExists('allure-results') &&
                    !fileExists('allure-results/.gitkeep')) {
                    allure([
                        includeProperties: false,
                        jdk: '',
                        results: [[path: 'allure-results']]
                    ])
                } else {
                    echo 'Allure results directory is missing or empty; skipping Allure report generation.'
                }

                if (fileExists('playwright-report/index.html')) {
                    publishHTML([
                        reportDir: 'playwright-report',
                        reportFiles: 'index.html',
                        reportName: 'Playwright HTML Report',
                        keepAll: true,
                        alwaysLinkToLastBuild: true,
                        allowMissing: true
                    ])
                } else {
                    echo 'Playwright HTML report was not generated; skipping HTML publishing.'
                }
            }
        }
    }
}
```