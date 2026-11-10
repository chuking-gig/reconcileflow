import { db, MatchStatus, ResolutionStatus } from './db.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';

export const createMcpHttpHandler = async (req: any, res: any) => {
  const server = new Server({ name: 'reconcileflow', version: '3.0.0' }, { capabilities: { tools: {}, resources: {} }, instructions: 'ReconcileFlow is the system of record. Use tools for data and operations; AI analysis is performed by the connected client.' });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: MCP_TOOLS_DEFINITIONS as any }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => executeMCPTool(request.params.name, request.params.arguments || {}) as any);
  const resources = [
    { uri: 'reconcile://schema', name: 'Reconciliation schema', mimeType: 'text/markdown', text: 'Source transactions are immutable uploaded ledger and bank rows. Reconciliation items classify comparisons and carry separate resolution state.' },
    { uri: 'reconcile://matching-rules', name: 'Matching rules', mimeType: 'text/markdown', text: 'Match transactions using date, amount, description and source references; IDs may differ between sources. Classifications: Matched, Probable Match, Amount Mismatch, Missing in Bank, Missing in Ledger, Potential Duplicate.' },
    { uri: 'reconcile://status-definitions', name: 'Status definitions', mimeType: 'text/markdown', text: 'Match status describes comparison outcome. Resolution status is Open, In Progress, or Resolved and never changes match status.' },
    { uri: 'reconcile://workflow', name: 'Reconciliation workflow', mimeType: 'text/markdown', text: 'Retrieve source rows, independently analyze matches, save results, verify with summary, then investigate and update exceptions. Confirm bulk actions after preview.' },
  ];
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: resources.map(({text,...item})=>item) }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(item => item.uri === request.params.uri);
    if (!resource) throw new Error('Resource not found');
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }] };
  });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
};

export const VALID_MATCH_STATUSES: MatchStatus[] = [
  'Matched',
  'Probable Match',
  'Amount Mismatch',
  'Missing in Bank',
  'Missing in Ledger',
  'Potential Duplicate',
];

export const VALID_RESOLUTION_STATUSES: ResolutionStatus[] = ['Open', 'In Progress', 'Resolved'];

