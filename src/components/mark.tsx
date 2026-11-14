export function Mark({ className = '' }: { className?: string }) {
  return (
    <img
      className={`brand-mark ${className}`.trim()}
      src="/branding/mark.svg"
      alt=""
      aria-hidden="true"
    />
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <img
      className={`brand-wordmark ${className}`.trim()}
      src="/branding/wordmark.svg"
      alt="man0"
    />
  );
}
