import { useMemo } from 'react';
import { type ColDef, type ICellRendererParams } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { Tooltip } from '../../tooltip';
import {
  BRAND_PALETTE,
  DEFAULT_AG_COL_DEF,
  formatMs,
  formatUsd,
  getTaskRowId,
  normalizeTaskList,
  type NormalizedWorkflowRow,
  type PaletteIndex,
  type TaskMetric,
  type TaskSlice,
} from './utils';

export interface TaskBadgesProps {
  tasks: string[];
  isMobile?: boolean;
  align?: 'left' | 'right';
}

export function TaskBadges({
  tasks,
  isMobile = false,
  align = 'left',
}: TaskBadgesProps) {
  const cleanTasks = useMemo(() => normalizeTaskList(tasks), [tasks]);
  if (cleanTasks.length === 0) return null;

  const firstTask = cleanTasks[0];
  const extraTasks = cleanTasks.slice(1);
  const fullLabel = cleanTasks.join(' • ');

  return (
    <Tooltip
      title={cleanTasks.length > 1 ? `Tasks (${cleanTasks.length})` : 'Task'}
      description={fullLabel}
      position="top"
    >
      <span
        className={`cm-genre-badges${isMobile ? ' is-mobile' : ''}`}
        data-align={align}
      >
        <span className="cm-usage-modality">{firstTask}</span>
        {!isMobile &&
          extraTasks.slice(0, 1).map((t) => (
            <span key={t} className="cm-usage-modality cm-genre-badge-extra">
              {t}
            </span>
          ))}
        {(isMobile ? extraTasks.length > 0 : extraTasks.length > 1) && (
          <span className="cm-usage-modality cm-genre-badge-overflow force-show">
            +{isMobile ? extraTasks.length : extraTasks.length - 1}
          </span>
        )}
      </span>
    </Tooltip>
  );
}

export interface TaskBreakdownProps {
  workflows: NormalizedWorkflowRow[];
  taskMetric: TaskMetric;
  focused: boolean;
  isMobile: boolean;
}

