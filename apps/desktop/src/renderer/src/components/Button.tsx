import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'safe' | 'secondary' | 'move';
export type ButtonSize = 'sm' | 'md' | 'icon' | 'icon-md';

const VARIANTS: Record<ButtonVariant, string> = {
  // Ink, not accent: the accent blue is kept for selection and focus.
  primary: 'bg-ink font-semibold tracking-[0.005em] text-on-ink shadow-primary hover:bg-ink-2 disabled:hover:bg-ink',
  // Approve only: green like the "Approved" state it produces.
  safe: 'bg-safe font-semibold text-on-ink shadow-safe hover:bg-safe-hover disabled:hover:bg-safe',
  secondary: 'bg-surface text-ink-2 shadow-control inset-ring inset-ring-edge-control hover:bg-subtle',
  // Secondary on the warm "Your move" footer: a honey edge instead of the grey one.
  move: 'bg-surface text-ink-2 shadow-control inset-ring inset-ring-edge-honey hover:bg-move-hover',
};

// Solid buttons get a pixel more side padding than outlined ones, as in the mockup.
const SIZES: Record<ButtonSize, { solid: string; outlined: string }> = {
  sm: { solid: 'h-7 px-[11px] text-xs', outlined: 'h-7 px-2.5 text-xs' },
  md: { solid: 'h-[30px] px-3 text-[12.5px]', outlined: 'h-[30px] px-3 text-[12.5px]' },
  icon: { solid: 'size-7 justify-center', outlined: 'size-7 justify-center' },
  'icon-md': { solid: 'size-[30px] justify-center', outlined: 'size-[30px] justify-center' },
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** The button look as classes, also for links that should look like a button. */
export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'sm'): string {
  const solid = variant === 'primary' || variant === 'safe';
  const sizing = solid ? SIZES[size].solid : SIZES[size].outlined;
  return `flex shrink-0 items-center gap-1.5 rounded-control whitespace-nowrap disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${VARIANTS[variant]} ${sizing}`;
}

/** The button looks from the mockup. Disabled buttons keep their title so the reason shows on hover. */
export function Button({ variant = 'secondary', size = 'sm', className = '', type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`${buttonClasses(variant, size)} ${className}`} {...rest} />;
}
