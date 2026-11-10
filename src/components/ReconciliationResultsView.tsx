import React, { useState, useMemo } from 'react';
import {
  ReconciliationRun,
  ReconciliationItem,
  formatINR,
} from '../api.ts';
import { Search, X, CheckCircle2, Calendar, Filter } from 'lucide-react';

interface ReconciliationResultsViewProps {
  runs: ReconciliationRun[];
  selectedRun: ReconciliationRun | null;
  items: ReconciliationItem[];
  onSelectItem: (item: ReconciliationItem) => void;
  onFetchTransactions: () => void;
  isFetching: boolean;
  isLoading: boolean;
}

type PeriodFilterMode = 'all' | 'till_date' | 'nov_1_5' | 'nov_6_10' | 'custom';

export const ReconciliationResultsView: React.FC<ReconciliationResultsViewProps> = ({
  runs,
  selectedRun,
  items,
  onSelectItem,
  onFetchTransactions,
  isFetching,
  isLoading,
}) => {
  // Only 2 tabs: 'unreconciled' and 'reconciled'
  const [activeTab, setActiveTab] = useState<'unreconciled' | 'reconciled'>('unreconciled');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // FinOps Time Period & Till-Date Filter States
  const [periodMode, setPeriodMode] = useState<PeriodFilterMode>('all');
  const [tillDate, setTillDate] = useState<string>('2026-11-05');
  const [customStartDate, setCustomStartDate] = useState<string>('2026-11-01');
  const [customEndDate, setCustomEndDate] = useState<string>('2026-11-08');

  // Filter items by time period / till-date first
  const periodFilteredItems = useMemo(() => {
    return items.filter((item) => {
      const itemDate = item.transaction_date;
      if (!itemDate) return true;

      if (periodMode === 'till_date') {
        return itemDate <= tillDate;
      }
      if (periodMode === 'nov_1_5') {
        return itemDate >= '2026-11-01' && itemDate <= '2026-11-05';
      }
      if (periodMode === 'nov_6_10') {
        return itemDate >= '2026-11-06' && itemDate <= '2026-11-10';
      }
      if (periodMode === 'custom') {
        const matchesStart = !customStartDate || itemDate >= customStartDate;
        const matchesEnd = !customEndDate || itemDate <= customEndDate;
        return matchesStart && matchesEnd;
      }
      return true; // 'all'
    });
  }, [items, periodMode, tillDate, customStartDate, customEndDate]);

  if (!selectedRun) {
    return (
      <div className="bg-white rounded-lg border border-slate-200 p-8 text-center text-xs">
        <p className="text-slate-500 mb-3">No transactions loaded.</p>
        <button
          onClick={onFetchTransactions}
          disabled={isFetching}
          className="px-3 py-1.5 font-medium text-white bg-slate-900 rounded"
        >
          {isFetching ? 'Fetching...' : 'Fetch Transactions'}
        </button>
      </div>
    );
  }

  // Financial summary calculations on the period-filtered data
  const totalLedgerAmount = periodFilteredItems.reduce((sum, i) => sum + (i.ledger_amount || 0), 0);
  const totalBankAmount = periodFilteredItems.reduce((sum, i) => sum + (i.bank_amount || 0), 0);
  const netVariance = Math.abs(totalLedgerAmount - totalBankAmount);

  // Partition strictly into 2 sets: Unreconciled vs Reconciled
  const unreconciledItems = periodFilteredItems.filter((i) => i.resolution_status !== 'Resolved');
  const reconciledItems = periodFilteredItems.filter((i) => i.resolution_status === 'Resolved');

  const reconciledTotal = reconciledItems.reduce((sum, i) => sum + (i.ledger_amount || i.bank_amount || 0), 0);

  // Filter active list by search query (Counterparty, description, ID, notes)
  const currentList = activeTab === 'unreconciled' ? unreconciledItems : reconciledItems;

  const filteredItems = currentList.filter((i) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      i.transaction_id.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      (i.assignee && i.assignee.toLowerCase().includes(q)) ||
      (i.reconciliation_reason && i.reconciliation_reason.toLowerCase().includes(q)) ||
      (i.resolution_notes && i.resolution_notes.toLowerCase().includes(q))
    );
  });

  const getDiscrepancyReason = (item: ReconciliationItem) => {
    switch (item.match_status) {
      case 'Amount Mismatch':
        return `Amount Shortfall: ${formatINR(item.difference)}`;
      case 'Missing in Bank':
        return 'Pending Bank Clearing (In-Transit)';
      case 'Missing in Ledger':
        return 'Unrecorded Bank Debit (Bank Fee)';
      case 'Potential Duplicate':
        return 'Duplicate Entry in Ledger';
      case 'Matched':
        return 'Pending Verification';
      default:
        return item.match_status;
    }
  };

  return (
    <div className="space-y-4 text-xs">
      {/* Purposeful FinOps Workspace Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-1">
        <div>
          <h1 className="text-base font-semibold tracking-tight text-slate-900">
            Bank Reconciliation
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Reconciling <span className="text-slate-700 font-medium">Internal Ledger (ERP)</span> vouchers against{' '}
            <span className="text-slate-700 font-medium">Bank Statement</span> feeds to track and resolve discrepancies.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-white border border-slate-200 text-slate-600 font-mono text-[11px]">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-600" />
            <span>Operating Account • ICICI Bank</span>
          </div>
        </div>
      </div>

      {/* FinOps Time Period & Till-Date Quick Selector */}
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-slate-600 font-medium">
              <Calendar className="w-3.5 h-3.5 text-slate-500" />
              <span>Accounting Period:</span>
            </div>

            {/* Quick Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setPeriodMode('all')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  periodMode === 'all'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                All Records
              </button>

              <button
                onClick={() => {
                  setPeriodMode('till_date');
                  setActiveTab('unreconciled');
                }}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors flex items-center gap-1 ${
                  periodMode === 'till_date'
                    ? 'bg-blue-600 text-white'
                    : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                }`}
              >
                <span>Unreconciled Till Date</span>
              </button>

              <button
                onClick={() => setPeriodMode('nov_1_5')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  periodMode === 'nov_1_5'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Nov 01 - Nov 05
              </button>

              <button
                onClick={() => setPeriodMode('nov_6_10')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  periodMode === 'nov_6_10'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Nov 06 - Nov 10
              </button>

              <button
                onClick={() => setPeriodMode('custom')}
                className={`px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
                  periodMode === 'custom'
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                Custom Range
              </button>
            </div>
          </div>

          {/* Interactive Date Inputs based on mode */}
          {periodMode === 'till_date' && (
            <div className="flex items-center gap-2 bg-blue-50/60 border border-blue-200 px-2.5 py-1 rounded">
              <span className="text-[11px] text-blue-900 font-medium">Cut-off date:</span>
              <input
                type="date"
                value={tillDate}
                onChange={(e) => setTillDate(e.target.value)}
                className="bg-white border border-blue-300 rounded px-2 py-0.5 text-[11px] font-mono text-slate-800 focus:outline-none focus:border-blue-600"
              />
              <span className="text-[10px] text-blue-600">
                (Showing {periodFilteredItems.length} transactions on or before {tillDate})
              </span>
            </div>
          )}

          {periodMode === 'custom' && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded">
              <span className="text-[11px] text-slate-600">From:</span>
              <input
                type="date"
                value={customStartDate}
                onChange={(e) => setCustomStartDate(e.target.value)}
                className="bg-white border border-slate-300 rounded px-2 py-0.5 text-[11px] font-mono text-slate-800"
              />
              <span className="text-[11px] text-slate-600">To:</span>
              <input
                type="date"
                value={customEndDate}
                onChange={(e) => setCustomEndDate(e.target.value)}
                className="bg-white border border-slate-300 rounded px-2 py-0.5 text-[11px] font-mono text-slate-800"
              />
            </div>
          )}
        </div>
      </div>

      {/* Two-Source Financial Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-medium">Internal Ledger Total</div>
          <div className="mt-1 text-lg font-mono font-semibold text-slate-900 tabular-nums">
            {formatINR(totalLedgerAmount)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Company Book Records</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-medium">Bank Statement Total</div>
          <div className="mt-1 text-lg font-mono font-semibold text-slate-900 tabular-nums">
            {formatINR(totalBankAmount)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">Cleared at Bank</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-medium">Reconciled Transactions</div>
          <div className="mt-1 text-lg font-mono font-semibold text-emerald-600 tabular-nums">
            {formatINR(reconciledTotal)}
          </div>
          <div className="text-[10px] text-emerald-600 mt-0.5">{reconciledItems.length} transactions reconciled</div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-[11px] text-slate-500 font-medium">Unreconciled Variance</div>
          <div className={`mt-1 text-lg font-mono font-semibold tabular-nums ${unreconciledItems.length > 0 ? 'text-rose-600' : 'text-slate-900'}`}>
            {formatINR(netVariance)}
          </div>
          <div className="text-[10px] text-slate-400 mt-0.5">{unreconciledItems.length} items awaiting reconciliation</div>
        </div>
      </div>

      {/* Main Reconciliation Container: ONLY 2 TABS */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
        {/* The 2 Tabs: Unreconciled vs Reconciled */}
        <div className="border-b border-slate-200 p-3 flex flex-col sm:flex-row gap-3 justify-between items-stretch sm:items-center">
          <div className="flex items-center gap-2">
            {/* Tab 1: Unreconciled */}
            <button
              onClick={() => setActiveTab('unreconciled')}
              className={`px-3 py-1.5 rounded text-xs transition-colors font-medium flex items-center gap-2 ${
                activeTab === 'unreconciled'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Unreconciled</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  activeTab === 'unreconciled' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {unreconciledItems.length}
              </span>
            </button>

            {/* Tab 2: Reconciled */}
            <button
              onClick={() => setActiveTab('reconciled')}
              className={`px-3 py-1.5 rounded text-xs transition-colors font-medium flex items-center gap-2 ${
                activeTab === 'reconciled'
                  ? 'bg-slate-900 text-white'
                  : 'bg-slate-100 text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>Reconciled</span>
              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  activeTab === 'reconciled' ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'
                }`}
              >
                {reconciledItems.length}
              </span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative w-full sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${activeTab} transactions...`}
              className="w-full pl-8 pr-6 py-1 text-xs bg-slate-50 border border-slate-200 rounded focus:outline-none focus:border-slate-900"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Table Content */}
        <div className="overflow-x-auto">
          {activeTab === 'unreconciled' ? (
            /* TAB 1: UNRECONCILED TABLE */
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  <th scope="col" className="py-2.5 px-3">Transaction ID</th>
                  <th scope="col" className="py-2.5 px-3">Date</th>
                  <th scope="col" className="py-2.5 px-3">Description</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Internal Ledger</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Bank Statement</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Variance</th>
                  <th scope="col" className="py-2.5 px-3">Discrepancy Issue</th>
                  <th scope="col" className="py-2.5 px-3">Status</th>
                  <th scope="col" className="py-2.5 px-3">Assignee</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      Loading transactions...
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center">
                        <CheckCircle2 className="w-6 h-6 text-emerald-500 mb-1.5" />
                        <span className="font-medium text-slate-700">No unreconciled exceptions</span>
                        <span className="text-[11px] text-slate-400 mt-0.5">
                          All transactions have been verified and reconciled.
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                        {item.transaction_id}
                      </td>

                      <td className="py-2.5 px-3 text-slate-500 font-mono whitespace-nowrap">
                        {item.transaction_date}
                      </td>

                      <td className="py-2.5 px-3 text-slate-800 max-w-xs truncate">
                        {item.description}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatINR(item.ledger_amount)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatINR(item.bank_amount)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {item.difference > 0 ? (
                          <span className="text-rose-600 font-medium">{formatINR(item.difference)}</span>
                        ) : (
                          <span className="text-slate-400">₹0</span>
                        )}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap text-amber-700 font-medium">
                        {getDiscrepancyReason(item)}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="text-[11px] px-1.5 py-0.5 rounded border bg-rose-50 text-rose-700 border-rose-200 font-medium">
                          Unreconciled
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                        {item.assignee || '—'}
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectItem(item);
                          }}
                          className="px-2 py-1 text-slate-900 hover:bg-slate-200 bg-slate-100 rounded text-[11px] font-medium"
                        >
                          Reconcile
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          ) : (
            /* TAB 2: RECONCILED TABLE - FEATURES THE REQUIRED "RECONCILIATION REASON" COLUMN */
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                  <th scope="col" className="py-2.5 px-3">Transaction ID</th>
                  <th scope="col" className="py-2.5 px-3">Date</th>
                  <th scope="col" className="py-2.5 px-3">Description</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Internal Ledger</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Bank Statement</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Difference</th>
                  <th scope="col" className="py-2.5 px-3">Reconciliation Reason</th>
                  <th scope="col" className="py-2.5 px-3">Reconciled By</th>
                  <th scope="col" className="py-2.5 px-3">Status</th>
                  <th scope="col" className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="py-8 text-center text-slate-400">
                      Loading records...
                    </td>
                  </tr>
                ) : filteredItems.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="py-12 text-center text-slate-400">
                      No reconciled transactions yet.
                    </td>
                  </tr>
                ) : (
                  filteredItems.map((item) => (
                    <tr
                      key={item.id}
                      onClick={() => onSelectItem(item)}
                      className="hover:bg-slate-50 transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-3 font-mono font-medium text-slate-900">
                        {item.transaction_id}
                      </td>

                      <td className="py-2.5 px-3 text-slate-500 font-mono whitespace-nowrap">
                        {item.transaction_date}
                      </td>

                      <td className="py-2.5 px-3 text-slate-800 max-w-xs truncate">
                        {item.description}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatINR(item.ledger_amount)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                        {formatINR(item.bank_amount)}
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                        {item.difference > 0 ? (
                          <span className="text-slate-400 line-through">{formatINR(item.difference)}</span>
                        ) : (
                          <span className="text-slate-400">₹0</span>
                        )}
                      </td>

                      {/* Required Dedicated Column: Reason for Reconciliation */}
                      <td className="py-2.5 px-3 text-slate-700 max-w-sm">
                        <div className="font-medium text-slate-900 truncate">
                          {item.reconciliation_reason || item.resolution_notes || 'Reconciled and verified by finance team.'}
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">
                        {item.assignee || 'System (Auto)'}
                      </td>

                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">
                          Reconciled
                        </span>
                      </td>

                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectItem(item);
                          }}
                          className="text-slate-500 hover:text-slate-900 underline text-[11px]"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
