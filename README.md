# ReconcileFlow

ReconcileFlow is a reconciliation exception management application with a provider-neutral MCP server. AI analysis is performed by whichever MCP client connects; this application stores source transactions, reconciliation results, operational updates, and audit history. It makes no AI API calls.

## Run locally

Requires Node.js. Run `npm install`, then `npm run dev`. The dashboard is served on port 3000 by default.

## Connect an MCP client

Expose the app over HTTPS and connect an MCP-capable client to `https://<your-host>/api/mcp` using Streamable HTTP. Set `MCP_AUTH_TOKEN` in production and configure the client to send it as a Bearer token. Example client configuration:

```json
{
  "mcpServers": {
    "reconcileflow": {
      "url": "https://<your-host>/api/mcp"
    }
  }
}
```

The six tools are `get_reconciliation_data`, `save_reconciliation_results`, `get_reconciliation_summary`, `list_reconciliation_items`, `update_reconciliation_item`, and `bulk_update_reconciliation_items`. Read-only workflow resources are available under `reconcile://`.

The application uses JSON files in `data/` as its current local persistence layer. Protect remote access with an authenticated deployment gateway; never expose the demo server directly to the public internet.
