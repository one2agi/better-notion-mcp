import { describe, expect, it, vi } from 'vitest'
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
    it('should return AuthInfo for a valid Notion token', async () => {
      const { provider } = createNotionOAuthProvider(TEST_CONFIG)
      const result = await provider.verifyAccessToken('valid-token')

      expect(result.token).toBe('valid-token')
      expect(result.clientId).toBe(TEST_CONFIG.notionClientId)
      expect(result.scopes).toEqual(['notion:read', 'notion:write'])
      expect(result.expiresAt).toBeTypeOf('number')
      expect(result.extra).toEqual({ userId: 'user-123', userName: 'Test User' })
    })

    it('should throw InvalidTokenError for an invalid Notion token', async () => {
      const { provider } = createNotionOAuthProvider(TEST_CONFIG)
      await expect(provider.verifyAccessToken('invalid-token')).rejects.toThrow('Invalid or expired Notion token')
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
    it('should return stored token for a valid auth code', async () => {
      const { provider, authCodes } = createNotionOAuthProvider(TEST_CONFIG)

      // Simulate a stored auth code
      authCodes.set('test-code', {
        notionAccessToken: 'notion-token-123',
        createdAt: Date.now()
      })

      const result = await provider.exchangeAuthorizationCode(
        { client_id: 'test', client_secret: 'test' } as any,
        'test-code'
      )

      expect(result.access_token).toBe('notion-token-123')
      expect(result.token_type).toBe('bearer')
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
