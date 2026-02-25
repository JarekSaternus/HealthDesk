#!/bin/bash
# Deploy HealthDesk landing page to VPS
# Run on the VPS as root (or with sudo)

set -e

LANDING_DIR="/opt/healthdesk-landing"
NGINX_CONF="/etc/nginx/sites-enabled/healthdesk-landing"

echo "=== 1. Creating landing directory ==="
mkdir -p "$LANDING_DIR"

echo "=== 2. Copying landing files ==="
# Run this from the directory containing landing files, or adjust path
# cp landing/* "$LANDING_DIR/"
echo "  -> Upload landing/ contents to $LANDING_DIR"
echo "  -> Make sure these files exist:"
echo "     - index.html"
echo "     - privacy.html"
echo "     - style.css"
echo "     - logo-color.svg"
echo "     - logo-white.svg"
echo "     - og-image.png"
echo "     - sitemap.xml"
echo "     - robots.txt"
echo "     - HealthDesk_Setup.exe (or use GitHub Releases link)"

echo ""
echo "=== 3. SSL Certificate ==="
echo "  Run: certbot certonly --webroot -w /var/www/html -d healthdesk.site -d www.healthdesk.site"
echo ""
echo "  If DNS not yet pointing to this server:"
echo "  1. Add A records in your DNS provider:"
echo "     healthdesk.site     -> YOUR_VPS_IP"
echo "     www.healthdesk.site -> YOUR_VPS_IP"
echo "  2. Wait for propagation (5-30 min)"
echo "  3. Then run certbot command above"

echo ""
echo "=== 4. Nginx config ==="
cp server/deploy/nginx-healthdesk-landing.conf "$NGINX_CONF"
nginx -t && systemctl reload nginx
echo "  -> Nginx reloaded"

echo ""
echo "=== 5. Verify ==="
echo "  curl -I https://healthdesk.site"
echo "  curl -I https://www.healthdesk.site"
echo ""
echo "Done!"
