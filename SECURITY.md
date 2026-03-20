# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x.x   | :white_check_mark: |
| < 2.0   | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability, please **DO NOT** create a public issue.

Instead, please email: **quangminh2402.dev@gmail.com**

Include:

1. Detailed description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive acknowledgment within 48 hours.

## Security Measures

- Regular dependency updates via Renovate
- npm audit checks in CI
- Docker images from official sources, non-root user
- OAuth 2.1 with PKCE S256 and session owner binding
- Stateless HMAC-based Dynamic Client Registration
- Rate limiting on MCP (120/min) and auth (20/min) endpoints
- X-Powered-By header disabled
- Error sanitization (whitelist-only fields, no token leakage)
- Indirect prompt injection defense (untrusted content markers)
- Path traversal prevention in help/docs endpoints
- Redirect URI protocol validation (blocks javascript:, data:, etc.)
- IP-scoped pending bind with 30s TTL for token binding
- Environment variables for sensitive data
- Least privilege principle
