# ReconcileFlow

ReconcileFlow is a reconciliation exception management application with a provider-neutral MCP server. AI analysis is performed by whichever MCP client connects; this application stores source transactions, reconciliation results, operational updates, and audit history. It makes no AI API calls.

## Run locally

Requires Node.js. Run `npm install`, then `npm run dev`. The dashboard is served on port 3000 by default. Without Auth0 settings the MCP endpoint is open for local development only.

## Configure Auth0 OAuth for MCP

1. Create an Auth0 API whose Identifier is the value you will use for `AUTH0_AUDIENCE` (for example `https://reconcileflow-u6k9.onrender.com`). Use RS256 signing.
2. Add the API permissions `read:reconciliation` and `write:reconciliation`. Enable RBAC and include permissions in access tokens. Assign these permissions only to trusted users/roles.
3. Enable Dynamic Client Registration and Resource Parameter Compatibility Profile in Auth0's tenant advanced settings. Enable the login connection for DCR-created clients.
4. Set the following environment variables on the Render web service:

   - `AUTH0_DOMAIN`: tenant domain, without `https://` (for example `example.us.auth0.com`)
   - `AUTH0_AUDIENCE`: exact API Identifier from Auth0
   - `MCP_SERVER_URL`: `https://<your-render-host>/api/mcp`

5. Redeploy, then connect an MCP client to the `MCP_SERVER_URL`. Auth0 provides the sign-in flow; the MCP server verifies the JWT issuer, audience, signature, and tool scopes against Auth0's JWKS.

The protected-resource metadata is served at `/.well-known/oauth-protected-resource/api/mcp`. The old shared `MCP_AUTH_TOKEN` configuration is no longer used. Production MCP access returns 503 until Auth0 settings are configured. Legacy SSE and the browser MCP inspector are disabled in production.

## Connect from Claude

In Claude, add a custom connector using `https://<your-render-host>/api/mcp`, then complete the Auth0 sign-in. The server supports Streamable HTTP and exposes six reconciliation tools plus read-only `reconcile://` resources.

## Data storage

The current local persistence layer uses JSON files in `data/`. Render's default filesystem is ephemeral; configure persistent storage or move to a managed database before relying on data across deploys.

## Security scope

OAuth protects the MCP transport. The dashboard's REST APIs still need application login and authorization before using the public deployment with real financial data.
