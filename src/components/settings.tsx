import { ArrowLeft, Trash2, X } from 'lucide-react';
import { useMemo } from 'react';
import { displayGroupLabel } from '../lib/catalog';
import type { Block, Entry, Step } from '../lib/schema';
import { Button } from './button';
import { Dropdown, type DropdownOption } from './dropdown';

interface SettingsProps {
  node: Block;
  entries: Entry[];
  change: (id: string, patch: Partial<Step>) => void;
  remove: (id: string) => void;
  onClose: () => void;
  onBackToOverview?: () => void;
}

export function Settings({
  node,
  entries,
  change,
  remove,
  onClose,
  onBackToOverview,
}: SettingsProps) {
  const { id, data } = node;

  const entryOptions = useMemo<DropdownOption[]>(
    () =>
      entries
        .filter((entry) => entry.kind === data.kind)
        .map((entry) => {
          const primaryGroup = entry.groups?.[0];
          return {
            value: entry.id,
            label: entry.name,
            sublabel: entry.description || entry.id,
            badge: primaryGroup ? displayGroupLabel(entry.kind, primaryGroup) : undefined,
            logo: entry.logo,
          };
        }),
    [entries, data.kind],
  );

  const handleEntryChange = (entryId: string) => {
    const found = entries.find((e) => e.kind === data.kind && e.id === entryId);
    if (!found) return;
    const defaultLabel = data.kind.charAt(0).toUpperCase() + data.kind.slice(1);
    const shouldRename =
      !data.label || data.label === defaultLabel || data.label === data.entry?.name;
    change(id, {
      entry: found,
      label: shouldRename ? found.name : data.label,
    });
  };

  return (
    <aside className="studio-drawer studio-drawer-right stealth-glass" aria-label="Step inspector">
      <div className="drawer-header">
        <div className="drawer-title-inline">
          {onBackToOverview ? (
            <Button
              icon={<ArrowLeft size={13} />}
              tooltip="Workflow overview"
              size="xs"
              onClick={onBackToOverview}
            />
          ) : null}
          <span className="node-type" data-kind={data.kind}>
            {data.kind === 'model'
              ? '● MODEL'
              : data.kind === 'connector'
                ? '■ CONNECTOR'
                : '❖ AGENT'}
          </span>
        </div>
        <div className="drawer-header-actions">
          <Button
            icon={<Trash2 size={14} />}
            tooltip="Delete step"
            variant="danger"
            size="xs"
            onClick={() => remove(id)}
          />
          <Button icon={<X size={14} />} tooltip="Close inspector" size="xs" onClick={onClose} />
        </div>
      </div>

      <div className="drawer-body scroll-area">
        <label className="field">
          <span className="field-label">Step label</span>
          <input
            type="text"
            className="input"
            value={data.label}
            onChange={(event) => change(id, { label: event.target.value })}
            placeholder="Step name"
          />
        </label>

        <div className="field">
          <span className="field-label">
            {data.kind === 'model'
              ? 'Model'
              : data.kind === 'connector'
                ? 'Connector'
                : 'Agent'}
          </span>
          <Dropdown
            variant="field"
            options={entryOptions}
            value={data.entry?.id ?? ''}
            onChange={handleEntryChange}
            searchable
            searchPlaceholder={`Search ${data.kind}s...`}
            placeholder={`Select a ${data.kind}`}
          />
        </div>

        {data.entry ? (
          <div className="stat-box">
            <span className="stat-label">{data.entry.id}</span>
            <span className="text-secondary">{data.entry.description}</span>
          </div>
        ) : null}

        <label className="field">
          <span className="field-label">Instructions / Note</span>
          <textarea
            className="textarea"
            rows={4}
            value={data.note}
            onChange={(event) => change(id, { note: event.target.value })}
            placeholder="Describe how this step processes its input..."
          />
        </label>

        {typeof data.output === 'string' && data.output ? (
          <div className="output-box">
            <span className="field-label">Last output</span>
            <pre className="output-pre">{data.output}</pre>
          </div>
        ) : null}
      </div>
    </aside>
  );
}
