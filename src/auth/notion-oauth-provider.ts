import { randomBytes } from 'node:crypto'
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js'
import { Client } from '@notionhq/client'
import { StatelessClientStore } from './stateless-client-store.js'

const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize'
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
const AUTH_CODE_TTL = 10 * 60 * 1000 // 10 minutes
const PENDING_AUTH_TTL = 10 * 60 * 1000 // 10 minutes
const NOTION_TOKEN_TTL = 24 * 60 * 60 * 1000 // 24 hours
const PENDING_BIND_TTL = 2 * 60 * 1000 // 2 minutes to claim a pending bind after OAuth
const VERIFY_CACHE_TTL = 5 * 60 * 1000 // 5 minutes cache for token verification

export interface NotionOAuthConfig {
  notionClientId: string
  notionClientSecret: string
  dcrSecret: string
  publicUrl: string
}

interface PendingAuth {
  clientRedirectUri: string
  clientState?: string
  codeChallenge: string
  codeChallengeMethod: string
  scopes?: string[]
  createdAt: number
}

interface StoredAuthCode {
  notionAccessToken: string
  notionRefreshToken?: string
  expiresIn?: number
  createdAt: number
}

interface StoredNotionToken {
  notionAccessToken: string
  createdAt: number
}

/**
 * Creates a ProxyOAuthServerProvider that delegates OAuth to Notion
 * with a callback relay pattern.
 *
 * The flow:
 * 1. MCP client registers via DCR (stateless HMAC)
 * 2. MCP client calls /authorize with their redirect_uri
 * 3. We redirect to Notion OAuth with OUR callback URL (not the client's)
 * 4. User authorizes on Notion → Notion redirects to our /callback
 * 5. We exchange Notion's code for a Notion token
 * 6. We issue our own auth code and redirect to the MCP client's redirect_uri
 * 7. MCP client calls /token with our auth code → we issue an opaque access token
 * 8. MCP client calls /mcp with Bearer token → we resolve to stored Notion token
 *
 * Notion tokens are stored server-side. The client never sees them directly.
 * This handles MCP clients (like Claude Code) that use their own identity tokens.
 */
