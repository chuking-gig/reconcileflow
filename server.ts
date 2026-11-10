import express, { Request, Response, RequestHandler } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { db, MatchStatus, ResolutionStatus, CsvTransactionRow } from './server/db.js';
import {
  handleJsonRpcMessage,
  executeMCPTool,
  MCP_TOOLS_DEFINITIONS,
  VALID_MATCH_STATUSES,
  VALID_RESOLUTION_STATUSES,
  createMcpHttpHandler,
} from './server/mcp.js';
import { createAuth0McpBearerMiddleware, getAuth0McpConfig } from './server/auth0.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-ID', 'mcp-session-id'],
  })
);

app.use(express.json({ limit: '25mb' }));

// Keep track of active SSE sessions for MCP
interface SseSession {
  id: string;
  res: Response;
  createdAt: number;
}
const sseSessions: Map<string, SseSession> = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sseSessions.entries()) {
    if (now - session.createdAt > 3600000) {
      sseSessions.delete(id);
    }
  }
}, 60000);

/* ==========================================================================
   REST API Endpoints (Dashboard & Reconciliations)
   ========================================================================== */

// 1. Dashboard summary stats
app.get('/api/dashboard/stats', (_req: Request, res: Response) => {
  const stats = db.getDashboardStats();
  res.json(stats);
});

// Legacy fallback for stats
app.get('/api/stats', (_req: Request, res: Response) => {
  const stats = db.getDashboardStats();
  res.json(stats);
});

// 2. List all reconciliation runs
app.get('/api/reconciliations', (_req: Request, res: Response) => {
  const runs = db.getAllRuns();
  res.json({
    count: runs.length,
    runs,
  });
});

// 3. Get single reconciliation run
app.get('/api/reconciliations/:id', (req: Request, res: Response) => {
  const run = db.getRunById(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Reconciliation run not found' });
    return;
  }
  res.json(run);
});

// 4. Create a new reconciliation run
app.post('/api/reconciliations', (req: Request, res: Response) => {
  const {
    name,
    start_date,
    end_date,
    ledger_file_name,
    bank_file_name,
    ledger_data,
    bank_data,
  } = req.body || {};

  if (!name || !start_date || !end_date) {
    res.status(400).json({ error: 'name, start_date, and end_date are required.' });
    return;
  }

  const run = db.createRun({
    name,
    start_date,
    end_date,
    ledger_file_name,
    bank_file_name,
    ledger_data: Array.isArray(ledger_data) ? ledger_data : [],
    bank_data: Array.isArray(bank_data) ? bank_data : [],
  });

  res.status(201).json(run);
});

// 5. Delete a reconciliation run
app.delete('/api/reconciliations/:id', (req: Request, res: Response) => {
  const success = db.deleteRun(req.params.id);
  if (!success) {
    res.status(404).json({ error: 'Reconciliation run not found' });
    return;
  }
  res.json({ success: true, message: 'Reconciliation run deleted' });
});

// 6. Get items for a reconciliation run
app.get('/api/reconciliations/:id/items', (req: Request, res: Response) => {
  const runId = req.params.id;
  const {
    match_status,
    resolution_status,
    status,
    start_date,
    end_date,
    till_date,
    assignee,
    transaction_id,
    search,
  } = req.query;

  const items = db.findItemsByFilters({
    run_id: runId,
    match_status: typeof match_status === 'string' ? match_status : undefined,
    resolution_status: typeof resolution_status === 'string' ? resolution_status : undefined,
    status: typeof status === 'string' ? status : undefined,
    start_date: typeof start_date === 'string' ? start_date : undefined,
    end_date: typeof end_date === 'string' ? end_date : undefined,
    till_date: typeof till_date === 'string' ? till_date : undefined,
    assignee: typeof assignee === 'string' ? assignee : undefined,
    transaction_id: typeof transaction_id === 'string' ? transaction_id : undefined,
    search: typeof search === 'string' ? search : undefined,
  });

  res.json({
    run_id: runId,
    count: items.length,
    items,
  });
});

