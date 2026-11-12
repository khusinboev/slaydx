import { useId } from "react";

/**
 * Payment provider marks for the top-up method rows and the Paynet step. Click: the round mark of
 * click.uz's own `logo.svg` in its brand blue. Paynet: the green sphere of paynet.uz's app icon,
 * drawn as a radial gradient (alone, or with the «paynet» wordmark that follows the text colour).
 */

/** Click's round mark alone (the first path of click.uz's `logo.svg`), for the square method badges. */
export function ClickMark({ className }: { className?: string }) {
  return (
    <svg viewBox="-0.1 0 39.6 40.4" fill="none" aria-hidden="true" className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M39.3739 20.1572C39.3739 27.7941 27.2594 40.0006 19.6797 40.0006C12.1 40.0006 -0.0146637 27.7941 -0.0146637 20.1572C-0.0146637 12.5203 12.1 0.313477 19.6797 0.313477C27.2594 0.313477 39.3739 12.5203 39.3739 20.1572ZM27.5573 20.1572C27.5573 23.212 22.7113 28.0945 19.6797 28.0945C16.6477 28.0945 11.8019 23.212 11.8019 20.1572C11.8019 17.1025 16.6479 12.2197 19.6797 12.2197C22.7113 12.2197 27.5573 17.1025 27.5573 20.1572Z"
        fill="#0065FF"
      />
    </svg>
  );
}

function PaynetSphere({ className }: { className?: string }) {
  const gid = `paynet-sphere-${useId().replace(/:/g, "")}`;
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={className}>
      <defs>
        <radialGradient id={gid} cx="0.38" cy="0.32" r="0.75">
          <stop offset="0" stopColor="#8BF5A6" />
          <stop offset="0.55" stopColor="#3FDA6C" />
          <stop offset="1" stopColor="#1FB94F" />
        </radialGradient>
      </defs>
      <circle cx="20" cy="20" r="20" fill={`url(#${gid})`} />
    </svg>
  );
}

/** Paynet's green sphere alone (no wordmark), for the square method badges. */
export function PaynetMark({ className }: { className?: string }) {
  return <PaynetSphere className={className} />;
}

/** The sphere + the «paynet» wordmark (follows the text colour). */
export function PaynetLogo({ className }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 ${className ?? ""}`} aria-hidden="true">
      <PaynetSphere className="size-[1.15em] shrink-0" />
      <span className="leading-none font-extrabold tracking-[-0.02em]">paynet</span>
    </span>
  );
}
