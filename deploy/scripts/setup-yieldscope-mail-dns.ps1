#Requires -Version 5.1
<#
.SYNOPSIS
  Upsert YieldScope mail DNS on d3bu7.com via IONOS Hosting DNS API.
.DESCRIPTION
  Records: A mail.yieldscope, MX yieldscope, SPF, DKIM (mail._domainkey.yieldscope), DMARC.
  Loads IONOS_API_KEY + IONOS_API_SECRET from Obsevia/klaut/majico .env.local (never commit).
#>
param(
  [string]$Zone = "d3bu7.com",
  [string]$EdgeIp = "77.23.124.82",
  [string]$MailHost = "mail.yieldscope.d3bu7.com",
  [string]$MailDomain = "yieldscope.d3bu7.com",
  [string]$DkimFile = "",
  [int]$Ttl = 300,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
if (-not $DkimFile) {
  $DkimFile = Join-Path $RepoRoot "deploy\k8s\yieldscope-mail\dkim-public.txt"
}

function Get-EnvValue([string]$File, [string]$Key) {
  if (-not (Test-Path $File)) { return $null }
  foreach ($line in Get-Content $File -Encoding UTF8) {
    if ($line -match "^\s*#") { continue }
    if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)\s*$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

$candidates = @(
  (Join-Path $env:USERPROFILE "Documents\Programming\Obsevia\.env.local"),
  (Join-Path $env:USERPROFILE "Documents\Programming\Obsevia\.env"),
  (Join-Path $env:USERPROFILE "Documents\Programming\klaut.pro\.env.local"),
  (Join-Path $env:USERPROFILE "Documents\Programming\majico\majico.xyz\.env.local")
)

$apiKey = $env:IONOS_API_KEY
$apiSecret = $env:IONOS_API_SECRET
if (-not $apiKey -or -not $apiSecret) {
  foreach ($f in $candidates) {
    $k = Get-EnvValue $f "IONOS_API_KEY"
    $s = Get-EnvValue $f "IONOS_API_SECRET"
    if ($k -and $s) {
      $apiKey = $k
      $apiSecret = $s
      Write-Host "Loaded IONOS credentials from $f"
      break
    }
    if ($k -match '\.' -and -not $s) {
      $apiKey = $k
      $apiSecret = $null
      Write-Host "Loaded combined IONOS_API_KEY from $f"
      break
    }
  }
}

if (-not $apiKey) { throw "IONOS_API_KEY missing (checked Obsevia/klaut/majico .env files)" }
$xApiKey = if ($apiSecret) { "$apiKey.$apiSecret" } else { $apiKey }

$headers = @{
  "X-API-Key"    = $xApiKey
  "Accept"       = "application/json"
  "Content-Type" = "application/json"
}

function Invoke-Ionos([string]$Method, [string]$Path, [object]$Body = $null) {
  $uri = "https://api.hosting.ionos.com/dns/v1$Path"
  if ($DryRun) {
    Write-Host "[dry-run] $Method $uri"
    if ($Body) { Write-Host ($Body | ConvertTo-Json -Compress -Depth 5) }
    return $null
  }
  if ($Body) {
    $json = ConvertTo-Json -InputObject $Body -Depth 5 -Compress
    return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers -Body $json
  }
  return Invoke-RestMethod -Method $Method -Uri $uri -Headers $headers
}

function Ensure-Record([string]$ZoneId, [string]$Name, [string]$Type, [string]$Content, [int]$Ttl = 3600, [int]$Prio = -1) {
  $zoneDetail = Invoke-Ionos GET "/zones/$ZoneId"
  $existing = @($zoneDetail.records) | Where-Object { $_.name -eq $Name -and $_.type -eq $Type }
  foreach ($rec in $existing) {
    $same = ($rec.content -eq $Content)
    if ($Type -eq "MX" -and $Prio -ge 0 -and $rec.prio -ne $Prio) { $same = $false }
    if ($same) {
      Write-Host "keep $Type $Name -> $Content"
      return
    }
    Write-Host "delete $Type $Name id=$($rec.id) content=$($rec.content)"
    try { Invoke-Ionos DELETE "/zones/$ZoneId/records/$($rec.id)" | Out-Null } catch {
      Write-Host "warn: delete failed: $_"
    }
  }
  Write-Host "create $Type $Name -> $Content$(if ($Prio -ge 0) { " prio=$Prio" } else { '' })"
  $bodyObj = [ordered]@{
    name     = $Name
    type     = $Type
    content  = $Content
    ttl      = $Ttl
    disabled = $false
  }
  if ($Type -eq "MX" -and $Prio -ge 0) {
    $bodyObj["prio"] = $Prio
  }
  Invoke-Ionos POST "/zones/$ZoneId/records" @($bodyObj) | Out-Null
}

function Get-DkimTxt([string]$Path) {
  if (-not (Test-Path $Path)) { return $null }
  $raw = Get-Content $Path -Raw
  # DMS mail.txt often looks like: mail._domainkey IN TXT ( "v=DKIM1; ..." "..." )
  if ($raw -match 'v=DKIM1[^"]*') {
    $parts = [regex]::Matches($raw, '"([^"]+)"') | ForEach-Object { $_.Groups[1].Value }
    if ($parts.Count -gt 0) { return ($parts -join '') }
  }
  $line = ($raw -split "`n" | Where-Object { $_ -match 'v=DKIM1' } | Select-Object -First 1)
  if ($line) {
    return ($line -replace '.*"(v=DKIM1[^"]*)".*', '$1').Trim()
  }
  return $null
}

$zones = Invoke-Ionos GET "/zones"
$zoneObj = $zones | Where-Object { $_.name -eq $Zone } | Select-Object -First 1
if (-not $zoneObj) { throw "Zone $Zone not found" }
$zoneId = $zoneObj.id

Ensure-Record -ZoneId $zoneId -Name $MailHost -Type "A" -Content $EdgeIp -Ttl $Ttl
Ensure-Record -ZoneId $zoneId -Name $MailDomain -Type "MX" -Content "${MailHost}." -Ttl 3600 -Prio 10
Ensure-Record -ZoneId $zoneId -Name $MailDomain -Type "TXT" -Content "v=spf1 ip4:$EdgeIp a:$MailHost mx -all" -Ttl 3600
Ensure-Record -ZoneId $zoneId -Name "_dmarc.$MailDomain" -Type "TXT" -Content "v=DMARC1; p=none; rua=mailto:noreply@$MailDomain" -Ttl 3600

$dkim = Get-DkimTxt $DkimFile
if ($dkim) {
  Ensure-Record -ZoneId $zoneId -Name "mail._domainkey.$MailDomain" -Type "TXT" -Content $dkim -Ttl 3600
  Write-Host "OK: mail DNS for $MailDomain (A/MX/SPF/DMARC/DKIM)"
} else {
  Write-Host "WARN: no DKIM public key at $DkimFile - skip mail._domainkey (rerun after mail apply)"
  Write-Host "OK: mail DNS for $MailDomain (A/MX/SPF/DMARC) - DKIM pending"
}
