export type MatchStatus =
  | 'Matched'
  | 'Amount Mismatch'
  | 'Missing in Bank'
  | 'Missing in Ledger'
  | 'Potential Duplicate';

export type ResolutionStatus = 'Open' | 'In Progress' | 'Resolved';

export interface CsvTransactionRow {
  transaction_id: string;
  transaction_date: string;
  description: string;
  amount: number;
}

export interface ReconciliationRun {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'Pending Analysis' | 'Completed' | 'In Progress';
  total_transactions: number;
  matched_count: number;
  exception_count: number;
  discrepancy_amount: number;
  ledger_file_name: string | null;
  bank_file_name: string | null;
  ledger_data?: CsvTransactionRow[];
  bank_data?: CsvTransactionRow[];
  created_at: string;
}

export interface ReconciliationItem {
  id: string;
  run_id: string;
  transaction_id: string;
  transaction_date: string;
  description: string;
  ledger_amount: number | null;
  bank_amount: number | null;
  difference: number;
  match_status: MatchStatus;
  resolution_status: ResolutionStatus;
  assignee: string | null;
  resolution_notes: string | null;
  reconciliation_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardStats {
  totalRuns: number;
  totalTransactionsReconciled: number;
  totalOpenExceptions: number;
  totalDiscrepancyAmount: number;
  totalExceptions: number;
  recentRuns: ReconciliationRun[];
}

export interface McpServerInfo {
  name: string;
  version: string;
  description: string;
  endpoints: {
    jsonRpcHttp: string;
    sse: string;
    sseMessages: string;
  };
  tools: any[];
  mcpClientConfig: any;
  status: string;
  toolInspectorEnabled?: boolean;
}

export const api = {
  async getDashboardStats(): Promise<DashboardStats> {
    const res = await fetch('/api/dashboard/stats');
    if (!res.ok) throw new Error('Failed to fetch dashboard stats');
    return res.json();
  },

  async getReconciliations(): Promise<ReconciliationRun[]> {
    const res = await fetch('/api/reconciliations');
    if (!res.ok) throw new Error('Failed to fetch reconciliations');
    const data = await res.json();
    return data.runs;
  },

  async getReconciliation(id: string): Promise<ReconciliationRun> {
    const res = await fetch(`/api/reconciliations/${id}`);
    if (!res.ok) throw new Error('Failed to fetch reconciliation run');
    return res.json();
  },

  async createReconciliation(data: {
    name: string;
    start_date: string;
    end_date: string;
    ledger_file_name?: string;
    bank_file_name?: string;
    ledger_data?: CsvTransactionRow[];
    bank_data?: CsvTransactionRow[];
  }): Promise<ReconciliationRun> {
    const res = await fetch('/api/reconciliations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to create reconciliation' }));
      throw new Error(err.error || 'Failed to create reconciliation');
    }
    return res.json();
  },

  async deleteReconciliation(id: string): Promise<void> {
    const res = await fetch(`/api/reconciliations/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete reconciliation');
  },

  async getReconciliationItems(
    runId: string,
    filters?: {
      match_status?: string;
      resolution_status?: string;
      status?: string;
      start_date?: string;
      end_date?: string;
      till_date?: string;
      assignee?: string;
      search?: string;
    }
  ): Promise<ReconciliationItem[]> {
    const params = new URLSearchParams();
    if (filters?.match_status && filters.match_status !== 'all') {
      params.set('match_status', filters.match_status);
    }
    if (filters?.resolution_status && filters.resolution_status !== 'all') {
      params.set('resolution_status', filters.resolution_status);
    }
    if (filters?.status && filters.status !== 'all') {
      params.set('status', filters.status);
    }
    if (filters?.start_date) {
      params.set('start_date', filters.start_date);
    }
    if (filters?.end_date) {
      params.set('end_date', filters.end_date);
    }
    if (filters?.till_date) {
      params.set('till_date', filters.till_date);
    }
    if (filters?.assignee && filters.assignee !== 'all') {
      params.set('assignee', filters.assignee);
    }
    if (filters?.search) {
      params.set('search', filters.search);
    }

    const res = await fetch(`/api/reconciliations/${runId}/items?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch reconciliation items');
    const data = await res.json();
    return data.items;
  },

  async getReconciliationSummary(
    runId: string,
    filters?: {
      start_date?: string;
      end_date?: string;
      till_date?: string;
    }
  ) {
    const params = new URLSearchParams();
    if (filters?.start_date) params.set('start_date', filters.start_date);
    if (filters?.end_date) params.set('end_date', filters.end_date);
    if (filters?.till_date) params.set('till_date', filters.till_date);

    const res = await fetch(`/api/reconciliations/${runId}/summary?${params.toString()}`);
    if (!res.ok) throw new Error('Failed to fetch reconciliation summary');
    return res.json();
  },


  async updateItem(
    id: string,
    updates: {
      resolution_status?: ResolutionStatus;
      assignee?: string | null;
      resolution_notes?: string | null;
      reconciliation_reason?: string | null;
    }
  ): Promise<ReconciliationItem> {
    const res = await fetch(`/api/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Failed to update item' }));
      throw new Error(err.error || 'Failed to update item');
    }
    return res.json();
  },

  async fetchNewTransactions(runId?: string): Promise<{ success: boolean; message: string; run: ReconciliationRun; newCount: number }> {
    const res = await fetch('/api/reconciliations/fetch-transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ run_id: runId }),
    });
    if (!res.ok) throw new Error('Failed to fetch new transactions');
    return res.json();
  },

  async runMcpReconcile(runId: string): Promise<{ run: ReconciliationRun; mcp_result: any }> {
    const res = await fetch(`/api/reconciliations/${runId}/simulate-mcp-reconcile`, {
      method: 'POST',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Reconciliation analysis failed' }));
      throw new Error(err.error || 'Reconciliation analysis failed');
    }
    return res.json();
  },

  async resetData(): Promise<any> {
    const res = await fetch('/api/reset', { method: 'POST' });
    if (!res.ok) throw new Error('Failed to reset sample data');
    return res.json();
  },

  async getMcpInfo(): Promise<McpServerInfo> {
    const res = await fetch('/api/mcp/info');
    if (!res.ok) throw new Error('Failed to fetch MCP info');
    return res.json();
  },

  async executeMcpTool(toolName: string, args: Record<string, any>) {
    const res = await fetch('/api/mcp/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: toolName, arguments: args }),
    });
    if (!res.ok) throw new Error('Tool execution failed');
    return res.json();
  },
};

export function formatINR(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) {
    return '—';
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

// Downloadable templates and sample CSV data generator
export const SAMPLE_LEDGER_CSV = `transaction_id,transaction_date,description,amount
TXN001,2026-11-01,Vendor Payment - AWS Cloud Hosting,25000
TXN002,2026-11-02,Office Equipment Supplies PO-409,12000
TXN003,2026-11-03,Client Retainer Wire Transfer,50000
TXN004,2026-11-04,Executive Travel Reimbursement,8500
TXN005,2026-11-05,Marketing Retainer Payout,40000
TXN006,2026-11-06,Google Workspace Annual Subscription,18600
TXN008,2026-11-08,Freelance Design Retainer,8000
TXN008,2026-11-08,Freelance Design Retainer (Duplicate),8000`;

export const SAMPLE_BANK_CSV = `transaction_id,transaction_date,description,amount
TXN001,2026-11-01,Direct Debit AWS Cloud Hosting,25000
TXN002,2026-11-02,Debit POS Office Supplies,10000
TXN003,2026-11-03,Inward Wire Client Retainer,50000
TXN005,2026-11-05,NEFT Payout Marketing Retainer,40000
TXN006,2026-11-06,International Card Debit Google Workspace,18600
TXN007,2026-11-07,Bank Intermediary Correspondent Fee,1500
TXN008,2026-11-08,IMPS Payout Freelance Designer,8000`;

export function downloadCsvFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
