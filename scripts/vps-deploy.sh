#!/bin/bash
# =============================================================================
# VPS DEPLOY HELPER - Gera comandos para atualizar sync.mjs na VPS
# =============================================================================
# Uso local:
#   ./scripts/vps-deploy.sh
#
# Isso gera um arquivo scripts/vps-install.sh que você copia para a VPS e executa.
# =============================================================================

set -euo pipefail

LOCAL_SYNC="scripts/sync.mjs"
OUTPUT="scripts/vps-install.sh"

if [ ! -f "$LOCAL_SYNC" ]; then
    echo "❌ Arquivo não encontrado: $LOCAL_SYNC"
    exit 1
fi

echo "🔧 Gerando $OUTPUT..."

cat > "$OUTPUT" << 'HEADER'
#!/bin/bash
# Auto-generated VPS install script
# Generated at: 
set -e

echo "📦 Instalando sync.mjs..."

cat > /root/sync.mjs << 'SYNC_EOF'
HEADER

# Append the actual sync.mjs content
cat "$LOCAL_SYNC" >> "$OUTPUT"

cat >> "$OUTPUT" << 'FOOTER'
SYNC_EOF

chmod +x /root/sync.mjs
echo "✅ sync.mjs instalado ($(wc -c < /root/sync.mjs) bytes)"

# Test if .sync.env exists
if [ ! -f /root/.sync.env ]; then
    echo "⚠️  /root/.sync.env não encontrado!"
    echo "   Crie este arquivo com:"
    echo "   DATABASE_URL=..."
    echo "   PLUGGY_CLIENT_ID=..."
    echo "   PLUGGY_CLIENT_SECRET=..."
fi

# Quick syntax check
if command -v node &> /dev/null; then
    node --check /root/sync.mjs && echo "✅ Sintaxe OK" || echo "❌ Erro de sintaxe"
fi
FOOTER

chmod +x "$OUTPUT"

echo ""
echo "✅ $OUTPUT gerado com sucesso!"
echo ""
echo "Próximos passos:"
echo "  1. Copie para a VPS:"
echo "     scp $OUTPUT root@37.60.236.200:/tmp/"
echo ""
echo "  2. Na VPS, execute:"
echo "     ssh root@37.60.236.200"
echo "     bash /tmp/vps-install.sh"
echo ""
echo "  3. Teste o sync:"
echo "     source /root/.sync.env"
echo "     node /root/sync.mjs <CLIENT_ID>"
echo ""
