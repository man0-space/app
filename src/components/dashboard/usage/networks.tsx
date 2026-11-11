import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Globe } from 'lucide-react';
import type { FacilitatorChain, NetworkId } from '@compose-market/sdk/chains';
import { networkLogoForChain } from '../../../lib/analytics';
import { Tooltip } from '../../tooltip';

export function toggleNetworkSelection(
  selected: readonly string[],
  network: string,
  checked: boolean,
): string[] {
  const next = new Set(selected);
  if (checked) next.add(network);
  else next.delete(network);
  return [...next].sort();
}

type SupportedChain = FacilitatorChain & { network: NetworkId };

function NetworkGlyph({ network }: { network: string }) {
  return <img src={networkLogoForChain(network)} alt="" className="cm-network-filter__logo" />;
}

export function NetworkFilter({
  chains,
  selected,
  onChange,
}: {
  chains: SupportedChain[];
  selected: NetworkId[];
  onChange: (next: NetworkId[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  const all = selected.length === 0;
  const single =
    selected.length === 1
      ? chains.find((chain) => chain.network === selected[0]) ?? null
      : null;

  const label = all
    ? 'All'
    : single
      ? single.shortName ?? single.name
      : `${selected.length} networks`;

  const fullLabel = all
    ? 'All networks'
    : single
      ? single.name
      : selected
        .map((network) => chains.find((chain) => chain.network === network)?.name ?? network)
        .join(', ');

  return (
    <div
      ref={wrapRef}
      className="cm-dropdown-wrap"
      data-open={open ? 'true' : 'false'}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip title="Networks" description={fullLabel}>
        <button
          type="button"
          className="cm-control-switcher cm-network-filter"
          data-open={open ? 'true' : 'false'}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Networks: ${fullLabel}`}
          onClick={() => setOpen((prev) => !prev)}
        >
          {all ? (
            <Globe className="cm-control-switcher__icon" />
          ) : single ? (
            <NetworkGlyph network={single.network} />
          ) : (
            <span className="cm-network-filter__stack" aria-hidden="true">
              {selected.slice(0, 3).map((network) => (
                <NetworkGlyph key={network} network={network} />
              ))}
            </span>
          )}
          <span className="cm-control-switcher__label">{label}</span>
          <ChevronDown className="cm-control-switcher__chevron" />
        </button>
      </Tooltip>

      {open && (
        <div
          className="cm-dropdown-menu"
          data-align="end"
          role="listbox"
          aria-multiselectable="true"
          aria-label="Filter by settlement network"
        >
          <button
            type="button"
            role="option"
            aria-selected={all}
            className="cm-dropdown-item"
            data-active={all ? 'true' : 'false'}
            onClick={() => {
              onChange([]);
              setOpen(false);
            }}
          >
            <Globe className="cm-sort-dropdown__icon" />
            <span>All networks</span>
            {all && <Check className="cm-dropdown-item__check" />}
          </button>

          {chains.map((chain) => {
            const isChecked = selected.includes(chain.network);
            return (
              <button
                key={chain.network}
                type="button"
                role="option"
                aria-selected={isChecked}
                className="cm-dropdown-item"
                data-active={isChecked ? 'true' : 'false'}
                onClick={() => {
                  const next = toggleNetworkSelection(
                    selected,
                    chain.network,
                    !isChecked,
                  ) as NetworkId[];
                  onChange(next);
                }}
              >
                <NetworkGlyph network={chain.network} />
                <span>{chain.name}</span>
                {isChecked && <Check className="cm-dropdown-item__check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