// 6a. Get reconciliation financial summary (by date range or till date)
app.get('/api/reconciliations/:id/summary', (req: Request, res: Response) => {
  const runId = req.params.id;
  const { start_date, end_date, till_date } = req.query;
  const summary = db.getReconciliationSummary({
    run_id: runId,
    start_date: typeof start_date === 'string' ? start_date : undefined,
    end_date: typeof end_date === 'string' ? end_date : undefined,
    till_date: typeof till_date === 'string' ? till_date : undefined,
  });
  res.json(summary);
});


// 6b. Fetch new transactions feed (Internal Ledger & Bank Statement)
app.post('/api/reconciliations/fetch-transactions', (req: Request, res: Response) => {
  const { run_id } = req.body || {};
  const result = db.fetchNewTransactions(run_id);
  res.json({
    success: true,
    message: `Fetched ${result.newCount} new transaction feeds from Internal Ledger and Bank Statement.`,
    ...result,
  });
});

// 7. Update an exception item (resolution_status, assignee, resolution_notes, reconciliation_reason)
app.patch('/api/items/:id', (req: Request, res: Response) => {
  const { resolution_status, assignee, resolution_notes, reconciliation_reason } = req.body || {};

  if (resolution_status && !VALID_RESOLUTION_STATUSES.includes(resolution_status)) {
    res.status(400).json({
      error: `Invalid resolution_status. Must be one of: ${VALID_RESOLUTION_STATUSES.join(', ')}`,
    });
    return;
  }

  const updated = db.updateItem(req.params.id, {
    resolution_status,
    assignee,
    resolution_notes,
    reconciliation_reason,
  });

  if (!updated) {
    res.status(404).json({ error: 'Reconciliation item not found' });
    return;
  }

  // Update run stats
  db.updateRunStats(updated.run_id);

  res.json(updated);
});

// 8. Reconcile datasets via MCP rules engine
const handleSimulateReconcile = (req: Request, res: Response) => {
  const run = db.getRunById(req.params.id);
  if (!run) {
    res.status(404).json({ error: 'Reconciliation run not found' });
    return;
  }

  const ledger = run.ledger_data || [];
  const bank = run.bank_data || [];

  if (ledger.length === 0 && bank.length === 0) {
    res.status(400).json({ error: 'No transaction data available in uploaded datasets to reconcile.' });
    return;
  }

  // Deduplicate and group by transaction_id
  const ledgerMap = new Map<string, CsvTransactionRow[]>();
  ledger.forEach((row) => {
    const list = ledgerMap.get(row.transaction_id) || [];
    list.push(row);
    ledgerMap.set(row.transaction_id, list);
  });

  const bankMap = new Map<string, CsvTransactionRow[]>();
  bank.forEach((row) => {
    const list = bankMap.get(row.transaction_id) || [];
    list.push(row);
    bankMap.set(row.transaction_id, list);
  });

  const allTxnIds = Array.from(new Set([...Array.from(ledgerMap.keys()), ...Array.from(bankMap.keys())]));
  const structuredResults: Array<{
    transaction_id: string;
    transaction_date: string;
    description: string;
    ledger_amount: number | null;
    bank_amount: number | null;
    difference: number;
    match_status: MatchStatus;
  }> = [];

  for (const txnId of allTxnIds) {
    const ledgerRows = ledgerMap.get(txnId) || [];
    const bankRows = bankMap.get(txnId) || [];

    // Check duplicate detection
    if (ledgerRows.length > 1 || bankRows.length > 1) {
      const lAmount = ledgerRows[0]?.amount ?? null;
      const bAmount = bankRows[0]?.amount ?? null;
      const diff = lAmount !== null && bAmount !== null ? Math.abs(lAmount - bAmount) : (lAmount ?? bAmount ?? 0);
      const desc = `${ledgerRows[0]?.description || bankRows[0]?.description || ''} (Duplicate in ${ledgerRows.length > 1 ? 'Ledger' : 'Bank'})`;
      const date = ledgerRows[0]?.transaction_date || bankRows[0]?.transaction_date || '';

      structuredResults.push({
        transaction_id: txnId,
        transaction_date: date,
        description: desc,
        ledger_amount: lAmount,
        bank_amount: bAmount,
        difference: diff,
        match_status: 'Potential Duplicate',
      });
      continue;
    }

    if (ledgerRows.length > 0 && bankRows.length > 0) {
      const l = ledgerRows[0];
      const b = bankRows[0];
      const diff = Math.abs(l.amount - b.amount);

      if (diff === 0) {
        structuredResults.push({
          transaction_id: txnId,
          transaction_date: l.transaction_date || b.transaction_date,
          description: l.description || b.description,
          ledger_amount: l.amount,
          bank_amount: b.amount,
          difference: 0,
          match_status: 'Matched',
        });
      } else {
        structuredResults.push({
          transaction_id: txnId,
          transaction_date: l.transaction_date || b.transaction_date,
          description: `${l.description || b.description} (Ledger: ₹${l.amount} vs Bank: ₹${b.amount})`,
          ledger_amount: l.amount,
          bank_amount: b.amount,
          difference: diff,
          match_status: 'Amount Mismatch',
        });
      }
    } else if (ledgerRows.length > 0) {
      const l = ledgerRows[0];
      structuredResults.push({
        transaction_id: txnId,
        transaction_date: l.transaction_date,
        description: l.description,
        ledger_amount: l.amount,
        bank_amount: null,
        difference: l.amount,
        match_status: 'Missing in Bank',
      });
    } else if (bankRows.length > 0) {
      const b = bankRows[0];
      structuredResults.push({
        transaction_id: txnId,
        transaction_date: b.transaction_date,
        description: b.description,
        ledger_amount: null,
        bank_amount: b.amount,
        difference: b.amount,
        match_status: 'Missing in Ledger',
      });
    }
  }

  // Execute MCP tool create_reconciliation_results
  const mcpResult = executeMCPTool('create_reconciliation_results', {
    reconciliation_id: run.id,
    items: structuredResults,
  });

  const updatedRun = db.getRunById(run.id);

  res.json({
    success: true,
    message: 'Reconciliation analysis completed via MCP create_reconciliation_results.',
    run: updatedRun,
    mcp_result: mcpResult,
  });
};

