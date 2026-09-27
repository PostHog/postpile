import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  // Ink, not accent: the accent blue is kept for selection and focus.
  primary: 'bg-ink font-semibold text-on-ink shadow-primary hover:bg-ink-2 disabled:hover:bg-ink',
  secondary: 'border border-control bg-surface text-ink-2 shadow-control hover:bg-subtle',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-xs',
  md: 'h-[30px] px-3 text-[12.5px]',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** The two button looks from the mockup. Disabled buttons keep their title so the reason shows on hover. */
export function Button({ variant = 'secondary', size = 'sm', className = '', type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`flex shrink-0 items-center gap-1.5 rounded-control whitespace-nowrap disabled:cursor-default disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  );
}
