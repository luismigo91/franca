import type { ComponentProps } from 'react';

type Variant = 'primary' | 'secondary' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-foreground text-background hover:opacity-85',
  secondary: 'border border-foreground/30 bg-transparent text-foreground hover:bg-foreground/10',
  danger: 'border border-red-700 bg-transparent text-red-700 hover:bg-red-700/10 dark:border-red-400 dark:text-red-400',
};

export type ButtonProps = ComponentProps<'button'> & { variant?: Variant };

/** Botón genérico: `type="button"` por defecto (nada envía un formulario sin pedirlo) y foco visible. */
export function Button({ variant = 'primary', type = 'button', className = '', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-10 items-center justify-center rounded-md px-4 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...rest}
    />
  );
}
