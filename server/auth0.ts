import type { RequestHandler } from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';

export interface Auth0McpConfig {
  domain: string;
  issuer: string;
  audience: string;
  resourceUrl: string;
  jwks: ReturnType<typeof createRemoteJWKSet>;
}

export function getAuth0McpConfig(): Auth0McpConfig | null {
  const domain = process.env.AUTH0_DOMAIN?.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
  const audience = process.env.AUTH0_AUDIENCE?.trim();
  const resourceUrl = (process.env.MCP_SERVER_URL || 'https://reconcileflow-u6k9.onrender.com/api/mcp').trim();
  if (!domain || !audience) return null;
  const issuer = `https://${domain}/`;
  return {
    domain,
    issuer,
    audience,
    resourceUrl,
    jwks: createRemoteJWKSet(new URL(`${issuer}.well-known/jwks.json`)),
  };
}

export function createAuth0McpBearerMiddleware(config: Auth0McpConfig): RequestHandler {
  return requireBearerAuth({
    verifier: {
      async verifyAccessToken(token) {
        const { payload, protectedHeader } = await jwtVerify(token, config.jwks, {
          issuer: config.issuer,
          audience: config.audience,
          algorithms: ['RS256'],
        });
        if (protectedHeader.typ && !['JWT', 'at+jwt'].includes(protectedHeader.typ)) {
          throw new Error('Unsupported Auth0 access token type.');
        }
        const scopeClaim = typeof payload.scope === 'string' ? payload.scope.split(/\s+/) : [];
        const permissionClaim = Array.isArray(payload.permissions)
          ? payload.permissions.filter((permission): permission is string => typeof permission === 'string')
          : [];
        const clientId = typeof payload.azp === 'string'
          ? payload.azp
          : typeof payload.client_id === 'string'
            ? payload.client_id
            : typeof payload.sub === 'string' ? payload.sub : 'auth0-client';
        return {
          token,
          clientId,
          scopes: [...new Set([...scopeClaim, ...permissionClaim])],
          expiresAt: typeof payload.exp === 'number' ? payload.exp : undefined,
          resource: new URL(config.audience),
          extra: { subject: payload.sub },
        };
      },
    },
    resourceMetadataUrl: `${new URL(config.resourceUrl).origin}/.well-known/oauth-protected-resource${new URL(config.resourceUrl).pathname}`,
    expectedResource: new URL(config.audience),
  });
}
