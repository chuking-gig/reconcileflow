import React, { useState, useEffect } from 'react';
import { ReconciliationItem, ResolutionStatus, formatINR } from '../api.ts';
import { X, Check, AlertCircle, RotateCcw } from 'lucide-react';

interface ExceptionDetailsDrawerProps {
  item: ReconciliationItem | null;
  onClose: () => void;
  onSave: (
    id: string,
    updates: {
      resolution_status?: ResolutionStatus;
      assignee?: string | null;
      reconciliation_reason?: string | null;
    }
  ) => Promise<void>;
}

// Short, concise reconciliation reasons
const SHORT_RECONCILIATION_REASONS = [
  'Exact Match',
  'Timing / In-Transit',
  'Bank Fee / Charge',
  'Amount Variance',
  'Duplicate Reversed',
  'Tax Withholding (TDS)',
  'Direct AR Deposit',
  'Manual Verification',
];

// Finance team members for dropdown
const ASSIGNEES = [
  'Rahul Sharma',
  'Priya Patel',
  'Vikram Mehta',
  'Sneha Rao',
  'System (Auto)',
];

export const ExceptionDetailsDrawer: React.FC<ExceptionDetailsDrawerProps> = ({
  item,
  onClose,
  onSave,
}) => {
  if (!item) return null;

  const [assignee, setAssignee] = useState<string>(item.assignee || ASSIGNEES[0]);
  const [reconciliationReason, setReconciliationReason] = useState<string>(
    item.reconciliation_reason || SHORT_RECONCILIATION_REASONS[0]
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Pick existing assignee or default
    const existingAssignee = item.assignee || ASSIGNEES[0];
    setAssignee(existingAssignee);

    // Pick existing short reason or map
    const existingReason = item.reconciliation_reason || SHORT_RECONCILIATION_REASONS[0];
    setReconciliationReason(existingReason);

    setError(null);
    setSaveSuccess(false);
  }, [item]);

  const handleReconcile = async (asResolved: boolean) => {
    setIsSaving(true);
    setError(null);

    try {
      await onSave(item.id, {
        resolution_status: asResolved ? 'Resolved' : 'Open',
        assignee: assignee || null,
        reconciliation_reason: asResolved ? reconciliationReason : null,
      });
      setSaveSuccess(true);
      setTimeout(() => {
        setSaveSuccess(false);
        onClose();
      }, 600);
    } catch (err: any) {
      setError(err?.message || 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const isAlreadyReconciled = item.resolution_status === 'Resolved';

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/20 transition-opacity"
        onClick={onClose}
      />

      {/* Slide-over Drawer Panel */}
      <div className="relative w-full max-w-md bg-white flex flex-col h-full z-10 border-l border-slate-200">
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold text-slate-900 text-sm">
                {item.transaction_id}
              </span>
              <span className="text-xs text-slate-500 font-mono">
                {item.transaction_date}
              </span>
              <span
                className={`text-[10px] font-semibold px-2 py-0.2 rounded ${
                  isAlreadyReconciled
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-rose-100 text-rose-800'
                }`}
              >
                {isAlreadyReconciled ? 'Reconciled' : 'Unreconciled'}
              </span>
            </div>
            <div className="text-xs text-slate-600 truncate max-w-[280px] mt-0.5 font-medium">
              {item.description}
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-700 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
          {saveSuccess && (
            <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 flex items-center gap-2">
              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>Saved successfully.</span>
            </div>
          )}

          {error && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Side-by-side Source Values Comparison */}
          <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Source Comparison
            </div>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <div className="p-2 bg-white border border-slate-200 rounded">
                <div className="text-[10px] text-slate-500 font-medium">1. Internal Ledger</div>
                <div className="mt-1 font-mono font-semibold text-slate-900 text-sm">
                  {formatINR(item.ledger_amount)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">Book Record</div>
              </div>

              <div className="p-2 bg-white border border-slate-200 rounded">
                <div className="text-[10px] text-slate-500 font-medium">2. Bank Statement</div>
                <div className="mt-1 font-mono font-semibold text-slate-900 text-sm">
                  {formatINR(item.bank_amount)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">Cleared Feed</div>
              </div>

              <div className="p-2 bg-white border border-slate-200 rounded">
                <div className="text-[10px] text-slate-500 font-medium">Variance</div>
                <div className={`mt-1 font-mono font-semibold text-sm ${item.difference > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                  {formatINR(item.difference)}
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5">Discrepancy</div>
              </div>
            </div>
          </div>

          {/* Reconcile Form */}
          <div className="space-y-4 pt-1">
            {/* Reason for Reconciliation: DROPDOWN with Short Reasons */}
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Reason for Reconciliation
              </label>
              <select
                value={reconciliationReason}
                onChange={(e) => setReconciliationReason(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-xs focus:outline-none focus:border-slate-900 cursor-pointer font-medium text-slate-800"
              >
                {SHORT_RECONCILIATION_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                Appears in the Reconciled table column.
              </p>
            </div>

            {/* Assignee / Reconciled By: DROPDOWN as requested */}
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Assignee
              </label>
              <select
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded text-xs focus:outline-none focus:border-slate-900 cursor-pointer font-medium text-slate-800"
              >
                {ASSIGNEES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
                {assignee && !ASSIGNEES.includes(assignee) && (
                  <option value={assignee}>{assignee}</option>
                )}
              </select>
            </div>

            {/* Primary Action Button */}
            <div className="pt-2 space-y-2">
              {!isAlreadyReconciled ? (
                <button
                  type="button"
                  onClick={() => handleReconcile(true)}
                  disabled={isSaving}
                  className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded transition-colors text-xs flex items-center justify-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isSaving ? 'Reconciling...' : 'Reconcile Transaction'}</span>
                </button>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => handleReconcile(true)}
                    disabled={isSaving}
                    className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded transition-colors text-xs flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Saving...' : 'Update Reconciled Reason'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleReconcile(false)}
                    disabled={isSaving}
                    className="w-full py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded transition-colors text-xs flex items-center justify-center gap-1.5"
                  >
                    <RotateCcw className="w-3 h-3 text-slate-500" />
                    <span>Move Back to Unreconciled</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
