import type { ReactNode, SVGProps } from "react";

function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {children}
    </svg>
  );
}

export function CrownIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <path d="M3.5 8.2 7.8 12l4.2-6.5 4.2 6.5 4.3-3.8-1.7 9.3H5.2Z" />
      <rect x="5" y="18.6" width="14" height="2.4" rx="1.2" />
    </Icon>
  );
}

export function FlameIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props} fill="currentColor" stroke="none">
      <path d="M12.6 2.5c.4 3-1.3 4.6-2.8 6.2C8.4 10.2 7 11.8 7 14.4A5 5 0 0 0 12 19.5a5 5 0 0 0 5-5.2c0-2-1-3.3-1.9-4.4-.3 1.4-1 2.3-2 2.7.7-3.3-.1-7.4-.5-10.1Z" />
    </Icon>
  );
}

export function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M9 5.5v13M15 5.5v13" />
    </Icon>
  );
}

export function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props} fill="currentColor">
      <path d="M8 5.5v13l10-6.5Z" />
    </Icon>
  );
}

export function RestartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <Icon {...props}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5" />
      <path d="M4.5 4.5v4h4" />
    </Icon>
  );
}

export function SoundIcon({ muted, ...props }: SVGProps<SVGSVGElement> & { muted: boolean }) {
  return (
    <Icon {...props}>
      <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" fill="currentColor" />
      {muted ? (
        <path d="m16 9.5 5 5m0-5-5 5" />
      ) : (
        <path d="M15.5 9a4 4 0 0 1 0 6M18.2 6.5a7.5 7.5 0 0 1 0 11" />
      )}
    </Icon>
  );
}
