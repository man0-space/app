import { useCallback, useMemo, useState } from 'react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { ArrowUpDown, GitBranch, Search } from 'lucide-react';
import type { Listing } from '../../../lib/schema';
import { Tooltip } from '../../tooltip';
import { AgHeaderTooltip, BlockDropdown } from './dropdown';
import { TaskBadges, TaskBreakdown } from './tasks';
import {
  DEFAULT_AG_COL_DEF,
  TASK_METRIC_OPTIONS,
  WORKFLOWS_SORT_OPTIONS,
  WORKFLOWS_VIEW_OPTIONS,
  formatMs,
  formatUsd,
  getWorkflowRowId,
  successTone,
  type NormalizedWorkflowRow,
  type TaskMetric,
  type WorkflowsSortKey,
  type WorkflowsView,
} from './utils';

export interface WorkflowsBlockProps {
  workflows: NormalizedWorkflowRow[];
  focused: boolean;
  isMobile: boolean;
  onToggleFocus: () => void;
  onSelectWorkflow?: (workflow: Listing) => void;
}

export function WorkflowsBlock({
  workflows,
  focused,
  isMobile,
  onToggleFocus,
  onSelectWorkflow,
}: WorkflowsBlockProps) {
  const [view, setView] = useState<WorkflowsView>('workflows');
  const [sortKey, setSortKey] = useState<WorkflowsSortKey>('profit');
  const [query, setQuery] = useState('');
  const [taskMetric, setTaskMetric] = useState<TaskMetric>('profit');

  const sortedWorkflows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? workflows.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.taskLabel.toLowerCase().includes(q) ||
            r.networkLabel.toLowerCase().includes(q),
        )
      : workflows;

    return [...filtered].sort((a, b) => {
      switch (sortKey) {
        case 'profit':
          return b.profitUsd - a.profitUsd || b.runs - a.runs;
        case 'runs':
          return b.runs - a.runs || b.profitUsd - a.profitUsd;
        case 'runtime':
          return b.totalDurationMs - a.totalDurationMs || b.runs - a.runs;
        case 'success':
          return b.successPct - a.successPct || b.runs - a.runs;
        case 'recent':
          return (b.lastRunAt || 0) - (a.lastRunAt || 0);
        case 'task':
          return a.primaryTask.localeCompare(b.primaryTask) || b.profitUsd - a.profitUsd;
        default:
          return 0;
      }
    });
  }, [workflows, query, sortKey]);

  const handleRowClicked = useCallback(
    (e: { data?: NormalizedWorkflowRow }) => {
      if (focused && e.data?.listing && onSelectWorkflow) {
        onSelectWorkflow(e.data.listing);
      }
    },
    [focused, onSelectWorkflow],
  );

  const columnDefs = useMemo<ColDef<NormalizedWorkflowRow>[]>(() => {
    const cols: ColDef<NormalizedWorkflowRow>[] = [
      {
        headerName: 'WORKFLOW',
        headerComponent: AgHeaderTooltip,
        headerComponentParams: {
          tooltip: 'Workflow title, banner thumbnail, and royalty settings',
          align: 'left',
        },
        field: 'title',
        flex: 1.6,
        minWidth: isMobile ? 115 : 140,
        cellRenderer: (params: ICellRendererParams<NormalizedWorkflowRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <Tooltip
              title={row.title}
              description={`Tasks: ${row.taskLabel} · ${row.stepsCount} steps · +${row.creatorFeePct}% royalty`}
              position="top"
            >
              <div className="cm-usage-song">
                {row.banner ? (
                  <img
                    src={row.banner}
                    alt=""
                    className="cm-usage-song__icon"
                  />
                ) : (
                  <span className="cm-usage-song__icon cm-usage-model__icon--fallback" aria-hidden="true">
                    <GitBranch className="cm-usage-model__icon-glyph" />
                  </span>
                )}
                <div className="cm-usage-song__name">
                  <span className="cm-usage-song__id">{row.title}</span>
                  <span className="cm-usage-song__provider">
                    {row.published ? `+${row.creatorFeePct}% ROYALTY` : 'DRAFT'}
                  </span>
                </div>
              </div>
            </Tooltip>
          );
        },
      },
      {
        headerName: 'PROFIT',
        headerComponent: AgHeaderTooltip,
        headerComponentParams: {
          tooltip: 'Net creator royalties earned from settled runs',
          align: 'right',
        },
        field: 'profitUsd',
        width: isMobile ? 78 : 92,
        headerClass: 'cm-ag-right',
        cellClass: 'cm-ag-right',
        cellRenderer: (params: ICellRendererParams<NormalizedWorkflowRow>) =>
          params.data ? (
            <span className="cm-usage-cost">{formatUsd(params.data.profitUsd)}</span>
          ) : null,
      },
      {
        headerName: 'RUNS',
        headerComponent: AgHeaderTooltip,
        headerComponentParams: {
          tooltip: 'Total executions of this workflow',
          align: 'right',
        },
        field: 'runs',
        width: isMobile ? 58 : 74,
        headerClass: 'cm-ag-right',
        cellClass: 'cm-ag-right',
        valueFormatter: (p) => Number(p.value || 0).toLocaleString(),
      },
    ];

    if (focused && !isMobile) {
      cols.push(
        {
          headerName: 'RUNTIME',
          headerComponent: AgHeaderTooltip,
          headerComponentParams: {
            tooltip: 'Cumulative execution duration across runs',
            align: 'right',
          },
          field: 'totalDurationMs',
          width: 96,
          headerClass: 'cm-ag-right',
          cellClass: 'cm-ag-right',
          valueFormatter: (p) => formatMs(Number(p.value || 0)),
        },
        {
          headerName: 'SUCCESS',
          headerComponent: AgHeaderTooltip,
          headerComponentParams: {
            tooltip: 'Percentage of runs completed without error',
            align: 'right',
          },
          field: 'successPct',
          width: 80,
          headerClass: 'cm-ag-right',
          cellClass: 'cm-ag-right',
          cellRenderer: (params: ICellRendererParams<NormalizedWorkflowRow>) => {
            const row = params.data;
            if (!row || row.runs === 0) return <span>—</span>;
            return (
              <span className="cm-usage-success" data-tone={successTone(row.successPct)}>
                {row.successPct.toFixed(0)}%
              </span>
            );
          },
        },
        {
          headerName: 'TASKS',
          headerComponent: AgHeaderTooltip,
          headerComponentParams: {
            tooltip: 'Workflow task categories (hover badge for full list)',
            align: 'right',
          },
          field: 'taskLabel',
          width: 196,
          headerClass: 'cm-ag-right',
          cellClass: 'cm-ag-right',
          cellRenderer: (params: ICellRendererParams<NormalizedWorkflowRow>) =>
            params.data ? (
              <TaskBadges
                tasks={params.data.allTasks}
                isMobile={isMobile}
                align="right"
              />
            ) : null,
        },
      );
    } else if (focused && isMobile) {
      cols.push({
        headerName: 'OK%',
        headerComponent: AgHeaderTooltip,
        headerComponentParams: {
          tooltip: 'Execution success rate',
          align: 'right',
        },
        field: 'successPct',
        width: 62,
        headerClass: 'cm-ag-right',
        cellClass: 'cm-ag-right',
        cellRenderer: (params: ICellRendererParams<NormalizedWorkflowRow>) => {
          const row = params.data;
          if (!row || row.runs === 0) return <span>—</span>;
          return (
            <span className="cm-usage-success" data-tone={successTone(row.successPct)}>
              {row.successPct.toFixed(0)}%
            </span>
          );
        },
      });
    }

    return cols;
  }, [focused, isMobile]);

  return (
    <section
      className="cm-block"
      data-block="models"
      data-focused={focused ? 'true' : 'false'}
      onClick={onToggleFocus}
    >
      <header className="cm-block__header">
        <BlockDropdown
          value={view}
          options={WORKFLOWS_VIEW_OPTIONS}
          onChange={setView}
          ariaLabel="Workflows breakdown view"
        />

        <div className="cm-block__header-side" onClick={(e) => e.stopPropagation()}>
          {view === 'workflows' ? (
            <>
              {focused && (
                <label className="cm-usage-search" aria-label="Filter workflows">
                  <Search className="cm-usage-search__icon" />
                  <input
                    type="search"
                    className="cm-usage-search__input"
                    placeholder="Filter workflows…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              )}
              <BlockDropdown
                value={sortKey}
                options={WORKFLOWS_SORT_OPTIONS}
                onChange={setSortKey}
                ariaLabel="Sort workflows"
                align="end"
                chevron={false}
                triggerIcon={ArrowUpDown}
              />
            </>
          ) : (
            <BlockDropdown
              value={taskMetric}
              options={TASK_METRIC_OPTIONS}
              onChange={setTaskMetric}
              ariaLabel="Task metric"
              align="end"
            />
          )}
        </div>
      </header>

      <div className="cm-block__body">
        {view === 'workflows' ? (
          sortedWorkflows.length === 0 ? (
            <div className="cm-block__empty">No workflows match filter</div>
          ) : (
            <div
              className="cm-ag-grid-wrap"
              onClick={(e) => {
                if (focused) e.stopPropagation();
              }}
            >
              <AgGridReact
                rowData={sortedWorkflows}
                columnDefs={columnDefs}
                getRowId={getWorkflowRowId}
                suppressScrollOnNewData
                defaultColDef={DEFAULT_AG_COL_DEF}
                headerHeight={isMobile ? 28 : 30}
                rowHeight={isMobile ? 42 : 44}
                suppressCellFocus
                animateRows
                onRowClicked={handleRowClicked}
              />
            </div>
          )
        ) : (
          <TaskBreakdown
            workflows={workflows}
            taskMetric={taskMetric}
            focused={focused}
            isMobile={isMobile}
          />
        )}
      </div>
    </section>
  );
}
