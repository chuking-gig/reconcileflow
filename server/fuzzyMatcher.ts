import { CsvTransactionRow, MatchStatus, ResolutionStatus } from './db.ts';

export interface FuzzyReconciliationOutput {
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
  confidence_score: number;
}

/**
 * Standardize text for fuzzy comparison by removing noise words, special characters, and banking codes
 */
function normalizeDescription(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(neft|rtgs|imps|pos|ach|wdl|wire|direct debit|debit|credit|pvt|ltd|inc|llc|corp|co|fee|chg)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compute token-level Jaccard similarity between two strings
 */
function tokenSimilarity(a: string, b: string): number {
  const tokensA = new Set(normalizeDescription(a).split(' ').filter(Boolean));
  const tokensB = new Set(normalizeDescription(b).split(' ').filter(Boolean));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++;
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Core Fuzzy Reconciliation Matching Algorithm
 * Simulates a realistic corporate treasury engine matching ledger entries against bank statement clearing feeds
 */
export function runFuzzyReconciliation(
  ledgerRows: CsvTransactionRow[],
  bankRows: CsvTransactionRow[]
): FuzzyReconciliationOutput[] {
  const results: FuzzyReconciliationOutput[] = [];
  const matchedBankIndices = new Set<number>();
  const ledgerIdCounts = new Map<string, number>();

  // Detect duplicates in ledger
  ledgerRows.forEach((r) => {
    ledgerIdCounts.set(r.transaction_id, (ledgerIdCounts.get(r.transaction_id) || 0) + 1);
  });

  // Step 1: Match each Ledger row against Bank rows
  for (let lIdx = 0; lIdx < ledgerRows.length; lIdx++) {
    const lRow = ledgerRows[lIdx];
    const isDuplicateLedger = (ledgerIdCounts.get(lRow.transaction_id) || 0) > 1;

    // Check exact reference ID match first
    let bestBankIdx = -1;
    let bestScore = 0;

    for (let bIdx = 0; bIdx < bankRows.length; bIdx++) {
      if (matchedBankIndices.has(bIdx)) continue;
      const bRow = bankRows[bIdx];

      // Exact ID match
      if (bRow.transaction_id.toLowerCase() === lRow.transaction_id.toLowerCase()) {
        bestBankIdx = bIdx;
        bestScore = 1.0;
        break;
      }

      // Fuzzy description match
      const sim = tokenSimilarity(lRow.description, bRow.description);
      if (sim > 0.5 && sim > bestScore) {
        bestScore = sim;
        bestBankIdx = bIdx;
      }
    }

    if (bestBankIdx !== -1 && bestScore >= 0.5) {
      const bRow = bankRows[bestBankIdx];
      matchedBankIndices.add(bestBankIdx);

      const diff = Math.abs(lRow.amount - bRow.amount);

      if (isDuplicateLedger) {
        // Duplicate posting in company books
        results.push({
          transaction_id: lRow.transaction_id,
          transaction_date: lRow.transaction_date,
          description: `${lRow.description} (Duplicate in Ledger)`,
          ledger_amount: lRow.amount,
          bank_amount: bRow.amount,
          difference: lRow.amount,
          match_status: 'Potential Duplicate',
          resolution_status: 'Open',
          assignee: 'Priya Patel',
          resolution_notes: 'Duplicate journal entry identified in ERP; single clearance at bank.',
          reconciliation_reason: null,
          confidence_score: 95,
        });
      } else if (diff === 0) {
        // Exact 1-to-1 Match
        results.push({
          transaction_id: lRow.transaction_id,
          transaction_date: lRow.transaction_date,
          description: lRow.description,
          ledger_amount: lRow.amount,
          bank_amount: bRow.amount,
          difference: 0,
          match_status: 'Matched',
          resolution_status: 'Resolved',
          assignee: 'System (Auto)',
          resolution_notes: 'Automatic match by fuzzy rules engine.',
          reconciliation_reason: 'Exact Match',
          confidence_score: 100,
        });
      } else {
        // Amount Mismatch / Variance
        results.push({
          transaction_id: lRow.transaction_id,
          transaction_date: lRow.transaction_date,
          description: `${lRow.description} (Variance: ₹${diff.toLocaleString('en-IN')})`,
          ledger_amount: lRow.amount,
          bank_amount: bRow.amount,
          difference: diff,
          match_status: 'Amount Mismatch',
          resolution_status: 'Open',
          assignee: 'Rahul Sharma',
          resolution_notes: `Amount variance of ₹${diff.toLocaleString('en-IN')} between ERP booking and bank clearing.`,
          reconciliation_reason: null,
          confidence_score: Math.round(bestScore * 100),
        });
      }
    } else {
      // In Ledger but not in Bank Statement -> Timing / In-Transit (Outstanding)
      results.push({
        transaction_id: lRow.transaction_id,
        transaction_date: lRow.transaction_date,
        description: lRow.description,
        ledger_amount: lRow.amount,
        bank_amount: null,
        difference: lRow.amount,
        match_status: 'Missing in Bank',
        resolution_status: 'Open',
        assignee: 'Priya Patel',
        resolution_notes: 'Payment posted in ledger; awaiting bank clearance (In-Transit).',
        reconciliation_reason: null,
        confidence_score: 0,
      });
    }
  }

  // Step 2: Any Bank rows that were not matched to any Ledger entry -> Unrecorded Bank Fees or Direct Deposits
  for (let bIdx = 0; bIdx < bankRows.length; bIdx++) {
    if (matchedBankIndices.has(bIdx)) continue;
    const bRow = bankRows[bIdx];

    const isFeeOrCharge = /fee|charge|tax|gst|maintenance|chg|markup/i.test(bRow.description);

    results.push({
      transaction_id: bRow.transaction_id,
      transaction_date: bRow.transaction_date,
      description: bRow.description,
      ledger_amount: null,
      bank_amount: bRow.amount,
      difference: bRow.amount,
      match_status: 'Missing in Ledger',
      resolution_status: 'Open',
      assignee: 'Rahul Sharma',
      resolution_notes: isFeeOrCharge
        ? 'Direct bank debit for service fee; requires adjusting journal entry.'
        : 'Direct credit in bank feed without matching ledger invoice.',
      reconciliation_reason: null,
      confidence_score: 0,
    });
  }

  return results;
}