app.post('/api/reconciliations/:id/simulate-mcp-reconcile', handleSimulateReconcile);

// 9. Reset to sample demo data
app.post('/api/reset', (_req: Request, res: Response) => {
  const resetData = db.resetToSample();
  res.json({
    success: true,
    message: 'Reset back to sample demo reconciliation data',
    runs: resetData.runs,
    items: resetData.items,
  });
});

/* ==========================================================================
   Model Context Protocol (MCP) Endpoints
   ========================================================================== */

app.get('/api/mcp/info', (req: Request, res: Response) => {
  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const baseUrl = `${protocol}://${host}`;

  const mcpConfig = {
    mcpServers: {
      reconcileflow: {
        url: `${baseUrl}/api/mcp`,
      },
    },
  };

  res.json({
    name: 'reconcileflow-mcp',
    version: '2.0.0',
    description: 'ReconcileFlow Bank Reconciliation Exception Management Platform MCP Server',
    endpoints: {
      jsonRpcHttp: `${baseUrl}/api/mcp`,
      protectedResourceMetadata: `${baseUrl}/.well-known/oauth-protected-resource/api/mcp`,
    },
    tools: MCP_TOOLS_DEFINITIONS,
    mcpClientConfig: mcpConfig,
    desktopClientConfig: mcpConfig,
    status: auth0McpConfig ? 'online' : process.env.NODE_ENV === 'production' ? 'missing_auth' : 'development',
    authentication: auth0McpConfig ? 'Auth0 OAuth 2.0' : 'Local development without authentication',
    toolInspectorEnabled: process.env.NODE_ENV !== 'production',
  });
});

app.get('/mcp/tools', (_req: Request, res: Response) => {
  res.json({ tools: MCP_TOOLS_DEFINITIONS });
});

app.post('/api/mcp/execute', (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'The MCP inspector endpoint is disabled in production. Connect through the authenticated MCP endpoint.' });
    return;
  }
  const { tool, arguments: args } = req.body;
  if (!tool) {
    res.status(400).json({ error: 'Missing "tool" name parameter' });
    return;
  }
  const result = executeMCPTool(tool, args || {});
  res.json(result);
});

