/**
 * Shared between /join (step 2) and /guest/join (Part 7): single large field,
 * uppercase display, autofocus, paste-safe, inputMode text.
 */
export default function JoinCodeInput({
  name = "code",
  autoFocus = true,
}: {
  name?: string;
  autoFocus?: boolean;
}) {
  return (
    <input
      name={name}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      inputMode="text"
      maxLength={12}
      placeholder="ABCD1234"
      onInput={(e) => {
        e.currentTarget.value = e.currentTarget.value.toUpperCase();
      }}
      className="w-full rounded-xl border border-line bg-white px-4 py-5 text-center font-mono text-2xl uppercase tracking-[0.3em] text-ink placeholder:text-muted/40 focus-visible:border-signal"
    />
  );
}
