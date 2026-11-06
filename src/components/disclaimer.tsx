import {
  Check,
  Cpu,
  CreditCard,
  LoaderCircle,
  Lock,
  LogOut,
  Share2,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/auth';
import { api, type Policy } from '../lib/api';
import { shortHash } from '../lib/contracts';
import { Modal } from './modal';

const CLAUSE_ICONS = [Cpu, CreditCard, Share2, Lock, ShieldCheck] as const;

export interface DisclaimerProps {
  required?: boolean;
  readOnly?: boolean;
  close: () => void;
  accepted?: () => Promise<void> | void;
}

export function Disclaimer({
  required = false,
  readOnly = false,
  close,
  accepted,
}: DisclaimerProps) {
  const { user, logout } = useAuth();
  const [policy, setPolicy] = useState<(Policy & { hash: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [termsChecked, setTermsChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .policy()
      .then((res) => {
        if (!cancelled) {
          setPolicy(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Unable to load terms.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const canAccept = Boolean(
    policy && termsChecked && privacyChecked && !submitting && !loading,
  );

  async function handleAccept() {
    if (!policy || !canAccept) return;
    setSubmitting(true);
    setError(null);
    try {
      await api.consent({
        policy: policy.hash,
        terms: true,
        privacy: true,
      });
      await accepted?.();
      close();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record acceptance.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (required) {
      await logout().catch(() => {});
    }
    close();
  }

  return (
    <Modal
      title={policy?.title || 'Terms & Privacy'}
      size="md"
      hideClose={required}
      close={close}
    >
      <div className="dialog-body">
        <p className="dialog-description">
          {readOnly
            ? 'Accepted terms and privacy summary for your account.'
            : 'Review and accept before creating, running, or publishing workflows.'}
        </p>

        <div className="scrollable terms" tabIndex={0} role="region" aria-label="Terms clauses">
          {loading ? (
            <div className="empty-note">Loading terms...</div>
          ) : policy ? (
            policy.sections.map((section, index) => {
              const Icon = CLAUSE_ICONS[index % CLAUSE_ICONS.length]!;
              return (
                <div key={section.title} className="spec">
                  <span className="spec-num">{String(index + 1).padStart(2, '0')}</span>
                  <div className="spec-content">
                    <h3 className="spec-term">
                      <Icon size={14} className="spec-icon" aria-hidden="true" />
                      <span>{section.title}</span>
                    </h3>
                    <p className="spec-text">{section.text}</p>
                  </div>
                </div>
              );
            })
          ) : null}
        </div>

        {!readOnly && policy ? (
          <div className="checks">
            <label className="check">
              <input
                type="checkbox"
                checked={termsChecked}
                onChange={(event) => setTermsChecked(event.target.checked)}
              />
              <span>{policy.checks.terms}</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={privacyChecked}
                onChange={(event) => setPrivacyChecked(event.target.checked)}
              />
              <span>{policy.checks.privacy}</span>
            </label>
          </div>
        ) : null}

        {user?.userAddress ? (
          <p className="signing">
            <span>{readOnly ? 'Signed by' : 'Account'}</span>
            <b>{shortHash(user.userAddress, 6, 4)}</b>
          </p>
        ) : null}

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="dialog-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={submitting}
            onClick={() => void handleCancel()}
          >
            {required ? (
              <>
                <LogOut size={13} />
                <span>Sign Out</span>
              </>
            ) : (
              <span>Close</span>
            )}
          </button>

          {!readOnly ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!canAccept}
              onClick={() => void handleAccept()}
            >
              {submitting ? (
                <LoaderCircle size={13} className="spin" />
              ) : (
                <Check size={13} />
              )}
              <span>Accept</span>
            </button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