const handleJsonRpc = (req: Request, res: Response) => {
  const body = req.body;

  if (Array.isArray(body)) {
    const responses = body.map((singleMsg) => handleJsonRpcMessage(singleMsg)).filter(Boolean);
    res.json(responses);
    return;
  }

  const response = handleJsonRpcMessage(body);
  if (response === null) {
    res.status(204).end();
    return;
  }

  res.json(response);
};

const auth0McpConfig = getAuth0McpConfig();
const protectMcp: RequestHandler = auth0McpConfig
  ? createAuth0McpBearerMiddleware(auth0McpConfig)
  : (req, res, next) => {
      if (process.env.NODE_ENV === 'production') { res.status(503).json({ error: 'Configure AUTH0_DOMAIN and AUTH0_AUDIENCE to enable OAuth-protected MCP access.' }); return; }
      next();
    };

app.get('/.well-known/oauth-protected-resource/api/mcp', (_req: Request, res: Response) => {
  if (!auth0McpConfig) { res.status(503).json({ error: 'Auth0 MCP OAuth is not configured.' }); return; }
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({
    resource: auth0McpConfig.resourceUrl,
    authorization_servers: [auth0McpConfig.issuer],
    scopes_supported: ['openid', 'profile', 'email', 'read:reconciliation', 'write:reconciliation'],
    bearer_methods_supported: ['header'],
    resource_name: 'ReconcileFlow',
  });
});

app.all('/api/mcp', protectMcp, (req: Request, res: Response) => { void createMcpHttpHandler(req, res).catch(err => { console.error('MCP transport error', err); if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' }); }); });
app.all('/mcp', protectMcp, (req: Request, res: Response) => { void createMcpHttpHandler(req, res).catch(err => { console.error('MCP transport error', err); if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' }); }); });

// Server-Sent Events (SSE) Transport
const handleSseConnect = (req: Request, res: Response) => {
  const sessionId = crypto.randomUUID();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  const session: SseSession = {
    id: sessionId,
    res,
    createdAt: Date.now(),
  };

  sseSessions.set(sessionId, session);

  const host = req.get('host') || 'localhost:3000';
  const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
  const messageEndpoint = `${protocol}://${host}/mcp/messages?sessionId=${sessionId}`;

  res.write(`event: endpoint\ndata: ${messageEndpoint}\n\n`);

  req.on('close', () => {
    sseSessions.delete(sessionId);
  });
};

const handleLegacySseConnect = (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') { res.status(404).json({ error: 'Legacy SSE transport is disabled. Use the authenticated Streamable HTTP endpoint.' }); return; }
  handleSseConnect(req, res);
};
app.get('/mcp/sse', handleLegacySseConnect);
app.get('/sse', handleLegacySseConnect);

const handleSseMessage = (req: Request, res: Response) => {
  const sessionId = (req.query.sessionId as string) || (req.headers['mcp-session-id'] as string);
  const session = sessionId ? sseSessions.get(sessionId) : null;

  const jsonRpcResponse = handleJsonRpcMessage(req.body);

  if (session && jsonRpcResponse) {
    session.res.write(`event: message\ndata: ${JSON.stringify(jsonRpcResponse)}\n\n`);
  }

  if (jsonRpcResponse === null) {
    res.status(204).end();
  } else {
    res.status(200).json(jsonRpcResponse);
  }
};

const handleLegacySseMessage = (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') { res.status(404).json({ error: 'Legacy SSE transport is disabled. Use the authenticated Streamable HTTP endpoint.' }); return; }
  handleSseMessage(req, res);
};
app.post('/mcp/messages', handleLegacySseMessage);
app.post('/api/mcp/messages', handleLegacySseMessage);

/* ==========================================================================
   Frontend Serving (Vite Middlewares in Dev / Dist in Prod)
   ========================================================================== */

async function startServer() {
  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: {
        middlewareMode: true,
        host: '0.0.0.0',
        port: PORT,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req: Request, res: Response) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ReconcileFlow server running on http://0.0.0.0:${PORT}`);
    console.log(`🔌 MCP Endpoint: http://0.0.0.0:${PORT}/api/mcp`);
    console.log(`📡 MCP SSE Stream: http://0.0.0.0:${PORT}/mcp/sse`);
  });
}

startServer().catch((err) => {
  console.error('Fatal error starting ReconcileFlow server:', err);
  process.exit(1);
});