export const MCP_TOOLS_DEFINITIONS = [
  {
    name: 'get_reconciliation_summary',
    description:
      'Retrieve high-level financial roll-forward reconciliation summary, net ledger & bank totals, reconciled vs unreconciled balances, and category breakdown. Can filter by time period or fetch unreconciled till date. No internal ID required.',
    inputSchema: {
      type: 'object',
      properties: {
        period_start: { type: 'string', description: 'Period start YYYY-MM-DD.' },
        period_end: { type: 'string', description: 'Period end YYYY-MM-DD.' },
        till_date: {
          type: 'string',
          description: 'Filter balance and discrepancies up to a specific date (YYYY-MM-DD, e.g. "2026-11-10"). Perfect for "unreconciled till date".',
        },
        start_date: {
          type: 'string',
          description: 'Start date of the accounting period (YYYY-MM-DD).',
        },
        end_date: {
          type: 'string',
          description: 'End date of the accounting period (YYYY-MM-DD).',
        },
        reconciliation_id: {
          type: 'string',
          description: 'Optional reconciliation run ID. If omitted, automatically defaults to the active operating account.',
        },
      },
    },
  },
  {
    name: 'get_reconciliation_data',
    description:
      'Retrieve both the Internal Ledger dataset and the Bank Statement dataset for comparison. Supports optional time period filtering. If reconciliation_id is omitted, defaults to the active operating account.',
    inputSchema: {
      type: 'object',
      properties: {
        period_start: { type: 'string', description: 'Period start YYYY-MM-DD.' },
        period_end: { type: 'string', description: 'Period end YYYY-MM-DD.' },
        source_type: { type: 'string', enum: ['ledger','bank_statement','both'] },
        page: { type: 'integer', minimum: 1 }, page_size: { type: 'integer', minimum: 1, maximum: 500 },
        reconciliation_id: {
          type: 'string',
          description: 'Optional reconciliation run ID (e.g. "rec_run_nov2026"). Defaults to active run if omitted.',
        },
        start_date: {
          type: 'string',
          description: 'Filter records on or after this date (YYYY-MM-DD).',
        },
        end_date: {
          type: 'string',
          description: 'Filter records on or before this date (YYYY-MM-DD).',
        },
      },
    },
  },
  {
    name: 'save_reconciliation_results',
    description:
      'Save reconciliation results generated via MCP into ReconcileFlow. Records matched items and categorizes discrepancies (Amount Mismatch, Missing in Bank, Missing in Ledger, Potential Duplicate). Defaults to active run if reconciliation_id is omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        period_start: { type: 'string' }, period_end: { type: 'string' },
        idempotency_key: { type: 'string', description: 'Stable key for retry-safe save.' },
        reconciliation_id: {
          type: 'string',
          description: 'The reconciliation run ID to associate the results with. Defaults to active run if omitted.',
        },
        items: {
          type: 'array',
          description: 'Array of compared transaction items categorized via MCP.',
          items: {
            type: 'object',
            properties: {
              transaction_id: {
                type: 'string',
                description: 'Unique transaction identifier (e.g. "TXN001").',
              },
              ledger_transaction_id: { type: ['string','null'] },
              bank_transaction_id: { type: ['string','null'] },
              transaction_date: {
                type: 'string',
                description: 'Date of the transaction (YYYY-MM-DD).',
              },
              description: {
                type: 'string',
                description: 'Description or counterparty details.',
              },
              ledger_amount: {
                type: ['number', 'null'],
                description: 'Amount in Internal Ledger, or null if missing in ledger.',
              },
              bank_amount: {
                type: ['number', 'null'],
                description: 'Amount in Bank Statement, or null if missing in bank.',
              },
              match_status: {
                type: 'string',
                enum: [
                  'Matched',
                  'Probable Match',
                  'Amount Mismatch',
                  'Missing in Bank',
                  'Missing in Ledger',
                  'Potential Duplicate',
                ],
                description: 'Reconciliation matching classification.',
              },
              difference: {
                type: 'number',
                description: 'Absolute difference between ledger and bank amounts.',
              },
              reconciliation_reason: {
                type: 'string',
                description: 'Reason for reconciliation (e.g. "Exact Match", "Timing / In-Transit", "Bank Fee / Charge", "Amount Variance").',
              },
              matching_explanation: { type: 'string' },
              confidence_level: { type: 'number', minimum: 0, maximum: 1 },
            },
            required: ['match_status'],
          },
        },
      },
      required: ['items'],
    },
  },
  {
    name: 'list_reconciliation_items',
    description:
      'Retrieve reconciliation exception records from ReconcileFlow. Allows fetching by status ("unreconciled", "reconciled"), time period (start_date, end_date), unreconciled till date, counterparty search, or category. No technical ID required.',
    inputSchema: {
      type: 'object',
      properties: {
        period_start: { type: 'string' }, period_end: { type: 'string' },
        page: { type: 'integer', minimum: 1 }, page_size: { type: 'integer', minimum: 1, maximum: 500 },
        minimum_difference: { type: 'number' }, maximum_difference: { type: 'number' },
        description: { type: 'string' }, transaction_date_start: { type: 'string' }, transaction_date_end: { type: 'string' },
        status: {
          type: 'string',
          enum: ['unreconciled', 'reconciled', 'all'],
          description: 'High-level status: "unreconciled" (all open exceptions) vs "reconciled" (resolved/matched).',
        },
        till_date: {
          type: 'string',
          description: 'Fetch items up to a specific date (YYYY-MM-DD, e.g. "2026-11-05"). Perfect for "unreconciled till date".',
        },
        start_date: {
          type: 'string',
          description: 'Start of date range (YYYY-MM-DD).',
        },
        end_date: {
          type: 'string',
          description: 'End of date range (YYYY-MM-DD).',
        },
        search: {
          type: 'string',
          description: 'Search counterparty, vendor name, UTR number, or transaction description (e.g. "AWS", "Stripe", "PO-409").',
        },
        match_status: {
          type: 'string',
          enum: [
            'Matched',
            'Probable Match',
            'Amount Mismatch',
            'Missing in Bank',
            'Missing in Ledger',
            'Potential Duplicate',
          ],
          description: 'Filter by discrepancy category.',
        },
        resolution_status: {
          type: 'string',
          enum: ['Open', 'In Progress', 'Resolved'],
          description: 'Filter by specific resolution workflow status.',
        },
        assignee: {
          type: 'string',
          description: 'Filter by assigned team member (e.g. "Rahul Sharma", "Priya Patel").',
        },
        transaction_id: {
          type: 'string',
          description: 'Filter by specific transaction reference (e.g. "TXN002").',
        },
        reconciliation_id: {
          type: 'string',
          description: 'Optional reconciliation run ID. Defaults to active operating account if omitted.',
        },
      },
    },
  },
  {
    name: 'update_reconciliation_item',
    description:
      'Update an exception resolution status, assigned owner, or reconciliation reason in ReconcileFlow. Accepts transaction reference (e.g. "TXN002") or item UUID. No obscure ID required.',
    inputSchema: {
      type: 'object',
      properties: {
        item_id: {
          type: 'string',
          description: 'Unique item UUID or transaction reference ID (e.g. "TXN002").',
        },
        transaction_id: {
          type: 'string',
          description: 'Alternative alias for item_id (e.g. "TXN002").',
        },
        resolution_status: {
          type: 'string',
          enum: ['Open', 'In Progress', 'Resolved'],
          description: 'Updated resolution status. "Resolved" marks the item as reconciled.',
        },
        reconciliation_reason: {
          type: 'string',
          description: 'Short reason for reconciliation (e.g. "Exact Match", "Timing / In-Transit", "Bank Fee / Charge", "Amount Variance", "Tax Withholding (TDS)", "Duplicate Reversed").',
        },
        assignee: {
          type: 'string',
          description: 'Team member responsible for this exception.',
        },
        resolution_notes: {
          type: 'string',
          description: 'Investigation details or audit explanation.',
        },
        investigation_comment: { type: 'string', description: 'Append an investigation comment to audit history.' },
        actor: { type: 'string' }, period_start: { type: 'string' }, period_end: { type: 'string' },
      },
    },
  },
  {
    name: 'bulk_update_reconciliation_items',
    description: 'Bulk update items selected by period and exception filters. Returns matched, updated, and failed counts.',
    inputSchema: { type: 'object', properties: {
      period_start: { type: 'string' }, period_end: { type: 'string' },
      reconciliation_id: { type: 'string' }, match_status: { type: 'string', enum: VALID_MATCH_STATUSES },
      resolution_status: { type: 'string', enum: VALID_RESOLUTION_STATUSES }, assignee_filter: { type: 'string' },
      minimum_difference: { type: 'number' }, maximum_difference: { type: 'number' }, transaction_id: { type: 'string' }, description: { type: 'string' },
      updates: { type: 'object', properties: { resolution_status: { type: 'string', enum: VALID_RESOLUTION_STATUSES }, assignee: { type: 'string' }, resolution_notes: { type: 'string' }, investigation_comment: { type: 'string' }, actor: { type: 'string' } }, required: [] },
      confirm: { type: 'boolean', description: 'Set true after reviewing total_matching to execute a consequential bulk update.' },
    }, required: ['updates'] },
  },
];


