import React from 'react';
import { RefreshCw, RotateCcw } from 'lucide-react';

interface HeaderProps {
  currentTab: 'reconciliation' | 'mcp';
  onSelectTab: (tab: 'reconciliation' | 'mcp') => void;
  unreconciledCount?: number;
  onFetchTransactions: () => void;
  isFetching: boolean;
  onResetData: () => void;
  isResetting: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onSelectTab,
  unreconciledCount = 0,
  onFetchTransactions,
  isFetching,
  onResetData,
  isResetting,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          {/* Brand & Clean Navigation */}
          <div className="flex items-center gap-8">
            <button
              onClick={() => onSelectTab('reconciliation')}
              className="text-sm font-semibold tracking-tight text-slate-900 hover:text-slate-700 transition-colors"
            >
              ReconcileFlow
            </button>

            <nav className="flex items-center gap-6 text-xs font-medium">
              <button
                onClick={() => onSelectTab('reconciliation')}
                className={`py-4 transition-colors border-b-2 -mb-px flex items-center gap-1.5 ${
                  currentTab === 'reconciliation'
                    ? 'border-slate-900 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <span>Reconciliation</span>
                {unreconciledCount > 0 && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-rose-100 text-rose-800 font-medium">
                    {unreconciledCount}
                  </span>
                )}
              </button>
              <button
                onClick={() => onSelectTab('mcp')}
                className={`py-4 transition-colors border-b-2 -mb-px ${
                  currentTab === 'mcp'
                    ? 'border-slate-900 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                MCP Protocol
              </button>
            </nav>
          </div>

          {/* Action Buttons: Fetch New Transactions & Reset */}
          <div className="flex items-center gap-2">
            <button
              onClick={onResetData}
              disabled={isResetting}
              title="Reset sample data"
              className="p-1.5 text-xs text-slate-500 hover:text-slate-800 rounded transition-colors"
            >
              <RotateCcw className={`w-3.5 h-3.5 ${isResetting ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={onFetchTransactions}
              disabled={isFetching}
              className="px-3 py-1.5 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
              <span>{isFetching ? 'Fetching Feeds...' : 'Fetch New Transactions'}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
