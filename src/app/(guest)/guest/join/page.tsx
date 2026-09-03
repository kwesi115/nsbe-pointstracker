import GuestJoinForm from "@/components/GuestJoinForm";

export default function GuestJoinPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Guest check-in</h1>
        <p className="mt-1 text-sm text-muted">Enter the guest code to see what&apos;s open right now.</p>
      </div>
      <GuestJoinForm />
    </main>
  );
}