export interface MCPToolCallResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

export function executeMCPTool(toolName: string, args: Record<string, any> = {}): MCPToolCallResult {
  try {
    args = { ...args, start_date: args.period_start || args.start_date, end_date: args.period_end || args.end_date };
    if (toolName === 'get_reconciliation_datasets') toolName = 'get_reconciliation_data';
    if (toolName === 'create_reconciliation_results') toolName = 'save_reconciliation_results';
    switch (toolName) {
      case 'get_reconciliation_summary': {
        const summary = db.getReconciliationSummary({
          run_id: args.reconciliation_id,
          start_date: args.start_date,
          end_date: args.end_date,
          till_date: args.till_date,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(summary, null, 2),
            },
          ],
        };
      }

      case 'get_reconciliation_data': {
        const run = args.reconciliation_id ? db.getRunById(args.reconciliation_id) : db.resolveRun(args.start_date || '0000-01-01', args.end_date || '9999-12-31');
        if (!run) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Error: No reconciliation run found for the requested period. Provide a run context or upload both datasets.' }],
          };
        }

        let ledger = run.ledger_data || [];
        let bank = run.bank_data || [];

        if (args.start_date) {
          ledger = ledger.filter((r) => r.transaction_date >= args.start_date);
          bank = bank.filter((r) => r.transaction_date >= args.start_date);
        }
        if (args.end_date) {
          ledger = ledger.filter((r) => r.transaction_date <= args.end_date);
          bank = bank.filter((r) => r.transaction_date <= args.end_date);
        }

        const page = Math.max(1, Number(args.page || 1)), pageSize = Math.min(500, Math.max(1, Number(args.page_size || 100)));
        const all: any[] = args.source_type === 'ledger' ? ledger.map(x=>({...x,source_type:'ledger'})) : args.source_type === 'bank_statement' ? bank.map(x=>({...x,source_type:'bank_statement'})) : [...ledger.map(x=>({...x,source_type:'ledger'})), ...bank.map(x=>({...x,source_type:'bank_statement'}))];
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  reconciliation_id: run.id,
                  name: run.name,
                  period: {
                    start_date: args.start_date || run.start_date,
                    end_date: args.end_date || run.end_date,
                  },
                  ledger_file_name: run.ledger_file_name,
                  bank_file_name: run.bank_file_name,
                  ledger_records_count: ledger.length,
                  bank_records_count: bank.length,
                  dataset_status: !run.ledger_file_name || !run.bank_file_name || !ledger.length || !bank.length ? 'incomplete' : 'available',
                  source_type: args.source_type || 'both',
                  transactions: all.slice((page-1)*pageSize,page*pageSize),
                  pagination: { page, page_size: pageSize, total_records: all.length, total_pages: Math.ceil(all.length/pageSize) },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'save_reconciliation_results': {
        const run = args.reconciliation_id ? db.getRunById(args.reconciliation_id) : db.resolveRun(args.start_date || '0000-01-01', args.end_date || '9999-12-31');
        if (!run) return { isError: true, content: [{ type:'text', text:'No unique reconciliation run found for this period. Choose a run explicitly when multiple runs exist.' }] };
        const runId = run.id;
        const items = args.items;

        if (!Array.isArray(items) || items.length === 0) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Error: Parameter "items" must be a non-empty array.' }],
          };
        }

        // Validate items
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const ledger = run.ledger_data.find(row => row.transaction_id === it.ledger_transaction_id || row.transaction_id === it.transaction_id);
          const bank = run.bank_data.find(row => row.transaction_id === it.bank_transaction_id || row.transaction_id === it.transaction_id);
          it.transaction_id = it.transaction_id || it.ledger_transaction_id || it.bank_transaction_id || `${ledger?.transaction_id || ''}:${bank?.transaction_id || ''}`;
          it.transaction_date = it.transaction_date || ledger?.transaction_date || bank?.transaction_date;
          it.description = it.description || ledger?.description || bank?.description || '';
          if (it.ledger_amount === undefined && ledger) it.ledger_amount = ledger.amount;
          if (it.bank_amount === undefined && bank) it.bank_amount = bank.amount;
          if (!it.transaction_id || !it.transaction_date) {
            return {
              isError: true,
              content: [{ type: 'text', text: `Error on item #${i + 1}: Missing "transaction_id".` }],
            };
          }
          const normalizedMatchStatus = ({ matched:'Matched', probable_match:'Probable Match', amount_mismatch:'Amount Mismatch', missing_in_bank:'Missing in Bank', missing_in_ledger:'Missing in Ledger', potential_duplicate:'Potential Duplicate' } as Record<string,string>)[it.match_status] || it.match_status;
          it.match_status = normalizedMatchStatus;
          if (!VALID_MATCH_STATUSES.includes(it.match_status)) {
            return {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: `Error on item #${i + 1} (${it.transaction_id}): Invalid match_status "${it.match_status}". Must be one of: ${VALID_MATCH_STATUSES.join(', ')}.`,
                },
              ],
            };
          }
        }

        const createdRecords = db.createReconciliationResults(runId, items.map((item:any)=>({...item, idempotency_key: item.idempotency_key || (args.idempotency_key ? `${args.idempotency_key}:${item.transaction_id}` : undefined)})));

        const matched = createdRecords.filter((i) => i.match_status === 'Matched').length;
        const exceptions = createdRecords.filter((i) => i.match_status !== 'Matched').length;
        const totalDiscrepancy = createdRecords
          .filter((i) => i.match_status !== 'Matched')
          .reduce((sum, i) => sum + i.difference, 0);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Successfully saved ${createdRecords.length} reconciliation results for run "${runId}".`,
                  reconciliation_id: runId,
                  summary: {
                    total_analysed: createdRecords.length,
                    matched_count: matched,
                    exception_count: exceptions,
                    total_discrepancy_amount: totalDiscrepancy,
                  },
                  items_created: createdRecords.map((r) => ({
                    id: r.id,
                    transaction_id: r.transaction_id,
                    transaction_date: r.transaction_date,
                    ledger_amount: r.ledger_amount,
                    bank_amount: r.bank_amount,
                    difference: r.difference,
                    match_status: r.match_status,
                    resolution_status: r.resolution_status,
                    assignee: r.assignee,
                    reconciliation_reason: r.reconciliation_reason,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'list_reconciliation_items': {
        const filters = {
          run_id: args.reconciliation_id || db.resolveRun(args.start_date || '0000-01-01', args.end_date || '9999-12-31')?.id,
          match_status: args.match_status,
          resolution_status: args.resolution_status,
          status: args.status,
          start_date: args.start_date,
          end_date: args.end_date,
          till_date: args.till_date,
          assignee: args.assignee,
          transaction_id: args.transaction_id,
          search: args.search || args.description,
          minimum_difference: args.minimum_difference,
          maximum_difference: args.maximum_difference,
        };

        const results = db.findItemsByFilters(filters);
        const page = Math.max(1, Number(args.page || 1)), pageSize = Math.min(500, Math.max(1, Number(args.page_size || 100)));

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: results.length,
                  pagination: { page, page_size: pageSize, total_records: results.length, total_pages: Math.ceil(results.length/pageSize) },
                  filters,
                items: results.slice((page-1)*pageSize,page*pageSize).map((r) => ({
                    id: r.id,
                    run_id: r.run_id,
                    transaction_id: r.transaction_id,
                    transaction_date: r.transaction_date,
                    description: r.description,
                    ledger_amount: r.ledger_amount,
                    bank_amount: r.bank_amount,
                    difference: r.difference,
                    match_status: r.match_status,
                    resolution_status: r.resolution_status,
                    assignee: r.assignee,
                    reconciliation_reason: r.reconciliation_reason,
                    matching_explanation: r.matching_explanation,
                    confidence_level: r.confidence_level,
                    resolution_notes: r.resolution_notes,
                  })),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'update_reconciliation_item': {
        const itemId = args.item_id || args.transaction_id;
        if (!itemId) {
          return {
            isError: true,
            content: [{ type: 'text', text: 'Error: Missing required parameter "item_id" or "transaction_id".' }],
          };
        }


        if (args.resolution_status && !VALID_RESOLUTION_STATUSES.includes(args.resolution_status)) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error: Invalid resolution_status "${args.resolution_status}". Must be one of: ${VALID_RESOLUTION_STATUSES.join(', ')}.`,
              },
            ],
          };
        }

        const updated = db.updateItem(itemId, {
          resolution_status: args.resolution_status,
          assignee: args.assignee,
          resolution_notes: args.resolution_notes,
          reconciliation_reason: args.reconciliation_reason,
          investigation_comment: args.investigation_comment,
          actor: args.actor,
          run_id: args.reconciliation_id || db.resolveRun(args.start_date || '0000-01-01', args.end_date || '9999-12-31')?.id,
        });

        if (!updated) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Error: Reconciliation item with ID or transaction reference "${itemId}" not found.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  message: `Reconciliation item "${updated.transaction_id}" successfully updated.`,
                  item: {
                    id: updated.id,
                    transaction_id: updated.transaction_id,
                    match_status: updated.match_status,
                    resolution_status: updated.resolution_status,
                    assignee: updated.assignee,
                    reconciliation_reason: updated.reconciliation_reason,
                    resolution_notes: updated.resolution_notes,
                    updated_at: updated.updated_at,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'bulk_update_reconciliation_items': {
        const filters:any = { run_id: args.reconciliation_id || db.resolveRun(args.start_date || '0000-01-01', args.end_date || '9999-12-31')?.id,
          match_status: args.match_status, resolution_status: args.resolution_status_filter,
          assignee: args.assignee_filter, transaction_id: args.transaction_id, description: args.description,
          minimum_difference: args.minimum_difference, maximum_difference: args.maximum_difference };
        const matching = db.findItemsByFilters(filters);
        if (!args.confirm) return { content: [{ type:'text', text: JSON.stringify({confirmation_required:true,total_matching:matching.length,filters,action:args.updates}) }] };
        if (args.updates?.resolution_status && !VALID_RESOLUTION_STATUSES.includes(args.updates.resolution_status)) throw new Error('Invalid resolution_status');
        if (args.updates && Object.keys(args.updates).some((key:string)=>['match_status','ledger_amount','bank_amount','difference'].includes(key))) throw new Error('Bulk updates cannot modify original match classification or amounts.');
        const result = db.bulkUpdateItems(filters,{...args.updates, actor: args.updates?.actor || args.actor});
        return { content:[{type:'text',text:JSON.stringify(result)}] };
      }


      default:
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Unknown tool "${toolName}". Available tools: ${MCP_TOOLS_DEFINITIONS.map((t) => t.name).join(', ')}`,
            },
          ],
        };
    }
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Tool execution error: ${err?.message || String(err)}` }],
    };
  }
}

/**
 * Handle standard MCP JSON-RPC 2.0 messages
 */
export function handleJsonRpcMessage(body: any): any {
  const { jsonrpc, id, method, params } = body || {};

  if (jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: id || null,
      error: {
        code: -32600,
        message: 'Invalid Request: "jsonrpc" version must be "2.0".',
      },
    };
  }

  if (!id && method?.startsWith('notifications/')) {
    return null;
  }

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: 'reconcileflow-mcp',
            version: '2.0.0',
            description: 'ReconcileFlow Bank Reconciliation Exception Management Platform MCP Server',
          },
        },
      };

    case 'ping':
      return {
        jsonrpc: '2.0',
        id,
        result: {},
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS_DEFINITIONS,
        },
      };

    case 'tools/call': {
      const toolName = params?.name;
      const toolArguments = params?.arguments || {};

      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Invalid params: Missing tool name.',
          },
        };
      }

      const executionResult = executeMCPTool(toolName, toolArguments);

      return {
        jsonrpc: '2.0',
        id,
        result: executionResult,
      };
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`,
        },
      };
  }
}
