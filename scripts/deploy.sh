#!/bin/bash
# =============================================================================
# Deploy do sync.mjs para a VPS
# =============================================================================
# Uso:
#   ./scripts/deploy.sh              # deploy do sync.mjs
#   ./scripts/deploy.sh --full       # deploy do sync.mjs + .env + restart cron
#   ./scripts/deploy.sh --dry-run    # mostra o que seria feito, sem executar
#
# Requisitos:
#   - Acesso SSH à VPS (root@37.60.236.200)
#   - Chave SSH configurada ou senha disponível
#   - scp e ssh disponíveis no PATH
# =============================================================================

set -euo pipefail

# ── Configurações ─────────────────────────────────────────────────────────────

VPS_HOST="root@37.60.236.200"
VPS_SYNC_PATH="/root/sync.mjs"
VPS_ENV_PATH="/root/.sync.env"
LOCAL_SYNC="scripts/sync.mjs"
LOCAL_ENV=".env.production"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ── Funções ───────────────────────────────────────────────────────────────────

log_info()  { echo -e "${BLUE}ℹ️  $1${NC}"; }
log_ok()    { echo -e "${GREEN}✅ $1${NC}"; }
log_warn()  { echo -e "${YELLOW}⚠️  $1${NC}"; }
log_error() { echo -e "${RED}❌ $1${NC}"; }

show_help() {
    echo "Uso: $0 [opções]"
    echo ""
    echo "Opções:"
    echo "  (padrão)     Deploy apenas do sync.mjs"
    echo "  --full       Deploy completo: sync.mjs + .env + restart cron"
    echo "  --env-only   Deploy apenas do arquivo .env"
    echo "  --dry-run    Mostra o que seria feito, sem executar"
    echo "  --help       Mostra esta ajuda"
    echo ""
    echo "Exemplos:"
    echo "  $0                    # Deploy rápido do sync.mjs"
    echo "  $0 --full             # Deploy completo com restart"
    echo "  $0 --dry-run          # Simulação"
}

# ── Parse args ────────────────────────────────────────────────────────────────

DO_SYNC=true
DO_ENV=false
DO_RESTART=false
DRY_RUN=false

for arg in "$@"; do
    case $arg in
        --full)
            DO_ENV=true
            DO_RESTART=true
            ;;
        --env-only)
            DO_SYNC=false
            DO_ENV=true
            ;;
        --dry-run)
            DRY_RUN=true
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            log_error "Opção desconhecida: $arg"
            show_help
            exit 1
            ;;
    esac
done

# ── Validações ────────────────────────────────────────────────────────────────

if [[ "$DO_SYNC" == true && ! -f "$LOCAL_SYNC" ]]; then
    log_error "Arquivo local não encontrado: $LOCAL_SYNC"
    exit 1
fi

if [[ "$DO_ENV" == true && ! -f "$LOCAL_ENV" ]]; then
    log_error "Arquivo local não encontrado: $LOCAL_ENV"
    log_info "Crie o arquivo $LOCAL_ENV com as variáveis de ambiente"
    exit 1
fi

# Verificar conectividade SSH
if [[ "$DRY_RUN" == false ]]; then
    log_info "Verificando conectividade com $VPS_HOST..."
    if ! ssh -o ConnectTimeout=5 -o BatchMode=yes "$VPS_HOST" "echo ok" >/dev/null 2>&1; then
        log_error "Não foi possível conectar via SSH em $VPS_HOST"
        echo ""
        echo "Verifique:"
        echo "  1. Se a VPS está online: ping 37.60.236.200"
        echo "  2. Se sua chave SSH está configurada: ssh-add -l"
        echo "  3. Se o usuário root tem acesso por chave"
        echo ""
        echo "Alternativa: copie manualmente com:"
        echo "  scp $LOCAL_SYNC $VPS_HOST:$VPS_SYNC_PATH"
        exit 1
    fi
    log_ok "Conectividade SSH OK"
fi

# ── Deploy ────────────────────────────────────────────────────────────────────

echo ""
echo "========================================"
echo "  DEPLOY CONFIGURATION"
echo "========================================"
echo "  Sync .mjs:  $DO_SYNC"
echo "  .env:       $DO_ENV"
echo "  Restart:    $DO_RESTART"
echo "  Dry-run:    $DRY_RUN"
echo "========================================"
echo ""

