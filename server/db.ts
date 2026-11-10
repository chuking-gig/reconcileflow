import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { runFuzzyReconciliation } from './fuzzyMatcher.js';

export type MatchStatus =
  | 'Matched'
  | 'Probable Match'
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
  ledger_data: CsvTransactionRow[];
  bank_data: CsvTransactionRow[];
  created_at: string;
}

export interface ReconciliationItem {
  id: string;
  run_id: string;
  transaction_id: string;
  ledger_transaction_id?: string | null;
  bank_transaction_id?: string | null;
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
  matching_explanation?: string | null;
  confidence_level?: number | null;
  idempotency_key?: string | null;
}

export interface ReconciliationAuditLog {
  id: string; item_id: string; action: string; previous_value: unknown;
  new_value: unknown; actor: string; timestamp: string;
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const RUNS_FILE = path.join(DATA_DIR, 'reconciliation_runs.json');
const ITEMS_FILE = path.join(DATA_DIR, 'reconciliation_items.json');
const AUDIT_FILE = path.join(DATA_DIR, 'reconciliation_audit_logs.json');

// Sample default CSV datasets for November 2026
export const SAMPLE_LEDGER_DATA: CsvTransactionRow[] = [
  { transaction_id: 'TXN001', transaction_date: '2026-11-01', description: 'Vendor Payment - AWS Cloud Hosting', amount: 25000 },
  { transaction_id: 'TXN002', transaction_date: '2026-11-02', description: 'Office Equipment Supplies PO-409', amount: 12000 },
  { transaction_id: 'TXN003', transaction_date: '2026-11-03', description: 'Client Retainer Wire Transfer', amount: 50000 },
  { transaction_id: 'TXN004', transaction_date: '2026-11-04', description: 'Executive Travel Reimbursement', amount: 8500 },
  { transaction_id: 'TXN005', transaction_date: '2026-11-05', description: 'Marketing Retainer Payout', amount: 40000 },
  { transaction_id: 'TXN006', transaction_date: '2026-11-06', description: 'Google Workspace Annual Subscription', amount: 18600 },
  { transaction_id: 'TXN008', transaction_date: '2026-11-08', description: 'Freelance Design Retainer', amount: 8000 },
  { transaction_id: 'TXN008', transaction_date: '2026-11-08', description: 'Freelance Design Retainer (Duplicate)', amount: 8000 },
];

export const SAMPLE_BANK_DATA: CsvTransactionRow[] = [
  { transaction_id: 'TXN001', transaction_date: '2026-11-01', description: 'Direct Debit AWS Cloud Hosting', amount: 25000 },
  { transaction_id: 'TXN002', transaction_date: '2026-11-02', description: 'Debit POS Office Supplies', amount: 10000 }, // Mismatch: 12000 vs 10000
  { transaction_id: 'TXN003', transaction_date: '2026-11-03', description: 'Inward Wire Client Retainer', amount: 50000 }, // Matched
  { transaction_id: 'TXN005', transaction_date: '2026-11-05', description: 'NEFT Payout Marketing Retainer', amount: 40000 }, // Matched
  { transaction_id: 'TXN006', transaction_date: '2026-11-06', description: 'International Card Debit Google Workspace', amount: 18600 }, // Matched
  { transaction_id: 'TXN007', transaction_date: '2026-11-07', description: 'Bank Intermediary Correspondent Fee', amount: 1500 }, // Missing in Ledger
  { transaction_id: 'TXN008', transaction_date: '2026-11-08', description: 'IMPS Payout Freelance Designer', amount: 8000 }, // Duplicate in ledger
];

class DatabaseStore {
  private runs: Map<string, ReconciliationRun> = new Map();
  private items: Map<string, ReconciliationItem> = new Map();
  private auditLogs: ReconciliationAuditLog[] = [];

  constructor() {
    this.init();
  }

  private init() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      let runsLoaded = false;
      if (fs.existsSync(RUNS_FILE)) {
        const raw = fs.readFileSync(RUNS_FILE, 'utf-8');
        const parsed: ReconciliationRun[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((r) => this.runs.set(r.id, r));
          runsLoaded = true;
        }
      }