export function createNotionOAuthProvider(config: NotionOAuthConfig) {
  const clientStore = new StatelessClientStore(config.dcrSecret)
  const callbackUrl = `${config.publicUrl}/callback`

  // Notion's token endpoint requires HTTP Basic auth with the integration's credentials
  const notionBasicAuth = Buffer.from(`${config.notionClientId}:${config.notionClientSecret}`).toString('base64')

  // Temporary stores for the callback relay
  const pendingAuths = new Map<string, PendingAuth>()
  const authCodes = new Map<string, StoredAuthCode>()

  // Server-side Notion token store — keyed by our opaque access token
  const notionTokens = new Map<string, StoredNotionToken>()
  // Bound external tokens — maps bearer token → Notion token (one-shot bind per OAuth)
  const boundTokens = new Map<string, StoredNotionToken>()
  // Verification cache — avoids calling Notion API on every request
  const verifyCache = new Map<string, { expiresAt: number; userId: string; userName: string | null }>()
  // Pending bind slots — one-shot: consumed on first use, keyed by client_id.
  // When a client completes OAuth, a pending bind is created. The first unknown bearer token
  // that claims it gets bound. This prevents cross-user token leaks on shared instances.
  const pendingBinds = new Map<string, { notionToken: StoredNotionToken; expiresAt: number }>()

  /** Resolve a bearer token to a Notion access token */
  function resolveNotionToken(bearerToken: string): string | undefined {
    // 1. Direct lookup by our opaque access token
    const byToken = notionTokens.get(bearerToken)
    if (byToken) return byToken.notionAccessToken

    // 2. If the token itself is a Notion token (starts with ntn_ or secret_), use directly
    if (bearerToken.startsWith('ntn_') || bearerToken.startsWith('secret_')) return bearerToken

    // 3. Previously bound external token (e.g., Claude Code's sk-ant-*)
    const bound = boundTokens.get(bearerToken)
    if (bound) return bound.notionAccessToken

    // 4. One-shot pending bind — claim the first available unexpired slot.
    // This is consumed immediately (one token per OAuth flow) to prevent
    // cross-user leaks. Only the first unknown token to arrive claims the bind.
    const now = Date.now()
    for (const [clientId, pending] of pendingBinds) {
      if (now > pending.expiresAt) {
        pendingBinds.delete(clientId)
        continue
      }
      // Consume the pending bind — one-shot, no other token can claim this
      pendingBinds.delete(clientId)
      boundTokens.set(bearerToken, pending.notionToken)
      return pending.notionToken.notionAccessToken
    }
    return undefined
  }

  const provider = new ProxyOAuthServerProvider({
    endpoints: {
      authorizationUrl: NOTION_AUTH_URL,
      tokenUrl: NOTION_TOKEN_URL
    },

    verifyAccessToken: async (token: string) => {
      const notionToken = resolveNotionToken(token)
      if (!notionToken) {
        throw new InvalidTokenError('No Notion token found. Please re-authenticate.')
      }

      // Check verification cache to avoid calling Notion API on every request
      const cached = verifyCache.get(notionToken)
      if (cached && Date.now() < cached.expiresAt) {
        return {
          token: notionToken,
          clientId: config.notionClientId,
          scopes: ['notion:read', 'notion:write'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: { userId: cached.userId, userName: cached.userName }
        }
      }

      try {
        const notion = new Client({ auth: notionToken, notionVersion: '2025-09-03' })
        const me = await notion.users.me({})

        // Cache the verification result
        verifyCache.set(notionToken, {
          expiresAt: Date.now() + VERIFY_CACHE_TTL,
          userId: me.id,
          userName: me.name
        })

        return {
          token: notionToken,
          clientId: config.notionClientId,
          scopes: ['notion:read', 'notion:write'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: { userId: me.id, userName: me.name }
        }
      } catch {
        // Remove stale cache entry if token became invalid
        verifyCache.delete(notionToken)
        throw new InvalidTokenError('Invalid or expired Notion token')
      }
    },

    getClient: async (clientId: string) => clientStore.getClient(clientId),

    // Inject Notion's Basic auth on token exchange requests
    fetch: async (url, init) => {
      const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.toString() : (url as { url: string }).url
      if (urlStr === NOTION_TOKEN_URL) {
        const headers = new Headers(init?.headers)
        headers.set('Authorization', `Basic ${notionBasicAuth}`)
        return globalThis.fetch(url as Parameters<typeof globalThis.fetch>[0], { ...init, headers })
      }
      return globalThis.fetch(url as Parameters<typeof globalThis.fetch>[0], init)
    }
  })

  // Notion handles PKCE validation, skip local check
  provider.skipLocalPkceValidation = true

  // Override clientsStore with our stateless store for DCR
  Object.defineProperty(provider, 'clientsStore', {
    get: () => clientStore
  })

  // Override authorize: redirect to Notion with OUR callback URL, not client's
  provider.authorize = async (_client, params, res) => {
    const ourState = randomBytes(32).toString('hex')

    pendingAuths.set(ourState, {
      clientRedirectUri: params.redirectUri,
      clientState: params.state,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256',
      scopes: params.scopes,
      createdAt: Date.now()
    })

    const notionUrl = new URL(NOTION_AUTH_URL)
    notionUrl.searchParams.set('client_id', config.notionClientId)
    notionUrl.searchParams.set('response_type', 'code')
    notionUrl.searchParams.set('redirect_uri', callbackUrl)
    notionUrl.searchParams.set('state', ourState)
    notionUrl.searchParams.set('owner', 'user')

    res.redirect(notionUrl.toString())
  }

  // Override exchangeAuthorizationCode: issue opaque token, store Notion token server-side
  provider.exchangeAuthorizationCode = async (client, authorizationCode) => {
    const stored = authCodes.get(authorizationCode)
    if (!stored) {
      throw new InvalidTokenError('Invalid or expired authorization code')
    }

    authCodes.delete(authorizationCode)

    // Issue our own opaque access token — never expose the Notion token to the client
    const opaqueToken = randomBytes(48).toString('hex')
    const entry: StoredNotionToken = {
      notionAccessToken: stored.notionAccessToken,
      createdAt: Date.now()
    }

    notionTokens.set(opaqueToken, entry)

    // Create a one-shot pending bind for clients that use their own identity tokens
    // (e.g., Claude Code sends sk-ant-* instead of our opaque token).
    // The first unknown bearer token to arrive within PENDING_BIND_TTL claims this bind.
    pendingBinds.set(client.client_id, {
      notionToken: entry,
      expiresAt: Date.now() + PENDING_BIND_TTL
    })

    return {
      access_token: opaqueToken,
      token_type: 'bearer',
      expires_in: 86400
    }
  }

  // Override exchangeRefreshToken: proxy to Notion with our credentials
  provider.exchangeRefreshToken = async (client, refreshToken) => {
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    })

    const response = await globalThis.fetch(NOTION_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${notionBasicAuth}`
      },
      body: params.toString()
    })

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.status}`)
    }

    const data = (await response.json()) as { access_token: string; token_type: string; expires_in?: number }

    // Store the refreshed Notion token
    const opaqueToken = randomBytes(48).toString('hex')
    const entry: StoredNotionToken = {
      notionAccessToken: data.access_token,
      createdAt: Date.now()
    }
    notionTokens.set(opaqueToken, entry)
    pendingBinds.set(client.client_id, {
      notionToken: entry,
      expiresAt: Date.now() + PENDING_BIND_TTL
    })

    return {
      access_token: opaqueToken,
      token_type: 'bearer',
      expires_in: data.expires_in ?? 86400
    }
  }

  // Cleanup expired entries periodically
  setInterval(() => {
    const now = Date.now()
    for (const [key, val] of pendingAuths) {
      if (now - val.createdAt > PENDING_AUTH_TTL) pendingAuths.delete(key)
    }
    for (const [key, val] of authCodes) {
      if (now - val.createdAt > AUTH_CODE_TTL) authCodes.delete(key)
    }
    for (const [key, val] of notionTokens) {
      if (now - val.createdAt > NOTION_TOKEN_TTL) notionTokens.delete(key)
    }
    for (const [key, val] of pendingBinds) {
      if (now > val.expiresAt) pendingBinds.delete(key)
    }
    for (const [key, val] of boundTokens) {
      if (now - val.createdAt > NOTION_TOKEN_TTL) boundTokens.delete(key)
    }
    for (const [key, val] of verifyCache) {
      if (now > val.expiresAt) verifyCache.delete(key)
    }
  }, 60_000)

  return {
    provider,
    clientStore,
    pendingAuths,
    authCodes,
    callbackUrl,
    notionBasicAuth
  }
}