export function TaskBreakdown({
  workflows,
  taskMetric,
  focused,
  isMobile,
}: TaskBreakdownProps) {
  const taskSlices = useMemo<TaskSlice[]>(() => {
    const map = new Map<
      string,
      {
        task: string;
        profitUsd: number;
        runs: number;
        runtimeMs: number;
        successSum: number;
        workflowCount: number;
      }
    >();

    for (const row of workflows) {
      const tasksForRow =
        row.allTasks && row.allTasks.length > 0 ? row.allTasks : [row.primaryTask || 'Automation'];
      for (const tName of tasksForRow) {
        const key = tName || 'Automation';
        const cur = map.get(key) || {
          task: key,
          profitUsd: 0,
          runs: 0,
          runtimeMs: 0,
          successSum: 0,
          workflowCount: 0,
        };
        cur.profitUsd = Number((cur.profitUsd + row.profitUsd).toFixed(6));
        cur.runs += row.runs;
        cur.runtimeMs += row.totalDurationMs;
        cur.successSum += row.successPct;
        cur.workflowCount += 1;
        map.set(key, cur);
      }
    }

    const items = Array.from(map.values()).map((t) => {
      const value =
        taskMetric === 'profit'
          ? t.profitUsd
          : taskMetric === 'runs'
            ? t.runs
            : t.runtimeMs;
      return {
        ...t,
        value,
        avgSuccessPct: t.workflowCount > 0 ? Number((t.successSum / t.workflowCount).toFixed(1)) : 100,
      };
    });

    items.sort((a, b) => b.value - a.value || b.runs - a.runs || b.workflowCount - a.workflowCount);
    const total = items.reduce((acc, i) => acc + i.value, 0);

    return items.map((item, idx) => {
      const paletteIndex = (idx % BRAND_PALETTE.length) as PaletteIndex;
      return {
        ...item,
        paletteIndex,
        color: BRAND_PALETTE[paletteIndex],
        pct: total > 0 ? (item.value / total) * 100 : 100 / Math.max(1, items.length),
      };
    });
  }, [workflows, taskMetric]);

  const segmentsWithOffsets = useMemo(() => {
    let offset = 0;
    return taskSlices.map((slice) => {
      const start = offset;
      offset += slice.pct;
      return { slice, start };
    });
  }, [taskSlices]);

  const taskDetailCols = useMemo<ColDef<TaskSlice>[]>(
    () => [
      {
        headerName: 'Task',
        field: 'task',
        flex: 1,
        cellRenderer: (params: ICellRendererParams<TaskSlice>) => {
          const s = params.data;
          if (!s) return null;
          return (
            <div className="cm-modality-detail__row">
              <Tooltip
                title={s.task}
                description={`${s.workflowCount} ${s.workflowCount === 1 ? 'workflow' : 'workflows'} · ${formatUsd(s.profitUsd)} · ${s.runs.toLocaleString()} runs · ${formatMs(s.runtimeMs)}`}
                position="top"
              >
                <span className="cm-modality-detail__name">
                  <span className="cm-modality-legend__dot" data-palette={s.paletteIndex} />
                  {s.task}
                </span>
              </Tooltip>
              <span className="cm-modality-detail__stats">
                <span data-tone="primary">{formatUsd(s.profitUsd)}</span>
                <span>{s.runs.toLocaleString()} runs</span>
                <span>{formatMs(s.runtimeMs)}</span>
                <span data-tone="emerald">{s.avgSuccessPct.toFixed(1)}%</span>
              </span>
            </div>
          );
        },
      },
    ],
    [],
  );

  if (taskSlices.length === 0) {
    return <div className="cm-block__empty">No task categories in window</div>;
  }

  return (
    <div
      className="cm-modality-stack"
      onClick={(e) => {
        if (focused) e.stopPropagation();
      }}
    >
      <div className="cm-modality-bar" role="img" aria-label="Workflows by task">
        <svg className="cm-modality-bar__svg" width="100%" height="100%">
          {segmentsWithOffsets.map(({ slice, start }) => (
            <g key={slice.task}>
              <title>
                {`${slice.task}: ${formatUsd(slice.profitUsd)} · ${slice.runs.toLocaleString()} runs (${slice.pct.toFixed(1)}%)`}
              </title>
              <rect
                x={`${start.toFixed(3)}%`}
                y="0"
                width={`${Math.max(slice.pct, 0.5).toFixed(3)}%`}
                height="100%"
                fill={slice.color}
                className="cm-modality-bar__rect"
              />
              {slice.pct >= 13 && (
                <text
                  x={`${(start + slice.pct / 2).toFixed(3)}%`}
                  y="52%"
                  dominantBaseline="central"
                  textAnchor="middle"
                  className="cm-modality-bar__svg-label"
                >
                  {`${slice.pct.toFixed(0)}%`}
                </text>
              )}
            </g>
          ))}
        </svg>
      </div>

      <div className="cm-modality-legend">
        {taskSlices.map((s) => (
          <Tooltip
            key={s.task}
            title={s.task}
            description={`${s.workflowCount} ${s.workflowCount === 1 ? 'workflow' : 'workflows'} · ${formatUsd(s.profitUsd)} · ${s.runs.toLocaleString()} runs · ${formatMs(s.runtimeMs)} (${s.pct.toFixed(1)}%)`}
            position="top"
          >
            <div className="cm-modality-legend__item">
              <span className="cm-modality-legend__dot" data-palette={s.paletteIndex} />
              <span>{s.task}</span>
              <span className="cm-modality-legend__metric">
                {taskMetric === 'profit'
                  ? formatUsd(s.profitUsd)
                  : taskMetric === 'runs'
                    ? s.runs.toLocaleString()
                    : formatMs(s.runtimeMs)}
              </span>
              <span className="cm-modality-legend__pct">({s.pct.toFixed(0)}%)</span>
            </div>
          </Tooltip>
        ))}
      </div>

      {focused && (
        <div className="cm-ag-grid-wrap cm-ag-feed">
          <AgGridReact
            rowData={taskSlices}
            columnDefs={taskDetailCols}
            getRowId={getTaskRowId}
            suppressScrollOnNewData
            defaultColDef={DEFAULT_AG_COL_DEF}
            headerHeight={0}
            rowHeight={isMobile ? 36 : 38}
            suppressCellFocus
            animateRows
          />
        </div>
      )}
    </div>
  );
}
