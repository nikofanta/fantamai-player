# FantaMai Player - Version Update Script
# Usage: .\update-version.ps1 3.3.21

param(
    [Parameter(Mandatory=$true)]
    [string]$NewVersion
)

Write-Host "Updating FantaMai Player to version $NewVersion..." -ForegroundColor Cyan

# Validate version format (X.X.XX)
if ($NewVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Host "Error: Version must be in format X.X.XX (e.g., 3.3.20)" -ForegroundColor Red
    exit 1
}

# Get current directory
$rootPath = $PSScriptRoot

# File paths
$files = @{
    "script.js" = "$rootPath\script.js"
    "sw.js" = "$rootPath\sw.js"
    "manifest.json" = "$rootPath\manifest.json"
    "index.html" = "$rootPath\index.html"
}

# Backup flag
$backupCreated = $false

try {
    # Update script.js
    Write-Host "Updating script.js..." -ForegroundColor Yellow
    $content = Get-Content $files["script.js"] -Raw
    $content = $content -replace 'const APP_VERSION = "[\d\.]+";', "const APP_VERSION = `"$NewVersion`";"
    Set-Content -Path $files["script.js"] -Value $content -NoNewline
    
    # Update sw.js
    Write-Host "Updating sw.js..." -ForegroundColor Yellow
    $content = Get-Content $files["sw.js"] -Raw
    $content = $content -replace 'const CACHE_NAME = "fantamai-cache-v[\d\.]+";', "const CACHE_NAME = `"fantamai-cache-v$NewVersion`";"
    $content = $content -replace 'const APP_VERSION = "[\d\.]+";', "const APP_VERSION = `"$NewVersion`";"
    Set-Content -Path $files["sw.js"] -Value $content -NoNewline
    
    # Update manifest.json
    Write-Host "Updating manifest.json..." -ForegroundColor Yellow
    $content = Get-Content $files["manifest.json"] -Raw
    $content = $content -replace '"version": "[\d\.]+"', "`"version`": `"$NewVersion`""
    $content = $content -replace '"start_url": "\./index\.html\?v=[\d\.]+"', "`"start_url`": `"./index.html?v=$NewVersion`""
    Set-Content -Path $files["manifest.json"] -Value $content -NoNewline
    
    # Update index.html
    Write-Host "Updating index.html..." -ForegroundColor Yellow
    $content = Get-Content $files["index.html"] -Raw
    $content = $content -replace '<meta name="version" content="[\d\.]+"', "<meta name=`"version`" content=`"$NewVersion`""
    $content = $content -replace '<title>FantaMai Player v[\d\.]+</title>', "<title>FantaMai Player v$NewVersion</title>"
    $content = $content -replace '<small>v<span id="appVersion">[\d\.]+</span></small>', "<small>v<span id=`"appVersion`">$NewVersion</span></small>"
    Set-Content -Path $files["index.html"] -Value $content -NoNewline
    
    Write-Host "`n✅ Version updated successfully to $NewVersion in all files!" -ForegroundColor Green
    Write-Host "`nUpdated files:" -ForegroundColor Cyan
    Write-Host "  - script.js (APP_VERSION)" -ForegroundColor Gray
    Write-Host "  - sw.js (CACHE_NAME, APP_VERSION)" -ForegroundColor Gray
    Write-Host "  - manifest.json (version, start_url)" -ForegroundColor Gray
    Write-Host "  - index.html (meta, title, footer)" -ForegroundColor Gray
    
    Write-Host "`nNext steps:" -ForegroundColor Cyan
    Write-Host "  1. Review changes: git diff" -ForegroundColor Gray
    Write-Host "  2. Commit: git add . && git commit -m `"v$NewVersion`"" -ForegroundColor Gray
    Write-Host "  3. Push: git push" -ForegroundColor Gray
    Write-Host "  4. Clear PWA cache on mobile and reinstall" -ForegroundColor Gray
    
} catch {
    Write-Host "`n❌ Error updating version: $_" -ForegroundColor Red
    exit 1
}
