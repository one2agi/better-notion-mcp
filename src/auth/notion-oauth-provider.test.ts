import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NotionOAuthConfig } from './notion-oauth-provider.js'
import { createNotionOAuthProvider } from './notion-oauth-provider.js'

const TEST_CONFIG: NotionOAuthConfig = {
  notionClientId: '31cd872b-test-client-id',
  notionClientSecret: 'secret_test123',
  dcrSecret: 'test-dcr-secret',
  publicUrl: 'https://test.example.com'
}

vi.mock('@notionhq/client', () => ({
  Client: class MockClient {
    private auth: string
    constructor({ auth }: { auth: string }) {
      this.auth = auth
    }
    users = {
      me: async () => {
        if (this.auth === 'valid-token') {
          return { id: 'user-123', name: 'Test User' }
        }
        throw new Error('Unauthorized')
      }
    }
  }
}))

describe('createNotionOAuthProvider', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('should return provider and relay stores', () => {
    const result = createNotionOAuthProvider(TEST_CONFIG)
    expect(result.provider).toBeDefined()
    expect(result.clientStore).toBeDefined()
    expect(result.pendingAuths).toBeInstanceOf(Map)
    expect(result.authCodes).toBeInstanceOf(Map)
    expect(result.callbackUrl).toBe('https://test.example.com/callback')
  })

  it('should create a provider with skipLocalPkceValidation=true', () => {
    const { provider } = createNotionOAuthProvider(TEST_CONFIG)
    expect(provider.skipLocalPkceValidation).toBe(true)
  })

  it('should expose a clientsStore with DCR support', () => {
    const { provider } = createNotionOAuthProvider(TEST_CONFIG)
    expect(provider.clientsStore).toBeDefined()
    expect(provider.clientsStore.registerClient).toBeDefined()
  })

  describe('verifyAccessToken', () => {
    it('should return AuthInfo via opaque token lookup', async () => {
      const { provider, authCodes } = createNotionOAuthProvider(TEST_CONFIG)
      authCodes.set('code-1', { notionAccessToken: 'valid-token', createdAt: Date.now() })
      const tokens = await provider.exchangeAuthorizationCode({ client_id: 'c1', client_secret: 's1' } as any, 'code-1')

      const result = await provider.verifyAccessToken(tokens.access_token)
      expect(result.token).toBe('valid-token')
      expect(result.clientId).toBe(TEST_CONFIG.notionClientId)
      expect(result.scopes).toEqual(['notion:read', 'notion:write'])
      expect(result.expiresAt).toBeTypeOf('number')
      expect(result.extra).toEqual({ userId: 'user-123', userName: 'Test User' })
    })

    it('should resolve external tokens via one-shot pending bind', async () => {
      const { provider, authCodes } = createNotionOAuthProvider(TEST_CONFIG)

      authCodes.set('code-1', { notionAccessToken: 'valid-token', createdAt: Date.now() })
      await provider.exchangeAuthorizationCode({ client_id: 'c1', client_secret: 's1' } as any, 'code-1')

      // First unknown token claims the pending bind
      const result = await provider.verifyAccessToken('sk-ant-oat01-legit-client')
      expect(result.token).toBe('valid-token')

      // Same token works again (now bound)
      const result2 = await provider.verifyAccessToken('sk-ant-oat01-legit-client')
      expect(result2.token).toBe('valid-token')
    })

    it('should reject a SECOND unknown token after bind is consumed (one-shot)', async () => {
      const { provider, authCodes } = createNotionOAuthProvider(TEST_CONFIG)

      authCodes.set('code-1', { notionAccessToken: 'valid-token', createdAt: Date.now() })
      await provider.exchangeAuthorizationCode({ client_id: 'c1', client_secret: 's1' } as any, 'code-1')

      // First token claims the bind
      await provider.verifyAccessToken('sk-ant-oat01-legit-client')

      // Second DIFFERENT token should be rejected — bind is consumed
      await expect(provider.verifyAccessToken('sk-ant-attacker-token')).rejects.toThrow('No Notion token found')
    })

    it('should reject unknown tokens after pending bind expires', async () => {
      const { provider, authCodes } = createNotionOAuthProvider(TEST_CONFIG)

      authCodes.set('code-1', { notionAccessToken: 'valid-token', createdAt: Date.now() })
      await provider.exchangeAuthorizationCode({ client_id: 'c1', client_secret: 's1' } as any, 'code-1')

      // Advance past the 2-minute pending bind TTL
      vi.advanceTimersByTime(3 * 60 * 1000)

      // Unknown token should be rejected — pending bind expired
      await expect(provider.verifyAccessToken('sk-ant-late-token')).rejects.toThrow('No Notion token found')
    })

    it('should still accept bound tokens after pending bind expires', async () => {
      const { provider, authCodes } = createNotionOAuthProvider(TEST_CONFIG)

      authCodes.set('code-1', { notionAccessToken: 'valid-token', createdAt: Date.now() })
      await provider.exchangeAuthorizationCode({ client_id: 'c1', client_secret: 's1' } as any, 'code-1')

      // Bind during pending period
      await provider.verifyAccessToken('sk-ant-legit-token')

      // Advance past pending bind TTL
      vi.advanceTimersByTime(3 * 60 * 1000)

      // Already-bound token still works
      const result = await provider.verifyAccessToken('sk-ant-legit-token')
      expect(result.token).toBe('valid-token')
    })

    it('should use verification cache on subsequent calls', async () => {
      const { provider, authCodes } = createNotionOAuthProvider(TEST_CONFIG)
      authCodes.set('code-1', { notionAccessToken: 'valid-token', createdAt: Date.now() })
      const tokens = await provider.exchangeAuthorizationCode({ client_id: 'c1', client_secret: 's1' } as any, 'code-1')

      // First call hits Notion API
      const r1 = await provider.verifyAccessToken(tokens.access_token)
      expect(r1.token).toBe('valid-token')

      // Second call should use cache (no Notion API call)
      const r2 = await provider.verifyAccessToken(tokens.access_token)
      expect(r2.token).toBe('valid-token')
    })

    it('should throw when no Notion token is stored', async () => {
      const { provider } = createNotionOAuthProvider(TEST_CONFIG)
      await expect(provider.verifyAccessToken('sk-ant-unknown')).rejects.toThrow('No Notion token found')
    })

    it('should throw for invalid Notion token', async () => {
      const { provider, authCodes } = createNotionOAuthProvider(TEST_CONFIG)
      authCodes.set('code-1', { notionAccessToken: 'expired-notion-token', createdAt: Date.now() })
      await provider.exchangeAuthorizationCode({ client_id: 'c1', client_secret: 's1' } as any, 'code-1')

      await expect(provider.verifyAccessToken('any-bearer-token')).rejects.toThrow('Invalid or expired Notion token')
    })
  })

  describe('clientsStore (StatelessClientStore)', () => {
    it('should register a client with deterministic credentials', async () => {
      const { provider } = createNotionOAuthProvider(TEST_CONFIG)
      const store = provider.clientsStore

      const client1 = await store.registerClient!({
        redirect_uris: ['https://example.com/cb']
      } as any)

      const client2 = await store.registerClient!({
        redirect_uris: ['https://example.com/cb']
      } as any)

      expect(client1.client_id).toBe(client2.client_id)
      expect(client1.client_secret).toBe(client2.client_secret)
    })

    it('should retrieve a client by ID', async () => {
      const { provider } = createNotionOAuthProvider(TEST_CONFIG)
      const store = provider.clientsStore

      const registered = await store.registerClient!({
        redirect_uris: ['https://example.com/cb']
      } as any)

      const retrieved = await store.getClient(registered.client_id)
      expect(retrieved).toBeDefined()
    })
  })

  describe('exchangeAuthorizationCode', () => {
    it('should issue opaque token and store Notion token server-side', async () => {
      const { provider, authCodes } = createNotionOAuthProvider(TEST_CONFIG)

      authCodes.set('test-code', {
        notionAccessToken: 'notion-token-123',
        createdAt: Date.now()
      })

      const result = await provider.exchangeAuthorizationCode(
        { client_id: 'test', client_secret: 'test' } as any,
        'test-code'
      )

      // Should return opaque token, NOT the Notion token
      expect(result.access_token).not.toBe('notion-token-123')
      expect(result.access_token).toHaveLength(96) // 48 bytes hex
      expect(result.token_type).toBe('bearer')
      expect(result.expires_in).toBe(86400)
      // Code should be consumed (deleted)
      expect(authCodes.has('test-code')).toBe(false)
    })

    it('should throw for an invalid auth code', async () => {
      const { provider } = createNotionOAuthProvider(TEST_CONFIG)

      await expect(
        provider.exchangeAuthorizationCode({ client_id: 'test', client_secret: 'test' } as any, 'invalid-code')
      ).rejects.toThrow('Invalid or expired authorization code')
    })
  })

  describe('authorize (callback relay)', () => {
    it('should redirect to Notion with our callback URL and store pending auth', async () => {
      const { provider, pendingAuths } = createNotionOAuthProvider(TEST_CONFIG)

      const redirectedUrl = await new Promise<string>((resolve) => {
        const mockRes = { redirect: (url: string) => resolve(url) }
        provider.authorize(
          { client_id: 'test' } as any,
          {
            redirectUri: 'https://mcp-client.example.com/cb',
            state: 'client-state',
            codeChallenge: 'challenge123',
            codeChallengeMethod: 'S256'
          } as any,
          mockRes as any
        )
      })

      expect(redirectedUrl).toContain('api.notion.com/v1/oauth/authorize')
      expect(redirectedUrl).toContain('client_id=31cd872b-test-client-id')
      expect(redirectedUrl).toContain(`redirect_uri=${encodeURIComponent('https://test.example.com/callback')}`)
      expect(pendingAuths.size).toBe(1)

      const [, pending] = [...pendingAuths.entries()][0]
      expect(pending.clientRedirectUri).toBe('https://mcp-client.example.com/cb')
      expect(pending.clientState).toBe('client-state')
    })
  })
})
