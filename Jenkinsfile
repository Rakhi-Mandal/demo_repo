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
        powershell 'npm ci'
        powershell 'npx playwright install'
      }
    }

    stage('Prepare Dynamic Test Data') {
      steps {
        powershell '''
          if ($env:QUALIBRIX_API_URL -and $env:PROJECT_ID) {
            # Each spec owns a companion data file.  Generate a separate
            # payload for every file so equal field names never share a value.
            $dataFiles = @(Get-ChildItem -Path . -Recurse -File -Filter "*.test-data.json")
            if (Test-Path "test-data.json") { $dataFiles += Get-Item "test-data.json" }
            foreach ($dataFile in $dataFiles) {
              $basePayload = Get-Content $dataFile.FullName -Raw | ConvertFrom-Json
              $request = @{ projectId = $env:PROJECT_ID; payload = $basePayload } | ConvertTo-Json -Depth 50
              $response = Invoke-RestMethod -Uri ($env:QUALIBRIX_API_URL.TrimEnd('/') + '/api/projects/dynamic-test-data') -Method Post -ContentType 'application/json' -Body $request
              $response.payload | ConvertTo-Json -Depth 50 | Set-Content $dataFile.FullName -Encoding UTF8
              Write-Host "Applied DB-backed dynamic test-data fields to $($dataFile.FullName)."
            }
          } else {
            Write-Host "Dynamic test-data preparation skipped: QUALIBRIX_API_URL or PROJECT_ID is missing."
          }
        '''
      }
    }

    stage('Run Tests') {
      steps {
        script {
          def headedArg = params.HEADED ? '--headed' : ''
          def browserArg = '--project=' + params.BROWSER
          def suiteTarget = params.TARGET.trim()
          def target = params.EXECUTION_MODE == 'suite'
              ? (suiteTarget == 'sanity' ? 'sanity' : 'regression')
              : suiteTarget
          def command = 'npx playwright test "' + target + '" ' + browserArg
          if (headedArg) {
            command = command + ' ' + headedArg
          }
          powershell(command)
        }
      }
    }
  }

  post {
    always {
      archiveArtifacts artifacts: 'test-results/**, playwright-report/**, allure-results/**, allure-report/**', allowEmptyArchive: true
      allure([
        includeProperties: false,
        jdk: '',
        results: [[path: 'allure-results']]
      ])
      publishHTML([
        reportDir: 'playwright-report',
        reportFiles: 'index.html',
        reportName: 'Playwright HTML Report',
        keepAll: true,
        alwaysLinkToLastBuild: true,
        allowMissing: true
      ])
    }
  }
}
