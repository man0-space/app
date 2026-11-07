import { Check, ExternalLink, KeyRound, Link2, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectorDecisionItem, MissingConnectorRequirement } from '../lib/api';
import {
  connectComposioAccountPopup,
  connectGatedMcpCredentials,
  ensureAuthenticatedComposeSdk,
  fetchMcpCredentialSpecs,
  readConnectorStatus,
} from '../lib/compose';
import { Modal } from './modal';

export interface CredentialsProps {
  open: boolean;
  missing: MissingConnectorRequirement[];
  userAddress?: string | null;
  onClose: () => void;
  onConnected: (decisions?: ConnectorDecisionItem[]) => void;
}

type VarSpec = { varName: string; description?: string; obtainUrl?: string };

export function Credentials({
  open,
  missing,
  userAddress,
  onClose,
  onConnected,
}: CredentialsProps) {
  const [expandedGated, setExpandedGated] = useState<Record<string, boolean>>({});
  const [varInputs, setVarInputs] = useState<Record<string, Record<string, string>>>({});
  const [resolvedSpecs, setResolvedSpecs] = useState<Record<string, VarSpec[]>>({});
  const [connectedIds, setConnectedIds] = useState<Record<string, boolean>>({});
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoSubmittedRef = useRef(false);

  const buildDecisions = useCallback((): ConnectorDecisionItem[] => {
    return missing
      .filter((item): item is MissingConnectorRequirement & { runId: string; requestId: string } =>
        Boolean(item.runId && item.requestId),
      )
      .map(item => ({
        runId: item.runId,
        requestId: item.requestId,
        decision: 'connected' as const,
      }));
  }, [missing]);

  useEffect(() => {
    if (!open || missing.length === 0) {
      autoSubmittedRef.current = false;
      return;
    }

    setExpandedGated({});
    setVarInputs({});
    setConnectedIds({});
    setBusyId(null);
    setError(null);
    autoSubmittedRef.current = false;

    const subjectAddress = missing[0]?.userAddress?.trim() || userAddress?.trim() || '';
    if (!subjectAddress) return;

    let cancelled = false;
    setCheckingExisting(true);

    void (async () => {
      try {
        const status = await readConnectorStatus(subjectAddress).catch(() => null);
        if (cancelled) return;

        const nextConnected: Record<string, boolean> = {};
        const nextSpecs: Record<string, VarSpec[]> = {};
        const sdk = status ? await ensureAuthenticatedComposeSdk(subjectAddress) : null;

        for (const item of missing) {
          const slugLower = item.slug.toLowerCase();
          if (item.type === 'account') {
            const matchedAcc = status?.accounts?.find(
              acc => acc.slug.toLowerCase() === slugLower && acc.connected,
            );
            if (matchedAcc) {
              if (!matchedAcc.granted && sdk) {
                await sdk.connectors.accounts
                  .grant({ userAddress: subjectAddress, toolkit: matchedAcc.slug })
                  .catch(() => undefined);
              }
              nextConnected[item.entryId] = true;
            }
          } else {
            const matchedConn = status?.connectors?.find(
              conn => conn.slug.toLowerCase() === slugLower,
            );
            if (matchedConn?.connected) {
              if (!matchedConn.allowed && sdk) {
                await sdk.connectors.gated
                  .grant({ userAddress: subjectAddress, slug: matchedConn.slug })
                  .catch(() => undefined);
              }
              nextConnected[item.entryId] = true;
            } else {
              if (item.missingVars && item.missingVars.length > 0) {
                nextSpecs[item.entryId] = item.missingVars;
              } else if (matchedConn?.missingVars && matchedConn.missingVars.length > 0) {
                nextSpecs[item.entryId] = matchedConn.missingVars;
              } else {
                const fetchedSpecs = await fetchMcpCredentialSpecs(
                  subjectAddress,
                  item.slug,
                ).catch(() => []);
                if (fetchedSpecs.length > 0) {
                  nextSpecs[item.entryId] = fetchedSpecs;
                }
              }
            }
          }
        }

        if (cancelled) return;
        setResolvedSpecs(nextSpecs);
        setConnectedIds(nextConnected);

        if (
          !autoSubmittedRef.current &&
          missing.every(item => Boolean(nextConnected[item.entryId]))
        ) {
          autoSubmittedRef.current = true;
          onConnected(buildDecisions());
        }
      } finally {
        if (!cancelled) setCheckingExisting(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, missing, userAddress, buildDecisions, onConnected]);

  const checkAllConnected = (nextMap: Record<string, boolean>) => {
    if (
      !autoSubmittedRef.current &&
      missing.length > 0 &&
      missing.every(item => nextMap[item.entryId])
    ) {
      autoSubmittedRef.current = true;
      onConnected(buildDecisions());
    }
  };

  const getSpecsForItem = (item: MissingConnectorRequirement): VarSpec[] => {
    if (item.missingVars && item.missingVars.length > 0) return item.missingVars;
    const loaded = resolvedSpecs[item.entryId];
    if (loaded && loaded.length > 0) return loaded;
    return [
      {
        varName: `${item.slug.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_API_KEY`,
        description: `Credential for ${item.name}`,
      },
    ];
  };

  const handleConnectAccount = async (item: MissingConnectorRequirement) => {
    const subjectAddress = item.userAddress?.trim() || userAddress?.trim() || '';
    if (!subjectAddress) {
      setError('Sign in first to connect accounts.');
      return;
    }
    setBusyId(item.entryId);
    setError(null);
    try {
      await connectComposioAccountPopup(subjectAddress, item.slug);
      const next = { ...connectedIds, [item.entryId]: true };
      setConnectedIds(next);
      checkAllConnected(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to connect ${item.name}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleSaveCredentials = async (item: MissingConnectorRequirement) => {
    const subjectAddress = item.userAddress?.trim() || userAddress?.trim() || '';
    if (!subjectAddress) {
      setError('Sign in first to save connector credentials.');
      return;
    }
    const specs = getSpecsForItem(item);
    const currentVars = varInputs[item.entryId] ?? {};
    const cleanedVars: Record<string, string> = {};
    for (const spec of specs) {
      const val = (currentVars[spec.varName] ?? '').trim();
      if (!val) {
        setError(`Enter a value for ${spec.varName}.`);
        return;
      }
      cleanedVars[spec.varName] = val;
    }

    setBusyId(item.entryId);
    setError(null);
    try {
      await connectGatedMcpCredentials(subjectAddress, item.slug, cleanedVars);
      const next = { ...connectedIds, [item.entryId]: true };
      setConnectedIds(next);
      checkAllConnected(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Unable to save credentials for ${item.name}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!busyId) onClose();
      }}
      title="Connect Required Accounts & Connectors"
      size="md"
    >
      <div className="modal-form">
        <p className="credentials-intro">
          {checkingExisting
            ? 'Checking existing connections on Compose Market...'
            : 'Connect once — your authorized accounts are saved automatically on Compose Market.'}
        </p>

        <div className="credentials-list">
          {missing.map(item => {
            const isConnected = Boolean(connectedIds[item.entryId]);
            const isBusy = busyId === item.entryId || checkingExisting;
            const isExpanded = Boolean(expandedGated[item.entryId]);
            const specs = getSpecsForItem(item);

            return (
              <div key={item.entryId} className="credential-card">
                <div className="credential-card-head">
                  <div className="credential-card-title-row">
                    <span className="credential-card-name">{item.name}</span>
                    <span className="status-pill">
                      {item.type === 'account' ? 'ACCOUNT' : 'CREDENTIALS'}
                    </span>
                  </div>
                  <p className="credential-card-reason">{item.reason}</p>
                </div>

                {isConnected ? (
                  <div className="credential-connected-badge">
                    <Check size={13} aria-hidden="true" />
                    <span>Connected</span>
                  </div>
                ) : item.type === 'account' ? (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={Boolean(busyId) || checkingExisting}
                    onClick={() => void handleConnectAccount(item)}
                  >
                    {isBusy ? (
                      <Loader2 size={13} className="spin" />
                    ) : (
                      <Link2 size={13} aria-hidden="true" />
                    )}
                    <span>
                      {checkingExisting ? 'Checking...' : isBusy ? 'Connecting...' : 'Connect'}
                    </span>
                  </button>
                ) : !isExpanded ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={Boolean(busyId) || checkingExisting}
                    onClick={() =>
                      setExpandedGated(prev => ({ ...prev, [item.entryId]: true }))
                    }
                  >
                    <KeyRound size={13} aria-hidden="true" />
                    <span>{checkingExisting ? 'Checking...' : 'Connect'}</span>
                  </button>
                ) : (
                  <div className="credential-vars-box">
                    {specs.map(spec => (
                      <label key={spec.varName} className="field">
                        <span className="field-head-row">
                          <span className="field-label">{spec.varName}</span>
                          {spec.obtainUrl ? (
                            <a
                              href={spec.obtainUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="credential-obtain-link"
                            >
                              <span>Get key</span>
                              <ExternalLink size={11} aria-hidden="true" />
                            </a>
                          ) : null}
                        </span>
                        <input
                          type="password"
                          className="input"
                          autoComplete="off"
                          placeholder={spec.description || `Paste ${spec.varName}...`}
                          value={varInputs[item.entryId]?.[spec.varName] ?? ''}
                          disabled={isBusy}
                          onChange={event =>
                            setVarInputs(prev => ({
                              ...prev,
                              [item.entryId]: {
                                ...(prev[item.entryId] ?? {}),
                                [spec.varName]: event.target.value,
                              },
                            }))
                          }
                        />
                      </label>
                    ))}
                    <div className="credential-vars-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={Boolean(busyId) || checkingExisting}
                        onClick={() => void handleSaveCredentials(item)}
                      >
                        {isBusy ? (
                          <Loader2 size={13} className="spin" />
                        ) : (
                          <Check size={13} aria-hidden="true" />
                        )}
                        <span>{isBusy ? 'Saving...' : 'Save & Connect'}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={Boolean(busyId)}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

export { Credentials as CredentialsModal };
