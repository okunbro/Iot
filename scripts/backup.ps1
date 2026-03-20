$timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$backupDir = ".\backups\$timestamp"

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

Copy-Item ".\docker-compose.yml" $backupDir -Force
Copy-Item ".\.env" $backupDir -Force

Copy-Item ".\openhab\conf" "$backupDir\openhab-conf" -Recurse -Force

New-Item -ItemType Directory -Path "$backupDir\openhab-userdata" -Force | Out-Null
Copy-Item ".\openhab\userdata\jsondb" "$backupDir\openhab-userdata\jsondb" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item ".\openhab\userdata\persistence" "$backupDir\openhab-userdata\persistence" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item ".\openhab\userdata\secrets" "$backupDir\openhab-userdata\secrets" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item ".\openhab\userdata\etc" "$backupDir\openhab-userdata\etc" -Recurse -Force -ErrorAction SilentlyContinue

Copy-Item ".\mosquitto\config" "$backupDir\mosquitto-config" -Recurse -Force
Copy-Item ".\influxdb\data" "$backupDir\influxdb-data" -Recurse -Force
Copy-Item ".\grafana\provisioning" "$backupDir\grafana-provisioning" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item ".\grafana\data" "$backupDir\grafana-data" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Backup created successfully: $backupDir"