"use client";

import { useActionState, useCallback, useEffect, useRef } from "react";

/** The minimum a server action must return for a caller to tell success from failure. */
export interface ActionFormState {
  error: string | null;
}

export interface ActionFormHandlers<S extends ActionFormState> {
  /** Called once, after the action resolves with no error. */
  onSuccess?: (state: S) => void;
  /** Called once, after the action resolves WITH an error. */
  onError?: (message: string, state: S) => void;
}

export interface ActionForm<S extends ActionFormState> {
  state: S;
  /** Pass to `<form action={...}>`. Never call this from a click handler — see below. */
  formAction: (formData: FormData) => void;
  /** React-managed, and therefore actually true while the action is in flight. */
  pending: boolean;
  /** The last resolved error, ready to render where the user is looking. */
  error: string | null;
  /** Pass to `<form onSubmit={...}>` — drops a second submit that arrives while one is in flight. */
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

/**
 * A token identifying ONE user intent, so the server can collapse repeat
 * submissions of it (see lib/repo.ts claimRequestToken). ConfirmDialog mints a
 * fresh one per opening: two submissions of one confirmation share a token,
 * while a deliberate second confirmation gets its own.
 */
export function newRequestToken(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `rt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * The one way this app dispatches a server action from the client.
 *
 * The dispatcher returned here is for `<form action={formAction}>` and nothing
 * else. Calling a useActionState dispatcher from an onClick handler dispatches
 * it outside any transition: React warns, `isPending` never flips, so the
 * submit control is never disabled and the action can fire twice. A form
 * submission is dispatched BY React, which is what makes `pending` real.
 *
 * On top of that this hook adds the two things call sites kept getting wrong by
 * hand:
 *
 *   - a submit lock, so two clicks in the same tick (before React can re-render
 *     the button as disabled) produce one request, not two;
 *   - resolution detection, so the caller learns the action finished and
 *     whether it failed — which is what lets a dialog stay open on failure
 *     instead of closing over its own error message.
 *
 * `pending` going true→false with a submission outstanding is the only
 * observable "the action resolved" signal useActionState offers; that edge is
 * what the second effect below watches.
 */
export function useActionForm<S extends ActionFormState>(
  action: (prevState: S, formData: FormData) => Promise<S>,
  initialState: S,
  handlers: ActionFormHandlers<S> = {},
): ActionForm<S> {
  // The cast is React's `Awaited<State>` in the useActionState signature:
  // TypeScript cannot prove Awaited<S> === S for a generic S constrained to an
  // object type, even though it always is here (S is never a Promise). One
  // cast in the hook beats one at every call site.
  const [state, formAction, pending] = useActionState(
    action as unknown as (prev: ActionFormState, formData: FormData) => Promise<ActionFormState>,
    initialState as ActionFormState,
  ) as [S, (formData: FormData) => void, boolean];

  const lockRef = useRef(false);
  const sawPendingRef = useRef(false);

  // Kept in a ref so inline handler closures don't re-arm the resolution effect
  // on every render. Written in an effect (never during render), and declared
  // first so it lands before the effect below reads it in the same commit.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (pending) {
      sawPendingRef.current = true;
      return;
    }
    if (!sawPendingRef.current) return;
    sawPendingRef.current = false;
    lockRef.current = false;
    if (state.error) handlersRef.current.onError?.(state.error, state);
    else handlersRef.current.onSuccess?.(state);
  }, [pending, state]);

  const onSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      // preventDefault also stops React dispatching the action, which is
      // exactly what a locked form wants.
      if (lockRef.current || pending) {
        event.preventDefault();
        return;
      }
      lockRef.current = true;
    },
    [pending],
  );

  return { state, formAction, pending, error: state.error, onSubmit };
}
