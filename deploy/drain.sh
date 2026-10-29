#!/bin/bash
set -euo pipefail
# Run as root: sudo bash deploy/drain.sh demo.example.com
domain=${1:?Supply the configured HTTPS hostname}
[[ $domain =~ ^[A-Za-z0-9][A-Za-z0-9.-]+$ ]] || exit 2
[[ $EUID -eq 0 ]] || { echo 'Run this procedure with sudo.' >&2; exit 2; }
touch /etc/nginx/agenticefi-maintenance
# Verify the active proxy really blocks canonical and trailing-slash start routes.
# No auth/header secrets; empty bodies cannot start investigations even on misconfiguration.
for route in /api/investigations /api/investigations/; do
    status=$(curl --silent --show-error --max-time 10 --resolve "$domain:443:127.0.0.1" \
        --output /dev/null --write-out '%{http_code}' -X POST -H 'Content-Type: application/json' \
        --data '{}' "https://$domain$route")
    [[ $status == 503 ]] || { echo 'Maintenance gate not verified; do NOT stop the service.' >&2; exit 1; }
done
echo 'New starts blocked. Existing polling, cancellation and downloads remain available.'
echo 'Waiting 330 seconds: legacy 300-second deadline plus cleanup margin.'
for ((i=330; i>0; i-=30)); do echo "Drain wait: $i seconds remaining"; sleep 30; done
echo 'Check known job statuses/diagnostics before stopping; the wait is not an active-job census.'
echo 'Maintenance remains ON. Remove its flag only after deployment or rollback verification.'
