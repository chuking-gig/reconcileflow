import React, { useEffect, useMemo, useState } from 'react';
import { api, McpServerInfo } from '../api.ts';
import { Check, Copy, ExternalLink, Play, RefreshCw } from 'lucide-react';

interface McpIntegrationViewProps {
  onRefreshDashboard: () => void | Promise<void>;
  onSelectTab: (tab: 'reconciliation' | 'mcp') => void;
}

const PERIOD = { period_start: '2026-11-01', period_end: '2026-11-30' };
const TOOL_EXAMPLES: Record<string, Record<string, unknown>> = {
  get_reconciliation_data: { ...PERIOD, source_type: 'both', page: 1, page_size: 50 },
  save_reconciliation_results: { ...PERIOD, items: [{ transaction_id: 'TXN001', transaction_date: '2026-11-01', description: 'AWS Cloud Hosting', ledger_amount: 25000, bank_amount: 25000, difference: 0, match_status: 'Matched', matching_explanation: 'Amount and date agree; descriptions refer to the same vendor.', confidence_level: 0.99 }] },
  get_reconciliation_summary: { ...PERIOD },
  list_reconciliation_items: { ...PERIOD, match_status: 'Amount Mismatch', minimum_difference: 10000, page: 1, page_size: 25 },
  update_reconciliation_item: { ...PERIOD, transaction_id: 'TXN002', resolution_status: 'In Progress', assignee: 'Rahul Sharma', investigation_comment: 'Requested supporting invoice.' },
  bulk_update_reconciliation_items: { ...PERIOD, match_status: 'Missing in Bank', updates: { assignee: 'Rahul Sharma', resolution_status: 'In Progress' }, confirm: false },
};

const TOOL_DETAILS = [
  { name: 'get_reconciliation_data', label: 'Get source transactions', description: 'Read original ledger and bank rows with pagination.' },
  { name: 'save_reconciliation_results', label: 'Save analysis', description: 'Persist match decisions with explanations and confidence.' },
  { name: 'get_reconciliation_summary', label: 'Get summary', description: 'Read backend totals, exceptions, and resolution progress.' },
  { name: 'list_reconciliation_items', label: 'Find exceptions', description: 'Filter by status, owner, amount, date, reference, or description.' },
  { name: 'update_reconciliation_item', label: 'Update an item', description: 'Change workflow state, assignee, notes, or investigation comments.' },
  { name: 'bulk_update_reconciliation_items', label: 'Bulk update', description: 'Preview affected items, then confirm the operational update.' },
];

