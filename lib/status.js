// Centraliza a normalização e decisões de status de itens Pluggy.
// Evita duplicação da lógica entre cron, webhooks, dashboard e scripts.

export function normalizeItemStatus(pluggyItem) {
  if (!pluggyItem) {
    return {
      status: 'UNKNOWN',
      executionStatus: null,
      errorCode: null,
      errorMessage: null,
      lastUpdatedAt: null,
      consentExpiresAt: null,
    };
  }

  return {
    status: pluggyItem.status ?? 'UNKNOWN',
    executionStatus: pluggyItem.executionStatus ?? null,
    errorCode: pluggyItem.error?.code ?? null,
    errorMessage: pluggyItem.error?.message ?? pluggyItem.error?.providerMessage ?? null,
    lastUpdatedAt: pluggyItem.lastUpdatedAt ?? null,
    consentExpiresAt: pluggyItem.consentExpiresAt ?? null,
  };
}

export function isItemHealthy(status) {
  return status === 'UPDATED' || status === 'PARTIAL_SUCCESS';
}

export function isItemUpdating(status) {
  return status === 'UPDATING';
}

export function isItemError(status) {
  return status === 'ERROR' || status === 'LOGIN_ERROR' || status === 'OUTDATED';
}

export function requiresReconnectFromError(errorCode) {
  if (!errorCode) return false;
  const codes = [
    'INVALID_CREDENTIALS',
    'USER_AUTHORIZATION_NOT_GRANTED',
    'USER_AUTHORIZATION_REVOKED',
    'ACCOUNT_LOCKED',
    'ACCOUNT_NEEDS_ACTION',
    'USER_INPUT_TIMEOUT',
  ];
  return codes.includes(errorCode);
}

export function buildItemStatusUpdates(pluggyItem, { forceError = false } = {}) {
  const norm = normalizeItemStatus(pluggyItem);
  const needsReconnect =
    forceError ||
    requiresReconnectFromError(norm.errorCode) ||
    norm.status === 'LOGIN_ERROR';

  const updates = {
    status: norm.status,
    executionStatus: norm.executionStatus,
    errorCode: norm.errorCode,
    errorMessage: norm.errorMessage,
    lastUpdatedAt: norm.lastUpdatedAt,
    consentExpiresAt: norm.consentExpiresAt,
    requiresReconnect: needsReconnect,
    incrementSyncCount: true,
  };

  if (isItemHealthy(norm.status)) {
    updates.resetConsecutiveErrors = true;
  } else if (isItemError(norm.status)) {
    updates.incrementConsecutiveErrors = true;
    updates.lastErrorAt = new Date().toISOString();
  }

  return updates;
}
