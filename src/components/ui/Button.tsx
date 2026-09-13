import Link from "next/link";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const BASE =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-signal text-on-signal hover:bg-signal-hover active:bg-signal-active",
  secondary: "bg-surface text-foreground border border-border hover:bg-surface-raised",
  danger: "bg-alert text-on-alert hover:bg-alert-hover",
  ghost: "text-foreground hover:bg-surface-raised",
};

interface CommonProps {
  variant?: ButtonVariant;
  className?: string;
}

type ButtonAsButton = CommonProps &
  ButtonHTMLAttributes<HTMLButtonElement> & {
    href?: undefined;
  };

type ButtonAsLink = CommonProps & {
  href: string;
  children?: React.ReactNode;
  target?: string;
  rel?: string;
};

export default function Button(props: ButtonAsButton | ButtonAsLink) {
  const { variant = "primary", className = "" } = props;
  const classes = `${BASE} ${VARIANT[variant]} ${className}`;

  if ("href" in props && props.href !== undefined) {
    const { href, children, target, rel } = props;
    return (
      <Link href={href} target={target} rel={rel} className={classes}>
        {children}
      </Link>
    );
  }

  const { variant: _v, className: _c, href: _h, ...rest } = props as ButtonAsButton;
  void _v;
  void _c;
  void _h;
  return <button className={classes} {...rest} />;
}
