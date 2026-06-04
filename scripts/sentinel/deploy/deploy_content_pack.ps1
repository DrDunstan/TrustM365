param(
  [Parameter(Mandatory = $true)]
  [string]$SubscriptionId,

  [Parameter(Mandatory = $true)]
  [string]$ResourceGroup,

  [Parameter(Mandatory = $true)]
  [string]$WorkspaceName,

  [Parameter(Mandatory = $false)]
  [string]$TablePrefix = 'TrustM365'
)

$ErrorActionPreference = 'Stop'

Write-Host 'Setting Azure subscription context...'
az account set --subscription $SubscriptionId | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Failed to set Azure subscription context for '$SubscriptionId'."
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..\..')
$rulesPath = Join-Path $root 'data\sentinel\analytics-rules'

if (-not (Test-Path $rulesPath)) {
  throw "Analytics rules path not found: $rulesPath"
}

$ruleFiles = Get-ChildItem -Path $rulesPath -Filter '*.json' -File
if ($ruleFiles.Count -eq 0) {
  throw 'No analytic rule templates found to deploy.'
}

foreach ($file in $ruleFiles) {
  Write-Host "Deploying rule template: $($file.Name)"

  $template = Get-Content -Path $file.FullName -Raw
  $template = $template.Replace('{TablePrefix}', $TablePrefix)

  $tempFile = [System.IO.Path]::GetTempFileName() + '.json'
  Set-Content -Path $tempFile -Value $template -Encoding UTF8

  az deployment group create `
    --resource-group $ResourceGroup `
    --template-file $tempFile `
    --parameters workspace=$WorkspaceName tablePrefix=$TablePrefix | Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw "Deployment failed for rule template '$($file.Name)'."
  }

  Remove-Item $tempFile -Force
}

Write-Host 'Sentinel analytic rules deployment completed.'
Write-Host 'Workbook deployment is currently manual using the JSON in data/sentinel/workbooks.'
