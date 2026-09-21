
export interface McpOAuthEntry {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface TrangThaiAuthMcp {
  authed: boolean | null;
  needsAuth: boolean;
  hasToken: boolean;
  hasRefresh: boolean;
  expiresAt: number | null;
  secondsLeft: number | null;
  flaggedNeedsAuth: boolean;
  khongXacDinh: boolean;
}

function khopDrjoy(key: string): boolean {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '').includes('drjoy');
}

export function tinhTrangThaiAuthMcp(input: {
  oauth?: Record<string, McpOAuthEntry> | null;
  needsAuthCache?: Record<string, unknown> | null;
  now?: number;
}): TrangThaiAuthMcp {
  const oauth = input.oauth || {};
  const cache = input.needsAuthCache || {};
  const now = input.now ?? Date.now();

  const key = Object.keys(oauth).find(khopDrjoy);
  const entry = key ? oauth[key] : null;
  const flaggedNeedsAuth = Object.keys(cache).some(khopDrjoy);

  const hasToken = Boolean(entry?.accessToken);
  const hasRefresh = Boolean(entry?.refreshToken);
  const expiresAt = typeof entry?.expiresAt === 'number' ? entry.expiresAt : null;
  const secondsLeft = expiresAt ? Math.round((expiresAt - now) / 1000) : null;

  if (!entry) {
    return {
      authed: null, needsAuth: false, hasToken: false, hasRefresh: false,
      expiresAt: null, secondsLeft: null, flaggedNeedsAuth, khongXacDinh: true
    };
  }

  const needsAuth = !hasToken || (flaggedNeedsAuth && !hasRefresh);
  return {
    authed: !needsAuth, needsAuth, hasToken, hasRefresh, expiresAt, secondsLeft,
    flaggedNeedsAuth, khongXacDinh: false
  };
}
