import { useState, useRef, useEffect } from "react";
import { useUpdateProfile } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetMeQueryKey } from "@workspace/api-client-react";
import { Loader2, Feather } from "lucide-react";

interface OnboardingModalProps {
  /** Called after the display name is saved and the profile is marked complete. */
  onComplete: () => void;
}

/**
 * Full-screen first-login gate.
 *
 * Shown when `me.isProfileComplete === false`. Asks the user for their
 * preferred display name, saves it via PATCH /profile, then calls onComplete
 * so the parent can re-check the flag and reveal the workspace.
 *
 * The login email / Clerk username is never shown here — only the display name
 * field matters for the in-app identity.
 */
export default function OnboardingModal({ onComplete }: OnboardingModalProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    // Slight delay so the animation doesn't clip the autofocus flash
    const t = setTimeout(() => inputRef.current?.focus(), 150);
    return () => clearTimeout(t);
  }, []);

  const updateProfile = useUpdateProfile();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();

    if (!trimmed) {
      setError("Please enter a name — even a short one.");
      inputRef.current?.focus();
      return;
    }
    if (trimmed.length > 40) {
      setError("Keep it under 40 characters.");
      return;
    }

    setError("");

    updateProfile.mutate(
      { data: { displayName: trimmed } },
      {
        onSuccess: () => {
          // Bust the /me cache so isProfileComplete is re-read as true
          qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
          onComplete();
        },
        onError: () => {
          setError("Something went wrong. Please try again.");
        },
      },
    );
  };

  return (
    /* Backdrop */
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-md px-4">

      {/* Ambient glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      {/* Card */}
      <div className="relative w-full max-w-md animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="bg-card border border-border/60 rounded-2xl shadow-2xl overflow-hidden">

          {/* Header strip */}
          <div className="px-8 pt-10 pb-6 text-center">
            <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mx-auto mb-5">
              <Feather className="w-6 h-6 text-primary" strokeWidth={1.5} />
            </div>
            <h1 className="font-serif text-2xl font-medium tracking-tight text-foreground mb-2">
              Welcome to The Room
            </h1>
            <p className="text-sm text-muted-foreground font-light leading-relaxed">
              What name would you like to use in your space?
              <br />
              <span className="text-muted-foreground/60 text-xs">
                This is what your partner will see — not your email.
              </span>
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="px-8 pb-10 space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="display-name"
                className="block text-xs font-medium uppercase tracking-wider text-muted-foreground/70"
              >
                Display Name
              </label>
              <input
                ref={inputRef}
                id="display-name"
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (error) setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleSubmit(e as unknown as React.FormEvent);
                  }
                }}
                maxLength={41}
                placeholder="e.g. Alex, Love, or your nickname…"
                autoComplete="off"
                spellCheck={false}
                className={`
                  w-full bg-input border rounded-xl px-4 py-3 text-foreground
                  placeholder:text-muted-foreground/40 font-light text-[15px]
                  outline-none transition-all duration-200
                  focus:ring-2 focus:ring-primary/30 focus:border-primary/60
                  ${error ? "border-destructive/70 focus:ring-destructive/20 focus:border-destructive/70" : "border-border"}
                `}
              />
              {error && (
                <p className="text-destructive text-xs font-light animate-in fade-in slide-in-from-top-1 duration-200">
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={updateProfile.isPending || !name.trim()}
              className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-xl py-3 font-medium text-[15px] hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm shadow-primary/20"
            >
              {updateProfile.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Saving…</span>
                </>
              ) : (
                "Enter The Room"
              )}
            </button>

            <p className="text-center text-[11px] text-muted-foreground/40 font-light">
              You can change this later in your profile settings.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