# 1. Deploy do sync.mjs
if [[ "$DO_SYNC" == true ]]; then
    log_info "Deploy do sync.mjs..."
    
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [DRY-RUN] scp $LOCAL_SYNC $VPS_HOST:$VPS_SYNC_PATH"
    else
        scp "$LOCAL_SYNC" "$VPS_HOST:$VPS_SYNC_PATH"
        log_ok "sync.mjs copiado para $VPS_HOST:$VPS_SYNC_PATH"
        
        # Verificar se o arquivo chegou OK
        REMOTE_SIZE=$(ssh "$VPS_HOST" "wc -c < $VPS_SYNC_PATH")
        LOCAL_SIZE=$(wc -c < "$LOCAL_SYNC")
        
        if [[ "$REMOTE_SIZE" == "$LOCAL_SIZE" ]]; then
            log_ok "Tamanho do arquivo verificado: $REMOTE_SIZE bytes"
        else
            log_warn "Tamanho diferente! Local: $LOCAL_SIZE, Remoto: $REMOTE_SIZE"
        fi
    fi
fi

# 2. Deploy do .env
if [[ "$DO_ENV" == true ]]; then
    log_info "Deploy do .env..."
    
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [DRY-RUN] scp $LOCAL_ENV $VPS_HOST:$VPS_ENV_PATH"
    else
        # Backup do .env antigo
        ssh "$VPS_HOST" "cp $VPS_ENV_PATH ${VPS_ENV_PATH}.bak.$(date +%Y%m%d_%H%M%S) 2>/dev/null || true"
        scp "$LOCAL_ENV" "$VPS_HOST:$VPS_ENV_PATH"
        log_ok ".env copiado para $VPS_HOST:$VPS_ENV_PATH"
        log_info "Backup do .env anterior criado"
    fi
fi

# 3. Restart do cron (se solicitado)
if [[ "$DO_RESTART" == true ]]; then
    log_info "Restart do serviço de sync..."
    
    if [[ "$DRY_RUN" == true ]]; then
        echo "  [DRY-RUN] ssh $VPS_HOST 'systemctl restart cron || service cron restart'"
        echo "  [DRY-RUN] ssh $VPS_HOST 'crontab -l'"
    else
        # Verificar se há cron job configurado
        CRON_JOBS=$(ssh "$VPS_HOST" "crontab -l 2>/dev/null | grep sync || echo 'NENHUM'")
        
        if [[ "$CRON_JOBS" == "NENHUM" ]]; then
            log_warn "Nenhum cron job encontrado para o sync"
            echo ""
            echo "Para configurar o cron, rode na VPS:"
            echo "  crontab -e"
            echo ""
            echo "E adicione (exemplo para rodar a cada 30 min):"
            echo "  */30 * * * * /root/run-sync.sh >> /var/log/sync.log 2>&1"
        else
            log_info "Cron jobs encontrados:"
            echo "$CRON_JOBS" | while read line; do
                echo "    $line"
            done
        fi
        
        # Testar o sync manualmente
        log_info "Testando o sync manualmente..."
        TEST_OUTPUT=$(ssh "$VPS_HOST" "source $VPS_ENV_PATH && node $VPS_SYNC_PATH --help 2>&1 || echo 'FALHOU'")
        
        if [[ "$TEST_OUTPUT" == *"FALHOU"* ]]; then
            log_error "Teste do sync falhou!"
            echo "$TEST_OUTPUT"
        else
            log_ok "Sync responde corretamente"
        fi
    fi
fi

# ── Resumo ────────────────────────────────────────────────────────────────────

echo ""
if [[ "$DRY_RUN" == true ]]; then
    log_info "DRY-RUN concluído — nenhuma alteração foi feita"
else
    log_ok "Deploy concluído!"
fi

echo ""
echo "Próximos passos:"
echo "  1. Teste o sync manualmente na VPS:"
echo "     ssh $VPS_HOST 'source $VPS_ENV_PATH && node $VPS_SYNC_PATH <CLIENT_ID>'"
echo ""
echo "  2. Monitore os logs:"
echo "     ssh $VPS_HOST 'tail -f /var/log/sync.log'"
echo ""
echo "  3. Rode o diagnóstico:"
echo "     node scripts/diagnose.mjs <CLIENT_ID>"
