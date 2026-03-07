import { randomBytes } from 'node:crypto'
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js'
import { Client } from '@notionhq/client'
import { StatelessClientStore } from './stateless-client-store.js'

const NOTION_AUTH_URL = 'https://api.notion.com/v1/oauth/authorize'
const NOTION_TOKEN_URL = 'https://api.notion.com/v1/oauth/token'
const AUTH_CODE_TTL = 10 * 60 * 1000 // 10 minutes
const PENDING_AUTH_TTL = 10 * 60 * 1000 // 10 minutes

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
 * 7. MCP client calls /token with our auth code → we return the Notion token
 *
 * This relay is needed because Notion only accepts pre-registered redirect URIs.
 */
export function createNotionOAuthProvider(config: NotionOAuthConfig) {
  const clientStore = new StatelessClientStore(config.dcrSecret)
  const callbackUrl = `${config.publicUrl}/callback`

  // Notion's token endpoint requires HTTP Basic auth with the integration's credentials
  const notionBasicAuth = Buffer.from(`${config.notionClientId}:${config.notionClientSecret}`).toString('base64')

  // Temporary stores for the callback relay
  // Key: our state param sent to Notion → PendingAuth (client's original redirect info)
  const pendingAuths = new Map<string, PendingAuth>()
  // Key: our auth code issued to MCP client → StoredAuthCode (Notion token)
  const authCodes = new Map<string, StoredAuthCode>()

  const provider = new ProxyOAuthServerProvider({
    endpoints: {
      authorizationUrl: NOTION_AUTH_URL,
      tokenUrl: NOTION_TOKEN_URL
    },

    verifyAccessToken: async (token: string) => {
      try {
        const notion = new Client({ auth: token, notionVersion: '2025-09-03' })
        const me = await notion.users.me({})
        return {
          token,
          clientId: config.notionClientId,
          scopes: ['notion:read', 'notion:write'],
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          extra: { userId: me.id, userName: me.name }
        }
      } catch {
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

    // Save client's original redirect info
    pendingAuths.set(ourState, {
      clientRedirectUri: params.redirectUri,
      clientState: params.state,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256',
      scopes: params.scopes,
      createdAt: Date.now()
    })

    // Redirect to Notion with our callback URL and our state
    const notionUrl = new URL(NOTION_AUTH_URL)
    notionUrl.searchParams.set('client_id', config.notionClientId)
    notionUrl.searchParams.set('response_type', 'code')
    notionUrl.searchParams.set('redirect_uri', callbackUrl)
    notionUrl.searchParams.set('state', ourState)
    notionUrl.searchParams.set('owner', 'user')

    res.redirect(notionUrl.toString())
  }

  // Override exchangeAuthorizationCode: look up our stored Notion token
  provider.exchangeAuthorizationCode = async (_client, authorizationCode) => {
    const stored = authCodes.get(authorizationCode)
    if (!stored) {
      throw new InvalidTokenError('Invalid or expired authorization code')
    }

    authCodes.delete(authorizationCode)

    return {
      access_token: stored.notionAccessToken,
      token_type: 'bearer',
      ...(stored.expiresIn && { expires_in: stored.expiresIn }),
      ...(stored.notionRefreshToken && { refresh_token: stored.notionRefreshToken })
    }
  }

  // Override exchangeRefreshToken: proxy to Notion with our credentials
  provider.exchangeRefreshToken = async (_client, refreshToken) => {
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

    return (await response.json()) as { access_token: string; token_type: string; expires_in?: number }
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
