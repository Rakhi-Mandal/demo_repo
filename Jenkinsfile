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
 
        choice(
            name: 'EXECUTION',
            choices: ['parallel', 'sequential'],
            description: 'parallel = multiple workers, sequential = one worker'
        )
 
        string(
            name: 'WORKERS',
            defaultValue: '4',
            description: 'Number of parallel workers'
        )
 
        string(
            name: 'TARGET',
            defaultValue: 'regression',
            description: 'For suite mode use sanity/regression. For spec mode provide spec path.'
        )
    }
 
    stages {
 
        stage('Clean Workspace') {
            steps {
                cleanWs()
                checkout scm
            }
        }
 
        stage('Environment Check') {
            steps {
                sh '''
                    set -e
 
                    echo "===== Environment ====="
 
                    node --version
                    npm --version
                    git --version
                    playwright --version
                    google-chrome --version
                    allure --version
 
                    echo "======================="
                '''
            }
        }
 
        stage('Install Dependencies') {
            steps {
                sh '''
                    set -e
 
                    npm ci
 
                    PLAYWRIGHT_BROWSERS_PATH=/opt/playwright/ms-playwright \
                    npx playwright install --with-deps
                '''
            }
        }
 
        stage('Run Tests') {
            steps {
                script {
 
                    def headedArg = params.HEADED ? '--headed' : ''
 
                    def browserArg = "--project=${params.BROWSER}"
 
                    def workersArg = params.EXECUTION == 'sequential'
                        ? '--workers=1'
                        : "--workers=${params.WORKERS.trim()}"
 
                    def suiteTarget = params.TARGET.trim()
 
                    def target = params.EXECUTION_MODE == 'suite'
                        ? (suiteTarget == 'sanity' ? 'sanity' : 'regression')
                        : suiteTarget
 
                    def command = "npx playwright test \"${target}\" ${browserArg} ${workersArg}"
 
                    if (headedArg) {
                        command += " ${headedArg}"
                    }
 
                    echo "======================================"
                    echo "EXECUTION MODE : ${params.EXECUTION_MODE}"
                    echo "TARGET         : ${target}"
                    echo "BROWSER        : ${params.BROWSER}"
                    echo "HEADED         : ${params.HEADED}"
                    echo "EXECUTION      : ${params.EXECUTION}"
                    echo "WORKERS        : ${params.WORKERS}"
                    echo "COMMAND        : ${command}"
                    echo "======================================"
 
                    catchError(buildResult: 'UNSTABLE', stageResult: 'FAILURE') {
 
                        sh """
                            set -e
 
                            PLAYWRIGHT_BROWSERS_PATH=/opt/playwright/ms-playwright
 
                            ${command}
                        """
                    }
                }
            }
        }
 
        stage('Generate Allure Report') {
            steps {
                sh '''
                    set -e
 
                    if [ -d "allure-results" ]; then
                        allure generate allure-results \
                            -o allure-report \
                            --clean
 
                        echo "Allure report generated."
                    else
                        echo "No allure-results directory found."
                    fi
                '''
            }
        }
 
        stage('Publish Allure Report') {
            when {
                expression {
                    fileExists('allure-results')
                }
            }
 
            steps {
                allure(
                    includeProperties: false,
                    jdk: '',
                    results: [[path: 'allure-results']]
                )
            }
        }
    }
 
    post {
 
        always {
 
            archiveArtifacts(
                artifacts: 'test-results/**,playwright-report/**,allure-results/**,allure-report/**',
                allowEmptyArchive: true
            )
        }
    }
}