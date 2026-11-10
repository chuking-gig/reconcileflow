import React, { useState, useEffect, useCallback } from 'react';
import {
  api,
  DashboardStats,
  ReconciliationRun,
  ReconciliationItem,
  ResolutionStatus,
} from './api.ts';
import { Header } from './components/Header.tsx';
import { ReconciliationResultsView } from './components/ReconciliationResultsView.tsx';
import { ExceptionDetailsDrawer } from './components/ExceptionDetailsDrawer.tsx';
import { McpIntegrationView } from './components/McpIntegrationView.tsx';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'reconciliation' | 'mcp'>('reconciliation');

  // Data State
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [runs, setRuns] = useState<ReconciliationRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<ReconciliationRun | null>(null);
  const [items, setItems] = useState<ReconciliationItem[]>([]);
  const [selectedItem, setSelectedItem] = useState<ReconciliationItem | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 2500);
  };

  const loadData = useCallback(async (targetRunId?: string) => {
    try {
      const [fetchedStats, fetchedRuns] = await Promise.all([
        api.getDashboardStats(),
        api.getReconciliations(),
      ]);
      setStats(fetchedStats);
      setRuns(fetchedRuns);

      const activeRunId = targetRunId || selectedRunId || (fetchedRuns.length > 0 ? fetchedRuns[0].id : null);
      if (activeRunId) {
        setSelectedRunId(activeRunId);
        const [runDetail, runItems] = await Promise.all([
          api.getReconciliation(activeRunId).catch(() => null),
          api.getReconciliationItems(activeRunId).catch(() => []),
        ]);
        if (runDetail) setSelectedRun(runDetail);
        setItems(runItems);

        setSelectedItem((current) => {
          if (!current) return current;
          return runItems.find((i: ReconciliationItem) => i.id === current.id) || current;
        });
      }
    } catch (err) {
      console.error('Error loading data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [selectedRunId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleFetchTransactions = async () => {
    setIsFetching(true);
    try {
      const res = await api.fetchNewTransactions(selectedRunId || undefined);
      if (res.run) {
        setSelectedRun(res.run);
        setSelectedRunId(res.run.id);
      }
      await loadData(res.run?.id);
      showToast(res.message || `Fetched ${res.newCount} new transaction feeds.`);
    } catch (err: any) {
      showToast(err?.message || 'Failed to fetch transactions');
    } finally {
      setIsFetching(false);
    }
  };


  const handleSaveItemResolution = async (
    id: string,
    updates: {
      resolution_status?: ResolutionStatus;
      assignee?: string | null;
      resolution_notes?: string | null;
      reconciliation_reason?: string | null;
    }
  ) => {
    const updated = await api.updateItem(id, updates);
    setSelectedItem(updated);
    await loadData();
    showToast(
      updated.resolution_status === 'Resolved'
        ? `${updated.transaction_id} marked as Reconciled.`
        : `Updated ${updated.transaction_id}`
    );
  };

  const handleResetData = async () => {
    setIsResetting(true);
    try {
      await api.resetData();
      setSelectedRunId(null);
      await loadData();
      showToast('Reset back to clean sample feeds');
    } catch {
      showToast('Failed to reset');
    } finally {
      setIsResetting(false);
    }
  };

  const unreconciledCount = items.filter((i) => i.resolution_status !== 'Resolved').length;

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 flex flex-col font-sans">
      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 bg-slate-900 text-white px-3 py-2 rounded shadow text-xs font-medium transition-all">
          {toastMessage}
        </div>
      )}

      {/* Minimal Header with Fetch Transactions Button */}
      <Header
        currentTab={currentTab}
        onSelectTab={(tab) => setCurrentTab(tab)}
        unreconciledCount={unreconciledCount}
        onFetchTransactions={handleFetchTransactions}
        isFetching={isFetching}
        onResetData={handleResetData}
        isResetting={isResetting}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6">
        {currentTab === 'reconciliation' ? (
          <ReconciliationResultsView
            runs={runs}
            selectedRun={selectedRun}
            items={items}
            onSelectItem={(item) => setSelectedItem(item)}
            onFetchTransactions={handleFetchTransactions}
            isFetching={isFetching}
            isLoading={isLoading}
          />
        ) : (
          <McpIntegrationView
            onRefreshDashboard={loadData}
            onSelectTab={() => setCurrentTab('reconciliation')}
          />
        )}
      </main>

      {/* Side-by-Side Exception Investigation & Reconciliation Drawer */}
      <ExceptionDetailsDrawer
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
        onSave={handleSaveItemResolution}
      />
    </div>
  );
}
