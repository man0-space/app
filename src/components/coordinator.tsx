import { Loader2, Plus, Sparkles } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../contexts/auth';
import { uploadMediaImage } from '../hooks/use-profile';
import { api, authenticated } from '../lib/api';
import { load, resolveEntryLogoUrl, sortCatalogEntries } from '../lib/catalog';
import { mintCoordinatorOnChain, shortHash } from '../lib/contracts';
import type { Coordinator, Entry } from '../lib/schema';
import { Dropdown, type Option } from './dropdown';
import { AvatarMediaFrame } from './media';
import { Modal } from './modal';
import { Tooltip } from './tooltip';

export interface CoordinatorFieldProps {
  value: Coordinator | null | undefined;
  onChange: (next: Coordinator | null) => void;
  mode?: 'creator' | 'runner';
  compact?: boolean;
  entries?: readonly Entry[];
  disabled?: boolean;
  onNotify?: (msg: string) => void;
}

export function CoordinatorField({
  value,
  onChange,
  mode = 'creator',
  compact = false,
  entries,
  disabled = false,
  onNotify,
}: CoordinatorFieldProps) {
  const { user, openAuthModal } = useAuth();
  const isRunner = mode === 'runner';
  const [checked, setChecked] = useState<boolean>(isRunner || Boolean(value));
  const [saved, setSaved] = useState<Coordinator[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [fallbackModels, setFallbackModels] = useState<Entry[]>([]);
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const [modalOpen, setModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [personality, setPersonality] = useState('');
  const [model, setModel] = useState('');
  const [uploadingImage, setUploadingImage] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintStep, setMintStep] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const isExpanded = isRunner || checked;

  useEffect(() => {
    if (!isRunner) {
      setChecked(Boolean(value));
    }
  }, [isRunner, value]);

  const refreshSaved = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const list = await api.coordinators();
      setSaved(list);
      return list;
    } catch {
      return [];
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => {
    if (!isExpanded) return;
    let cancelled = false;
    void refreshSaved().then((list) => {
      if (cancelled) return;
      if (isRunner && !valueRef.current && list.length > 0) {
        onChangeRef.current(list[0]!);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isExpanded, isRunner, refreshSaved]);

  useEffect(() => {
    if (isRunner && !value && saved.length > 0) {
      onChange(saved[0]!);
    }
  }, [isRunner, value, saved, onChange]);

  useEffect(() => {
    if (entries && entries.some((e) => e.kind === 'model')) return;
    if (!modalOpen) return;
    const controller = new AbortController();
    load('model', controller.signal)
      .then((loaded) => {
        if (!controller.signal.aborted) {
          setFallbackModels(loaded);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [entries, modalOpen]);

  const textModels = useMemo(() => {
    const source = entries && entries.some((e) => e.kind === 'model') ? entries : fallbackModels;
    const filtered = source.filter((e) => e.kind === 'model' && e.groups?.includes('text'));
    return sortCatalogEntries(filtered, 'model');
  }, [entries, fallbackModels]);

  useEffect(() => {
    if (modalOpen && !model && textModels.length > 0) {
      setModel(textModels[0]!.id);
    }
  }, [modalOpen, model, textModels]);

  const mergedCoordinators = useMemo<Coordinator[]>(() => {
    const base = [...saved];
    if (
      value &&
      !base.some(
        (c) =>
          c.id === value.id ||
          c.walletAddress.toLowerCase() === value.walletAddress.toLowerCase(),
      )
    ) {
      base.unshift(value);
    }
    return base;
  }, [saved, value]);

  const selectedOptionValue = useMemo(() => {
    if (!value) return '';
    const match = mergedCoordinators.find(
      (c) =>
        c.id === value.id ||
        c.walletAddress.toLowerCase() === value.walletAddress.toLowerCase(),
    );
    return match ? match.id : value.id;
  }, [mergedCoordinators, value]);

  const coordinatorOptions = useMemo<Option[]>(
    () =>
      mergedCoordinators.map((item) => ({
        value: item.id,
        label: item.name,
        detail: item.model,
        logo: item.image || undefined,
        tooltip:
          item.agentId > 0
            ? `${shortHash(item.walletAddress, 10, 8)} · #${item.agentId}`
            : `${shortHash(item.walletAddress, 10, 8)} · ${item.network}`,
      })),
    [mergedCoordinators],
  );

  const modelOptions = useMemo<Option[]>(
    () =>
      textModels.map((entry) => ({
        value: entry.id,
        label: entry.name,
        detail: entry.family || undefined,
        badge: entry.isFrontier ? 'Frontier' : entry.isLatest ? 'Latest' : undefined,
        logo: resolveEntryLogoUrl(entry),
      })),
    [textModels],
  );

  const handleToggle = async (nextChecked: boolean) => {
    if (!nextChecked) {
      setChecked(false);
      onChange(null);
      return;
    }
    setChecked(true);
    const list = saved.length > 0 ? saved : await refreshSaved();
    if (!value && list.length > 0) {
      onChange(list[0]!);
    }
  };

  const handleOpenCreate = () => {
    if (!user || !authenticated()) {
      openAuthModal();
      return;
    }
    setFormError(null);
    setMintStep(null);
    if (!model && textModels.length > 0) {
      setModel(textModels[0]!.id);
    }
    setModalOpen(true);
  };

  const handleAvatarUpload = async (file: File) => {
    setUploadingImage(true);
    setFormError(null);
    try {
      const uploadedUrl = await uploadMediaImage(file, 'avatar');
      setImage(uploadedUrl);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to upload avatar');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleGenerateAvatar = async () => {
    if (!user || !authenticated()) {
      openAuthModal();
      return;
    }
    setGeneratingImage(true);
    setFormError(null);
    try {
      const generated = await api.generateAvatar({
        title: name.trim() || 'man0 Coordinator Persona',
        description:
          personality.trim() ||
          'Autonomous multi-agent workflow coordinator orchestrating DAG execution.',
      });
      setImage(generated.imageUrl);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to generate avatar');
    } finally {
      setGeneratingImage(false);
    }
  };

  const handleSaveAndMint = async (event: FormEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!user || !authenticated()) {
      openAuthModal();
      return;
    }
    const cleanName = name.trim();
    const cleanPersonality = personality.trim();
    if (!cleanName) {
      setFormError('Enter a Coordinator name.');
      return;
    }
    if (!image) {
      setFormError('Upload or generate a Coordinator image.');
      return;
    }
    if (!cleanPersonality) {
      setFormError('Enter a Coordinator personality.');
      return;
    }
    if (!model) {
      setFormError('Select a text model.');
      return;
    }

    setMinting(true);
    setFormError(null);
    setMintStep('Minting on NEAR...');
    try {
      const created = await mintCoordinatorOnChain({
        name: cleanName,
        image,
        personality: cleanPersonality,
        model,
      });
      setSaved((prev) => [created, ...prev.filter((item) => item.id !== created.id)]);
      setChecked(true);
      onChange(created);
      setModalOpen(false);
      setName('');
      setImage('');
      setPersonality('');
      onNotify?.(`Minted Coordinator "${created.name}" (#${created.agentId})`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to mint Coordinator on NEAR');
    } finally {
      setMintStep(null);
      setMinting(false);
    }
  };

  const selectedModelLabel = useMemo(
    () => modelOptions.find((opt) => opt.value === model)?.label || model || 'Select text model',
    [modelOptions, model],
  );

  return (
    <div className={`coordinator-field ${compact ? 'is-compact' : ''}`.trim()}>
      {isRunner ? (
        compact ? null : <span className="field-label">Coordinator</span>
      ) : (
        <label className="switch-row">
          <span>Coordinator</span>
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => void handleToggle(event.target.checked)}
          />
        </label>
      )}

      {isExpanded ? (
        <div className="coordinator-picker-stack">
          <div className="coordinator-picker-row">
            {compact ? <span className="coordinator-compact-kicker">COORD</span> : null}
            <div className="coordinator-dropdown-slot">
              <Dropdown
                label="Coordinator Persona"
                placeholder={
                  loadingSaved
                    ? 'Loading...'
                    : coordinatorOptions.length > 0
                      ? 'Select Coordinator...'
                      : 'Create a Coordinator (+)'
                }
                value={selectedOptionValue}
                options={coordinatorOptions}
                variant="field"
                disabled={disabled || loadingSaved || coordinatorOptions.length === 0}
                searchable={coordinatorOptions.length > 5}
                searchPlaceholder="Filter Coordinators..."
                onChange={(selectedId) => {
                  const picked = mergedCoordinators.find((c) => c.id === selectedId) ?? null;
                  if (picked) onChange(picked);
                }}
              />
            </div>

            <Tooltip label="Create Coordinator Persona">
              <button
                type="button"
                className={`icon-btn ${compact ? 'btn-xs' : 'btn-sm'} coordinator-add-btn`}
                aria-label="Create Coordinator Persona"
                disabled={disabled}
                onClick={handleOpenCreate}
              >
                <Plus size={compact ? 13 : 14} aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          {value && !compact ? (
            <div className="coordinator-summary-pill">
              {value.image ? (
                <img src={value.image} alt="" className="coordinator-summary-avatar" />
              ) : null}
              <div className="coordinator-summary-meta">
                <span className="coordinator-summary-name">{value.name}</span>
                <span className="coordinator-summary-sub">
                  {value.model} · {shortHash(value.walletAddress, 8, 6)}
                </span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal
        open={modalOpen}
        onClose={() => {
          if (!minting) setModalOpen(false);
        }}
        title="Create your Coordinator Persona"
        size="md"
      >
        <form className="modal-form" onSubmit={(e) => void handleSaveAndMint(e)}>
          <div className="coordinator-persona-preview stealth-glass">
            <AvatarMediaFrame
              src={image || null}
              alt={name.trim() || 'Coordinator Persona'}
              uploading={uploadingImage}
              generating={generatingImage}
              disabled={minting}
              uploadLabel="Upload avatar"
              changeLabel="Change avatar"
              removeLabel="Clear avatar"
              generateLabel="Generate avatar"
              regenerateLabel="Regenerate avatar"
              generateDescription="Uses Name & Personality"
              onUploadFile={handleAvatarUpload}
              onGenerate={() => void handleGenerateAvatar()}
              onRemove={image ? () => setImage('') : undefined}
            />
            <div className="coordinator-preview-main">
              <strong
                className={`coordinator-preview-name ${name.trim() ? '' : 'is-placeholder'
                  }`.trim()}
              >
                {name.trim() || 'Coordinator Persona'}
              </strong>
              <span className="coordinator-preview-model">{selectedModelLabel}</span>
              {personality.trim() ? (
                <p className="coordinator-preview-bio">{personality.trim()}</p>
              ) : null}
            </div>
          </div>

          <label className="field">
            <span className="field-label">Name</span>
            <input
              type="text"
              className="input"
              value={name}
              disabled={minting}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Sentinel Orchestrator"
              required
            />
          </label>

          <label className="field">
            <span className="field-label">Personality</span>
            <textarea
              className="textarea"
              rows={3}
              value={personality}
              disabled={minting}
              onChange={(event) => setPersonality(event.target.value)}
              placeholder="Define how this Coordinator plans, delegates, verifies, and synthesizes workflow steps..."
              required
            />
          </label>

          <div className="field">
            <span className="field-label">Model</span>
            <Dropdown
              label="Coordinator Model"
              placeholder={modelOptions.length ? 'Select text model...' : 'Loading text models...'}
              value={model}
              options={modelOptions}
              onChange={setModel}
              variant="field"
              disabled={minting || modelOptions.length === 0}
              searchable
              searchPlaceholder="Search text models..."
            />
          </div>

          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="modal-footer">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={minting}
              onClick={() => setModalOpen(false)}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={minting || generatingImage || uploadingImage}
            >
              {minting ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              <span>{mintStep || 'Save & Mint'}</span>
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