export const McpIntegrationView: React.FC<McpIntegrationViewProps> = ({ onRefreshDashboard }) => {
  const [mcpInfo, setMcpInfo] = useState<McpServerInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [selectedTool, setSelectedTool] = useState(TOOL_DETAILS[2].name);
  const [argsText, setArgsText] = useState(JSON.stringify(TOOL_EXAMPLES[TOOL_DETAILS[2].name], null, 2));
  const [response, setResponse] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.getMcpInfo().then(setMcpInfo).catch((err) => setError(err.message || 'Could not load MCP server details.')); }, []);

  const endpoint = useMemo(() => `${window.location.origin}/api/mcp`, []);
  const clientConfig = JSON.stringify({ mcpServers: { reconcileflow: { url: endpoint } } }, null, 2);

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { setError('Clipboard access is unavailable in this browser.'); }
  };

  const chooseTool = (name: string) => {
    setSelectedTool(name);
    setArgsText(JSON.stringify(TOOL_EXAMPLES[name] || {}, null, 2));
    setResponse(null);
    setError(null);
  };

  const runTool = async () => {
    let args: Record<string, unknown>;
    try { args = JSON.parse(argsText); }
    catch (err: any) { setError(`Arguments must be valid JSON: ${err.message}`); return; }
    setIsRunning(true); setError(null); setResponse(null);
    try {
      const result = await api.executeMcpTool(selectedTool, args);
      setResponse(JSON.stringify(result, null, 2));
      if (['save_reconciliation_results', 'update_reconciliation_item', 'bulk_update_reconciliation_items'].includes(selectedTool) && !result.isError) await onRefreshDashboard();
    } catch (err: any) { setError(err?.message || 'The tool call failed.'); }
    finally { setIsRunning(false); }
  };

  const availableNames = new Set((mcpInfo?.tools || []).map((tool: any) => tool.name));

  return (
    <div className="max-w-5xl mx-auto space-y-5 text-xs">
      <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-sm font-semibold text-slate-900">Connect an AI client to ReconcileFlow</h1>
            <p className="text-[11px] text-slate-500 mt-1">The connected client performs analysis. ReconcileFlow provides controlled access to source data and stores results and operational changes.</p>
          </div>
          <span className="px-2 py-1 rounded border border-emerald-200 bg-emerald-50 text-emerald-700 font-medium">{mcpInfo?.status === 'online' ? 'Server available' : 'Checking server'}</span>
        </div>
        <div className="grid md:grid-cols-3 gap-2 pt-2">
          {['Read original transactions', 'Analyze and save matches', 'Investigate and update exceptions'].map((step, i) => <div key={step} className="rounded border border-slate-200 bg-slate-50 p-3"><span className="text-slate-400 mr-2">0{i + 1}</span><span className="font-medium text-slate-700">{step}</span></div>)}
        </div>
      </section>

      <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="font-semibold text-slate-900">MCP connection</h2><p className="text-[11px] text-slate-500 mt-1">Streamable HTTP endpoint. Use the public HTTPS URL when connecting from a hosted client.</p></div>
          <span className="shrink-0 rounded bg-slate-100 px-2 py-1 font-mono text-[10px] text-slate-600">{mcpInfo?.version || 'MCP'}</span>
        </div>
        <div className="flex items-center gap-2 rounded border border-slate-200 bg-slate-50 p-2.5">
          <code className="flex-1 min-w-0 break-all text-slate-800">{endpoint}</code>
          <button onClick={() => copy(endpoint)} className="shrink-0 flex items-center gap-1 text-slate-600 hover:text-slate-950" aria-label="Copy MCP endpoint">{copied ? <Check size={14} /> : <Copy size={14} />}<span>{copied ? 'Copied' : 'Copy'}</span></button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] text-slate-500">Clients sign in with Auth0 OAuth when the server is configured.</span>
          <button onClick={() => copy(clientConfig)} className="flex items-center gap-1 text-slate-700 hover:text-slate-950"><Copy size={13} /> Copy client config</button>
        </div>
        <pre className="rounded bg-slate-950 p-3 text-[10px] text-emerald-300 overflow-x-auto">{clientConfig}</pre>
      </section>

      <section className="bg-white rounded-lg border border-slate-200 p-5 space-y-4">
        <div><h2 className="font-semibold text-slate-900">Available tools</h2><p className="text-[11px] text-slate-500 mt-1">Select a tool to inspect or try its arguments. Bulk updates show a preview until <code>confirm</code> is set to <code>true</code>.</p></div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {TOOL_DETAILS.map((tool) => {
            const active = selectedTool === tool.name;
            const published = !mcpInfo || availableNames.has(tool.name);
            return <button key={tool.name} onClick={() => chooseTool(tool.name)} className={`rounded border p-3 text-left transition-colors ${active ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 hover:bg-slate-50 text-slate-800'}`}>
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{tool.label}</span><span className={`text-[9px] ${active ? 'text-slate-300' : published ? 'text-emerald-700' : 'text-amber-700'}`}>{published ? 'Available' : 'Not listed'}</span></div>
              <code className={`block mt-1 text-[10px] break-all ${active ? 'text-slate-300' : 'text-slate-500'}`}>{tool.name}</code>
              <p className={`mt-2 text-[10px] ${active ? 'text-slate-300' : 'text-slate-500'}`}>{tool.description}</p>
            </button>;
          })}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <div>
            <label htmlFor="mcp-tool-args" className="block font-medium text-slate-700 mb-1">Arguments (JSON)</label>
            <textarea id="mcp-tool-args" value={argsText} onChange={(event) => setArgsText(event.target.value)} rows={13} spellCheck={false} className="w-full rounded border border-slate-200 bg-slate-50 p-3 font-mono text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-700" />
            <div className="flex items-center gap-2 mt-2">
              {mcpInfo?.toolInspectorEnabled !== false ? <button onClick={runTool} disabled={isRunning} className="flex items-center gap-1.5 rounded bg-slate-900 px-3 py-2 text-white hover:bg-slate-800 disabled:opacity-50"><Play size={13} />{isRunning ? 'Running…' : 'Run tool'}</button> : <span className="py-2 text-[10px] text-slate-500">Use an OAuth-connected MCP client to run remote tools.</span>}
              <button onClick={() => { setArgsText(JSON.stringify(TOOL_EXAMPLES[selectedTool] || {}, null, 2)); setError(null); }} className="flex items-center gap-1 rounded px-2 py-2 text-slate-600 hover:bg-slate-100"><RefreshCw size={12} /> Reset example</button>
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1"><span className="font-medium text-slate-700">Tool response</span>{response && <button onClick={() => copy(response)} className="flex items-center gap-1 text-slate-500 hover:text-slate-900"><Copy size={12} /> Copy</button>}</div>
            {error && <div role="alert" className="mb-2 rounded border border-rose-200 bg-rose-50 p-2 text-rose-700">{error}</div>}
            <pre className="min-h-[300px] max-h-[480px] overflow-auto rounded border border-slate-800 bg-slate-950 p-3 text-[10px] text-emerald-300 whitespace-pre-wrap">{response || 'Run a tool to view its response.'}</pre>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-[11px] text-blue-900">
        <div className="flex gap-2"><ExternalLink size={14} className="shrink-0 mt-0.5" /><p><strong>Workflow:</strong> read both datasets, compare transactions using dates, amounts, and descriptions (source IDs may differ), save results, then verify with the summary. Resolve exceptions only after investigation; resolution status does not change match status.</p></div>
      </section>
    </div>
  );
};