      if (fs.existsSync(ITEMS_FILE)) {
        const raw = fs.readFileSync(ITEMS_FILE, 'utf-8');
        const parsed: ReconciliationItem[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((item) => this.items.set(item.id, item));
        }
      }
      if (fs.existsSync(AUDIT_FILE)) this.auditLogs = JSON.parse(fs.readFileSync(AUDIT_FILE, 'utf-8'));

      if (!runsLoaded || this.runs.size === 0 || this.items.size === 0) {
        this.seedInitialDemoData();
      }
    } catch (err) {
      console.error('Error loading database files, reseeding demo data:', err);
      this.seedInitialDemoData();
    }
  }


  private seedInitialDemoData() {
    this.runs.clear();
    this.items.clear();

    const runId = 'rec_run_nov2026';
    const now = new Date().toISOString();

    const sampleRun: ReconciliationRun = {
      id: runId,
      name: 'November 2026 Bank Reconciliation',
      start_date: '2026-11-01',
      end_date: '2026-11-30',
      status: 'Completed',
      total_transactions: 8,
      matched_count: 4,
      exception_count: 4,
      discrepancy_amount: 13500, // 2000 (mismatch) + 8500 (missing bank) + 1500 (missing ledger) + 8000 (duplicate) -> adjusted
      ledger_file_name: 'internal_ledger_nov2026.csv',
      bank_file_name: 'bank_statement_nov2026.csv',
      ledger_data: SAMPLE_LEDGER_DATA,
      bank_data: SAMPLE_BANK_DATA,
      created_at: new Date(Date.now() - 3600000 * 24).toISOString(),
    };

    this.runs.set(runId, sampleRun);

    const initialItems: Array<Omit<ReconciliationItem, 'id' | 'run_id' | 'created_at' | 'updated_at'>> = [
      {
        transaction_id: 'TXN001',
        transaction_date: '2026-11-01',
        description: 'Vendor Payment - AWS Cloud Hosting',
        ledger_amount: 25000,
        bank_amount: 25000,
        difference: 0,
        match_status: 'Matched',
        resolution_status: 'Resolved',
        assignee: 'System (Auto)',
        resolution_notes: 'Automatic match by MCP rules engine.',
        reconciliation_reason: 'Exact Match',
      },
      {
        transaction_id: 'TXN002',
        transaction_date: '2026-11-02',
        description: 'Office Equipment Supplies PO-409',
        ledger_amount: 12000,
        bank_amount: 10000,
        difference: 2000,
        match_status: 'Amount Mismatch',
        resolution_status: 'Open',
        assignee: 'Rahul Sharma',
        resolution_notes: 'Bank debit shows ₹10,000 against purchase order ledger entry of ₹12,000. Shortfall of ₹2,000.',
        reconciliation_reason: null,
      },
      {
        transaction_id: 'TXN003',
        transaction_date: '2026-11-03',
        description: 'Client Retainer Wire Transfer',
        ledger_amount: 50000,
        bank_amount: 50000,
        difference: 0,
        match_status: 'Matched',
        resolution_status: 'Resolved',
        assignee: 'System (Auto)',
        resolution_notes: 'Automatic match.',
        reconciliation_reason: 'Exact Match',
      },
      {
        transaction_id: 'TXN004',
        transaction_date: '2026-11-04',
        description: 'Executive Travel Reimbursement',
        ledger_amount: 8500,
        bank_amount: null,
        difference: 8500,
        match_status: 'Missing in Bank',
        resolution_status: 'Open',
        assignee: 'Priya Patel',
        resolution_notes: 'Voucher approved in ledger but payout cheque has not yet cleared bank statement.',
        reconciliation_reason: null,
      },
      {
        transaction_id: 'TXN005',
        transaction_date: '2026-11-05',
        description: 'Marketing Retainer Payout',
        ledger_amount: 40000,
        bank_amount: 40000,
        difference: 0,
        match_status: 'Matched',
        resolution_status: 'Resolved',
        assignee: 'System (Auto)',
        resolution_notes: 'Automatic match.',
        reconciliation_reason: 'Exact Match',
      },
      {
        transaction_id: 'TXN006',
        transaction_date: '2026-11-06',
        description: 'Google Workspace Annual Subscription',
        ledger_amount: 18600,
        bank_amount: 18600,
        difference: 0,
        match_status: 'Matched',
        resolution_status: 'Resolved',
        assignee: 'System (Auto)',
        resolution_notes: 'Automatic match.',
        reconciliation_reason: 'Exact Match',
      },
      {
        transaction_id: 'TXN007',
        transaction_date: '2026-11-07',
        description: 'Bank Intermediary Correspondent Fee',
        ledger_amount: null,
        bank_amount: 1500,
        difference: 1500,
        match_status: 'Missing in Ledger',
        resolution_status: 'Open',
        assignee: 'Rahul Sharma',
        resolution_notes: 'Bank deducted foreign wire correspondent fee not yet booked to bank charges account.',
        reconciliation_reason: null,
      },
      {
        transaction_id: 'TXN008',
        transaction_date: '2026-11-08',
        description: 'Freelance Design Retainer (Duplicate in Ledger)',
        ledger_amount: 8000,
        bank_amount: 8000,
        difference: 8000,
        match_status: 'Potential Duplicate',
        resolution_status: 'Open',
        assignee: 'Priya Patel',
        resolution_notes: 'Double entry detected in internal accounting ledger. Single payment cleared bank.',
        reconciliation_reason: null,
      },
    ];

    initialItems.forEach((item, index) => {
      const id = crypto.randomUUID();
      const createdAt = new Date(Date.now() - (initialItems.length - index) * 3600000 * 3).toISOString();
      this.items.set(id, {
        id,
        run_id: runId,
        ...item,
        created_at: createdAt,
        updated_at: createdAt,
      });
    });

    this.persistAll();
  }

  private persistAll() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(RUNS_FILE, JSON.stringify(Array.from(this.runs.values()), null, 2), 'utf-8');
      fs.writeFileSync(ITEMS_FILE, JSON.stringify(Array.from(this.items.values()), null, 2), 'utf-8');
      fs.writeFileSync(AUDIT_FILE, JSON.stringify(this.auditLogs, null, 2), 'utf-8');
      console.log(`[Database] Persisted ${this.runs.size} runs and ${this.items.size} items to disk.`);
    } catch (err) {
      console.error('Failed to persist database:', err);
    }
  }


  public resetToSample() {
    this.seedInitialDemoData();
    return {
      runs: this.getAllRuns(),
      items: this.getAllItems(),
    };
  }

  /* =========================================================================
     RECONCILIATION RUNS
     ========================================================================= */

  public getAllRuns(): ReconciliationRun[] {
    return Array.from(this.runs.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }

  public getRunById(id: string): ReconciliationRun | null {
    return this.runs.get(id) || null;
  }

  public createRun(data: {
    name: string;
    start_date: string;
    end_date: string;
    ledger_file_name?: string;
    bank_file_name?: string;
    ledger_data?: CsvTransactionRow[];
    bank_data?: CsvTransactionRow[];
  }): ReconciliationRun {
    const id = `rec_run_${Date.now()}`;
    const run: ReconciliationRun = {
      id,
      name: data.name.trim(),
      start_date: data.start_date,
      end_date: data.end_date,
      status: 'Pending Analysis',
      total_transactions: (data.ledger_data?.length || 0) + (data.bank_data?.length || 0),
      matched_count: 0,
      exception_count: 0,
      discrepancy_amount: 0,
      ledger_file_name: data.ledger_file_name || null,
      bank_file_name: data.bank_file_name || null,
      ledger_data: data.ledger_data || [],
      bank_data: data.bank_data || [],
      created_at: new Date().toISOString(),
    };

    this.runs.set(id, run);
    this.persistAll();
    return run;
  }

  public updateRunStats(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;

    const runItems = Array.from(this.items.values()).filter((i) => i.run_id === runId);
    const matched = runItems.filter((i) => i.match_status === 'Matched').length;
    const exceptions = runItems.filter((i) => i.match_status !== 'Matched').length;
    const totalDiscrepancy = runItems
      .filter((i) => i.match_status !== 'Matched')
      .reduce((sum, i) => sum + (i.difference || 0), 0);

    const updated: ReconciliationRun = {
      ...run,
      status: runItems.length > 0 ? 'Completed' : run.status,
      total_transactions: runItems.length,
      matched_count: matched,
      exception_count: exceptions,
      discrepancy_amount: totalDiscrepancy,
    };

    this.runs.set(runId, updated);
    this.persistAll();
  }

  public deleteRun(runId: string): boolean {
    const deleted = this.runs.delete(runId);
    if (deleted) {
      // Clean up items for this run
      for (const [id, item] of this.items.entries()) {
        if (item.run_id === runId) {
          this.items.delete(id);
        }
      }
      this.persistAll();
    }
    return deleted;
  }

  /* =========================================================================
     RECONCILIATION ITEMS
     ========================================================================= */

  public getAllItems(runId?: string): ReconciliationItem[] {
    let list = Array.from(this.items.values());
    if (runId) {
      list = list.filter((i) => i.run_id === runId);
    }
    return list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  public getItemById(id: string): ReconciliationItem | null {
    const item = this.items.get(id);
    if (item) return item;

    // Search by transaction_id
    return (
      Array.from(this.items.values()).find(
        (i) => i.transaction_id.toLowerCase() === id.toLowerCase()
      ) || null
    );
  }

  public findItemsByFilters(filters: {
    run_id?: string;
    match_status?: string;
    resolution_status?: string;
    status?: string; // 'unreconciled' | 'reconciled' | 'all'
    start_date?: string;
    end_date?: string;
    till_date?: string;
    assignee?: string;
    transaction_id?: string;
    search?: string;
    minimum_difference?: number;
    maximum_difference?: number;
    description?: string;
  }): ReconciliationItem[] {
    const activeRunId = filters.run_id || this.getAllRuns()[0]?.id;
    let list = this.getAllItems(activeRunId);

    // High-level FinOps status: 'unreconciled' vs 'reconciled'
    if (filters.status) {
      const s = filters.status.toLowerCase().trim();
      if (s === 'unreconciled' || s === 'open') {
        list = list.filter((i) => i.resolution_status !== 'Resolved');
      } else if (s === 'reconciled' || s === 'resolved') {
        list = list.filter((i) => i.resolution_status === 'Resolved');
      }
    }

    if (filters.match_status && filters.match_status !== 'all') {
      const m = filters.match_status.toLowerCase();
      list = list.filter((i) => i.match_status.toLowerCase() === m);
    }

    if (filters.resolution_status && filters.resolution_status !== 'all') {
      const r = filters.resolution_status.toLowerCase();
      list = list.filter((i) => i.resolution_status.toLowerCase() === r);
    }

    // Time period & till-date filtering for FinOps operations
    if (filters.start_date) {
      list = list.filter((i) => i.transaction_date >= filters.start_date!);
    }

    if (filters.end_date) {
      list = list.filter((i) => i.transaction_date <= filters.end_date!);
    }

    if (filters.till_date) {
      list = list.filter((i) => i.transaction_date <= filters.till_date!);
    }

    if (filters.assignee && filters.assignee !== 'all') {
      const a = filters.assignee.toLowerCase();
      list = list.filter((i) => i.assignee && i.assignee.toLowerCase().includes(a));
    }

    if (filters.transaction_id) {
      const t = filters.transaction_id.toLowerCase();
      list = list.filter((i) => i.transaction_id.toLowerCase().includes(t));
    }

    if (filters.search) {
      const q = filters.search.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.transaction_id.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q) ||
          (i.assignee && i.assignee.toLowerCase().includes(q)) ||
          (i.reconciliation_reason && i.reconciliation_reason.toLowerCase().includes(q)) ||
          (i.resolution_notes && i.resolution_notes.toLowerCase().includes(q))
      );
    }
    if (filters.description) { const q = filters.description.toLowerCase(); list = list.filter(i => i.description.toLowerCase().includes(q)); }
    if (filters.minimum_difference !== undefined) list = list.filter(i => i.difference >= filters.minimum_difference!);
    if (filters.maximum_difference !== undefined) list = list.filter(i => i.difference <= filters.maximum_difference!);

    return list;
  }

  public getReconciliationSummary(filters?: {
    run_id?: string;
    start_date?: string;
    end_date?: string;
    till_date?: string;
  }) {
    const activeRunId = filters?.run_id || this.resolveRun(filters?.start_date || '0000-01-01', filters?.end_date || filters?.till_date || '9999-12-31')?.id;
    const run = activeRunId ? this.runs.get(activeRunId) : undefined;

    let items = activeRunId ? this.getAllItems(activeRunId) : [];

    if (filters?.start_date) {
      items = items.filter((i) => i.transaction_date >= filters.start_date!);
    }
    if (filters?.end_date) {
      items = items.filter((i) => i.transaction_date <= filters.end_date!);
    }
    if (filters?.till_date) {
      items = items.filter((i) => i.transaction_date <= filters.till_date!);
    }

    const totalTransactions = items.length;
    const reconciledItems = items.filter((i) => i.resolution_status === 'Resolved');
    const unreconciledItems = items.filter((i) => i.resolution_status !== 'Resolved');

    const totalLedgerAmount = items.reduce((sum, i) => sum + (i.ledger_amount || 0), 0);
    const totalBankAmount = items.reduce((sum, i) => sum + (i.bank_amount || 0), 0);
    const reconciledAmount = reconciledItems.reduce((sum, i) => sum + (i.ledger_amount ?? i.bank_amount ?? 0), 0);
    const unreconciledVariance = unreconciledItems.reduce((sum, i) => sum + (i.difference || 0), 0);

    const breakdown = {
      amount_mismatch: {
        count: items.filter((i) => i.match_status === 'Amount Mismatch').length,
        variance: items
          .filter((i) => i.match_status === 'Amount Mismatch')
          .reduce((sum, i) => sum + i.difference, 0),
      },
      missing_in_bank_transit: {
        count: items.filter((i) => i.match_status === 'Missing in Bank').length,
        variance: items
          .filter((i) => i.match_status === 'Missing in Bank')
          .reduce((sum, i) => sum + i.difference, 0),
      },
      missing_in_ledger_charges: {
        count: items.filter((i) => i.match_status === 'Missing in Ledger').length,
        variance: items
          .filter((i) => i.match_status === 'Missing in Ledger')
          .reduce((sum, i) => sum + i.difference, 0),
      },
      potential_duplicates: {
        count: items.filter((i) => i.match_status === 'Potential Duplicate').length,
        variance: items
          .filter((i) => i.match_status === 'Potential Duplicate')
          .reduce((sum, i) => sum + i.difference, 0),
      },
    };

    const ledgerRows = run?.ledger_data || [];
    const bankRows = run?.bank_data || [];
    const dateMatch = (date: string) => (!filters?.start_date || date >= filters.start_date) && (!filters?.end_date || date <= filters.end_date) && (!filters?.till_date || date <= filters.till_date);
    const sourceLedgerCount = ledgerRows.filter(x => dateMatch(x.transaction_date)).length;
    const sourceBankCount = bankRows.filter(x => dateMatch(x.transaction_date)).length;
    return {
      data_status: !run ? 'missing' : !sourceLedgerCount || !sourceBankCount ? 'incomplete' : run.status === 'Completed' ? 'complete' : 'pending',
      reconciliation_status: run?.status || 'Not found',
      total_ledger_transactions: sourceLedgerCount,
      total_bank_transactions: sourceBankCount,
      period: {
        run_name: run?.name || 'Operating Account Reconciliation',
        run_id: activeRunId,
        start_date: filters?.start_date || run?.start_date || '2026-11-01',
        end_date: filters?.till_date || filters?.end_date || run?.end_date || '2026-11-30',
        filtered_till_date: filters?.till_date || null,
      },
      financial_totals: {
        internal_ledger_total: totalLedgerAmount,
        bank_statement_total: totalBankAmount,
        reconciled_total: reconciledAmount,
        unreconciled_variance: unreconciledVariance,
      },
      counts: {
        total_transactions: totalTransactions,
        reconciled_count: reconciledItems.length,
        unreconciled_count: unreconciledItems.length,
        matched_transactions: items.filter(i => i.match_status === 'Matched').length,
        probable_matches: items.filter(i => i.match_status === 'Probable Match').length,
        total_exceptions: items.filter(i => i.match_status !== 'Matched' && i.match_status !== 'Probable Match').length,
      },
      total_discrepancy_amount: items.filter(i => i.match_status !== 'Matched').reduce((sum,i) => sum + Math.abs(i.difference || 0), 0),
      exception_breakdown: breakdown,
      resolution_breakdown: {
        open: items.filter(i => i.resolution_status === 'Open').length,
        in_progress: items.filter(i => i.resolution_status === 'In Progress').length,
        resolved: reconciledItems.length,
        resolution_rate: totalTransactions ? reconciledItems.length / totalTransactions : 0,
      },
    };
  }


  public createReconciliationResults(
    runId: string,
    results: Array<{
      transaction_id: string;
      transaction_date: string;
      description: string;
      ledger_amount?: number | null;
      bank_amount?: number | null;
      match_status: MatchStatus;
      difference?: number;
      reconciliation_reason?: string | null;
      matching_explanation?: string | null;
      confidence_level?: number | null;
      idempotency_key?: string | null;
      ledger_transaction_id?: string | null;
      bank_transaction_id?: string | null;
    }>
  ): ReconciliationItem[] {
    const run = this.runs.get(runId);
    if (!run) {
      throw new Error(`Reconciliation run "${runId}" not found.`);
    }

    const createdList: ReconciliationItem[] = [];
    const now = new Date().toISOString();

    for (const res of results) {
      const idempotencyKey = res.idempotency_key || `${runId}:${res.ledger_transaction_id || res.transaction_id || ''}:${res.bank_transaction_id || ''}:${res.match_status}`;
      const existing = Array.from(this.items.values()).find((item) => item.run_id === runId && item.idempotency_key === idempotencyKey);
      if (existing) { createdList.push(existing); continue; }
      const id = crypto.randomUUID();
      const ledgerAmount = res.ledger_amount !== undefined ? res.ledger_amount : null;
      const bankAmount = res.bank_amount !== undefined ? res.bank_amount : null;

      let difference = 0;
      if (res.difference !== undefined) {
        difference = res.difference;
      } else if (ledgerAmount !== null && bankAmount !== null) {
        difference = Math.abs(ledgerAmount - bankAmount);
      } else if (ledgerAmount !== null) {
        difference = ledgerAmount;
      } else if (bankAmount !== null) {
        difference = bankAmount;
      }

      const resolutionStatus: ResolutionStatus =
        res.match_status === 'Matched' ? 'Resolved' : 'Open';

      const item: ReconciliationItem = {
        id,
        run_id: runId,
        transaction_id: res.transaction_id.trim(),
        ledger_transaction_id: res.ledger_transaction_id || res.transaction_id || null,
        bank_transaction_id: res.bank_transaction_id || null,
        transaction_date: res.transaction_date.trim(),
        description: res.description.trim(),
        ledger_amount: ledgerAmount,
        bank_amount: bankAmount,
        difference,
        match_status: res.match_status,
        resolution_status: resolutionStatus,
        assignee: resolutionStatus === 'Open' ? (res.match_status === 'Amount Mismatch' ? 'Rahul Sharma' : 'Priya Patel') : 'System (Auto)',
        resolution_notes: res.match_status === 'Matched' ? 'Automatically reconciled by MCP engine.' : null,
        reconciliation_reason:
          res.reconciliation_reason !== undefined
            ? res.reconciliation_reason
            : res.match_status === 'Matched'
            ? 'Exact Match'
            : null,
        matching_explanation: res.matching_explanation ?? res.reconciliation_reason ?? null,
        confidence_level: res.confidence_level ?? null,
        idempotency_key: idempotencyKey,
        created_at: now,
        updated_at: now,
      };

      this.items.set(id, item);
      createdList.push(item);
    }


    this.updateRunStats(runId);
    this.persistAll();
    return createdList;
  }

  public updateItem(
    idOrTxnId: string,
    updates: {
      resolution_status?: ResolutionStatus;
      assignee?: string | null;
      resolution_notes?: string | null;
      reconciliation_reason?: string | null;
      investigation_comment?: string | null;
      actor?: string;
      run_id?: string;
    }
  ): ReconciliationItem | null {
    let item = this.items.get(idOrTxnId);
    let targetId = idOrTxnId;

    if (!item) {
      const byTxn = Array.from(this.items.values()).find(
        (i) => i.transaction_id.toLowerCase() === idOrTxnId.toLowerCase() && (!updates.run_id || i.run_id === updates.run_id)
      );
      if (byTxn) {
        item = byTxn;
        targetId = byTxn.id;
      }
    }

    if (!item) return null;

    const updated: ReconciliationItem = {
      ...item,
      resolution_status: updates.resolution_status !== undefined ? updates.resolution_status : item.resolution_status,
      assignee: updates.assignee !== undefined ? updates.assignee : item.assignee,
      resolution_notes: updates.resolution_notes !== undefined ? updates.resolution_notes : item.resolution_notes,
      reconciliation_reason:
        updates.reconciliation_reason !== undefined
          ? updates.reconciliation_reason
          : updates.resolution_status === 'Resolved' && !item.reconciliation_reason
          ? updates.resolution_notes || 'Reconciled and verified by finance team.'
          : item.reconciliation_reason,
      updated_at: new Date().toISOString(),
    };

    for (const field of ['resolution_status', 'assignee', 'resolution_notes', 'reconciliation_reason'] as const) {
      if (updated[field] !== item[field]) this.auditLogs.push({
        id: crypto.randomUUID(), item_id: item.id, action: field,
        previous_value: item[field], new_value: updated[field],
        actor: updates.actor || 'mcp', timestamp: updated.updated_at,
      });
    }
    if (updates.investigation_comment) this.auditLogs.push({ id: crypto.randomUUID(), item_id: item.id,
      action: 'investigation_comment', previous_value: null, new_value: updates.investigation_comment,
      actor: updates.actor || 'mcp', timestamp: updated.updated_at });

    this.items.set(targetId, updated);
    this.persistAll();
    return updated;
  }

  public resolveRun(periodStart: string, periodEnd: string, runId?: string) {
    if (runId) return this.getRunById(runId);
    const candidates = this.getAllRuns().filter(r => r.start_date <= periodEnd && r.end_date >= periodStart);
    const exact = candidates.filter(r => r.start_date === periodStart && r.end_date === periodEnd);
    if (exact.length === 1) return exact[0];
    return candidates.length === 1 ? candidates[0] : null;
  }

  public getAuditLogs(itemId?: string) { return this.auditLogs.filter(log => !itemId || log.item_id === itemId); }

  public bulkUpdateItems(filters: Parameters<DatabaseStore['findItemsByFilters']>[0], updates: Parameters<DatabaseStore['updateItem']>[1]) {
    const matches = this.findItemsByFilters(filters);
    const succeeded: ReconciliationItem[] = [], errors: Array<{id:string; error:string}> = [];
    for (const item of matches) {
      try { const updated = this.updateItem(item.id, updates); if (updated) succeeded.push(updated); else errors.push({id:item.id,error:'Item not found'}); }
      catch (error) { errors.push({id:item.id,error:String(error)}); }
    }
    return { total_matching: matches.length, updated: succeeded.length, failed: errors.length, errors, items: succeeded };
  }

  public fetchNewTransactions(runId?: string): { run: ReconciliationRun; newCount: number } {
    const activeRunId = runId || this.getAllRuns()[0]?.id || 'rec_run_nov2026';
    let run = this.runs.get(activeRunId);

    if (!run) {
      this.seedInitialDemoData();
      run = this.runs.get(activeRunId)!;
    }

    const existingTxnIds = new Set(Array.from(this.items.values()).map((i) => i.transaction_id));
    const now = new Date().toISOString();

    let newLedgerRows: CsvTransactionRow[] = [];
    let newBankRows: CsvTransactionRow[] = [];

    if (!existingTxnIds.has('TXN009')) {
      // First incoming clearing batch: Standard real-world reconciliation cases
      newLedgerRows = [
        {
          transaction_id: 'TXN009',
          transaction_date: '2026-11-12',
          description: 'Atlassian Jira Cloud Enterprise License',
          amount: 34500,
        },
        {
          transaction_id: 'TXN010',
          transaction_date: '2026-11-13',
          description: 'Dell Technologies Workstation Purchase PO-882',
          amount: 145000,
        },
        {
          transaction_id: 'TXN011',
          transaction_date: '2026-11-14',
          description: 'Vendor Wire - Cloudflare Enterprise CDN',
          amount: 68000,
        },
        {
          transaction_id: 'TXN013',
          transaction_date: '2026-11-15',
          description: 'Sales Inward Remittance - Global Customer Wire',
          amount: 92000,
        },
      ];

      newBankRows = [
        {
          transaction_id: 'TXN009',
          transaction_date: '2026-11-12',
          description: 'Debit POS Atlassian Software Sydney',
          amount: 34500, // Exact match
        },
        {
          transaction_id: 'TXN010',
          transaction_date: '2026-11-13',
          description: 'NEFT Payout Dell Technologies India',
          amount: 140000, // Amount mismatch (₹5,000 cash discount variance)
        },
        // TXN011 missing in bank (Timing / In-Transit)
        {
          transaction_id: 'TXN012',
          transaction_date: '2026-11-15',
          description: 'Federal Bank Monthly Cash Management Service Fee',
          amount: 2100, // Missing in Ledger (Direct Bank Fee)
        },
        {
          transaction_id: 'TXN013',
          transaction_date: '2026-11-15',
          description: 'Inward SWIFT Wire Customer Retainer Remittance',
          amount: 92000, // Exact match
        },
      ];
    } else {
      // Incremental batches for repeated testing
      const batchNum = Math.floor(100 + Math.random() * 900);
      const today = new Date().toISOString().split('T')[0];

      const txnA = `TXN${batchNum}A`;
      const txnB = `TXN${batchNum}B`;
      const txnC = `TXN${batchNum}C`;
      const txnD = `TXN${batchNum}D`;

      newLedgerRows = [
        {
          transaction_id: txnA,
          transaction_date: today,
          description: `Stripe Merchant Payout Net Settlement #${batchNum}`,
          amount: 88500,
        },
        {
          transaction_id: txnB,
          transaction_date: today,
          description: `Office Ergonomic Chairs PO-${batchNum}`,
          amount: 36000,
        },
        {
          transaction_id: txnC,
          transaction_date: today,
          description: `Advance Consulting Wire Ref-${batchNum}`,
          amount: 54000,
        },
      ];

      newBankRows = [
        {
          transaction_id: txnA,
          transaction_date: today,
          description: `Direct ACH Deposit Stripe Payments #${batchNum}`,
          amount: 88500, // Exact match
        },
        {
          transaction_id: txnB,
          transaction_date: today,
          description: `Debit POS Furniture Supply PO-${batchNum}`,
          amount: 34200, // Variance: ₹1,800
        },
        // txnC missing in bank (In-Transit)
        {
          transaction_id: txnD,
          transaction_date: today,
          description: `ICICI Bank Quarterly Account Maintenance Fee`,
          amount: 1750, // Missing in ledger
        },
      ];
    }

    // Run through fuzzy matching reconciliation engine
    const fuzzyResults = runFuzzyReconciliation(newLedgerRows, newBankRows);

    let newCount = 0;
    for (let i = 0; i < fuzzyResults.length; i++) {
      const res = fuzzyResults[i];
      const id = crypto.randomUUID();
      const itemTimestamp = new Date(Date.now() + i * 25).toISOString();
      this.items.set(id, {
        id,
        run_id: activeRunId,
        transaction_id: res.transaction_id,
        transaction_date: res.transaction_date,
        description: res.description,
        ledger_amount: res.ledger_amount,
        bank_amount: res.bank_amount,
        difference: res.difference,
        match_status: res.match_status,
        resolution_status: res.resolution_status,
        assignee: res.assignee,
        resolution_notes: res.resolution_notes,
        reconciliation_reason: res.reconciliation_reason,
        created_at: itemTimestamp,
        updated_at: itemTimestamp,
      });
      newCount++;
    }

    // Append to run's historical datasets
    run.ledger_data = [...(run.ledger_data || []), ...newLedgerRows];
    run.bank_data = [...(run.bank_data || []), ...newBankRows];
    this.runs.set(activeRunId, run);

    this.updateRunStats(activeRunId);
    this.persistAll();
    return { run: this.runs.get(activeRunId)!, newCount };
  }


  /* =========================================================================
     GLOBAL DASHBOARD STATS
     ========================================================================= */

  public getDashboardStats() {
    const runs = this.getAllRuns();
    const items = this.getAllItems();

    const totalRuns = runs.length;
    const totalTransactionsReconciled = items.filter((i) => i.match_status === 'Matched').length;
    const totalOpenExceptions = items.filter(
      (i) => i.match_status !== 'Matched' && i.resolution_status !== 'Resolved'
    ).length;

    // Total unresolved discrepancy amount
    const totalDiscrepancyAmount = items
      .filter((i) => i.match_status !== 'Matched' && i.resolution_status !== 'Resolved')
      .reduce((sum, i) => sum + (i.difference || 0), 0);

    return {
      totalRuns,
      totalTransactionsReconciled,
      totalOpenExceptions,
      totalDiscrepancyAmount,
      totalExceptions: items.filter((i) => i.match_status !== 'Matched').length,
      recentRuns: runs.slice(0, 5),
    };
  }
}

export const db = new DatabaseStore();
