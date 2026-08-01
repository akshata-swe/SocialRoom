import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Bell, X } from "lucide-react";
import { useUser, SignIn, SignUp } from "@clerk/react";
import {
  useGetNotifications,
  useMarkNotificationsSeen,
} from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export default function Home() {
  const { isSignedIn } = useUser();
  const [, setLocation] = useLocation();
  const [authView, setAuthView] = useState<"signin" | "signup" | null>(null);

  const { data: notifications, isSuccess: notifLoaded } = useGetNotifications({
    query: { enabled: isSignedIn === true },
  });

  const markSeenMutation = useMarkNotificationsSeen();

  // Sum every signal type that means "something new is waiting"
  const totalNew = isSignedIn
    ? (notifications?.newMessages ?? 0) +
      (notifications?.newLetters ?? 0) +
      (notifications?.newMessageReactions ?? 0) +
      (notifications?.newLetterComments ?? 0)
    : 0;

  // Auto-redirect when there is nothing new to announce
  useEffect(() => {
    if (!isSignedIn || !notifLoaded) return;
    if (totalNew === 0) {
      const t = setTimeout(() => setLocation("/sanctuary"), 400);
      return () => clearTimeout(t);
    }
  }, [isSignedIn, notifLoaded, totalNew, setLocation]);

  // Close auth overlay once Clerk confirms sign-in
  useEffect(() => {
    if (isSignedIn && authView) setAuthView(null);
  }, [isSignedIn, authView]);

  const handleEnter = () => {
    if (isSignedIn) {
      markSeenMutation.mutate();
      setLocation("/sanctuary");
    } else {
      setAuthView("signin");
    }
  };

  const buildNotifText = () => {
    const parts: string[] = [];

    const msgs = notifications?.newMessages ?? 0;
    if (msgs > 0) parts.push(`${msgs} new message${msgs === 1 ? "" : "s"}`);

    const letters = notifications?.newLetters ?? 0;
    if (letters > 0) parts.push(`${letters} new letter${letters === 1 ? "" : "s"}`);

    const msgReacts = notifications?.newMessageReactions ?? 0;
    if (msgReacts > 0)
      parts.push(`${msgReacts} new reaction${msgReacts === 1 ? "" : "s"} on your messages`);

    const notes = notifications?.newLetterComments ?? 0;
    if (notes > 0)
      parts.push(`${notes} new note${notes === 1 ? "" : "s"} on your letters`);

    // Letter reactions have no timestamp so only show them if nothing else fired
    if (parts.length === 0) {
      const lr = notifications?.totalLetterReactions ?? 0;
      if (lr > 0)
        parts.push(`${lr} emoji reaction${lr === 1 ? "" : "s"} on your letters`);
    }

    return parts.join(" · ");
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground relative overflow-hidden">
      {/* Background texture */}
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]"
        style={{ backgroundImage: "url('https://grainy-gradients.vercel.app/noise.svg')" }}
      />
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background" />

      <header className="w-full flex justify-between items-center px-6 md:px-12 py-8 z-10 relative">
        <span className="font-serif text-xl tracking-wide font-medium text-primary">
          Kothadi
        </span>
        {!isSignedIn && (
          <button
            onClick={() => setAuthView("signin")}
            className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors duration-300"
          >
            Sign In
          </button>
        )}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 z-10 relative max-w-3xl mx-auto space-y-8 md:space-y-12">
        <div className="space-y-4 md:space-y-6">
          <h1 className="font-serif text-4xl md:text-7xl font-medium tracking-tight leading-tight">
            A quiet room <br />
            <span className="text-primary italic">for two.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-xl mx-auto font-light">
            Leave letters for each other.
          </p>
        </div>

        {isSignedIn && totalNew > 0 && (
          <div className="flex items-center gap-3 px-6 py-4 bg-primary/10 border border-primary/30 rounded-2xl text-sm text-foreground/90 font-light max-w-md animate-in fade-in slide-in-from-bottom-2 duration-500">
            <Bell size={16} className="text-primary shrink-0" />
            <span>{buildNotifText()}</span>
          </div>
        )}

        <button
          onClick={handleEnter}
          className="inline-flex items-center justify-center px-8 py-4 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-all duration-300 shadow-lg hover:shadow-primary/25"
        >
          Enter
        </button>
      </main>

      <footer className="w-full py-8 text-center text-muted-foreground/60 text-sm z-10 relative font-light">
        <p>A private, intentional digital space.</p>
      </footer>

      {/* Inline auth overlay */}
      {authView && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-sm px-4 animate-in fade-in duration-200">
          <div className="relative w-full max-w-sm">
            <button
              onClick={() => setAuthView(null)}
              className="absolute -top-10 right-0 p-2 text-muted-foreground/50 hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <X size={20} />
            </button>

            {authView === "signin" ? (
              <>
                <SignIn
                  routing="virtual"
                  afterSignInUrl={`${basePath}/sanctuary`}
                  appearance={{
                    elements: {
                      footer: { display: "none" },
                    },
                  }}
                />
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  Don't have an account?{" "}
                  <button
                    onClick={() => setAuthView("signup")}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign up
                  </button>
                </p>
              </>
            ) : (
              <>
                <SignUp
                  routing="virtual"
                  afterSignUpUrl={`${basePath}/sanctuary`}
                  appearance={{
                    elements: {
                      footer: { display: "none" },
                    },
                  }}
                />
                <p className="mt-4 text-center text-sm text-muted-foreground">
                  Already have an account?{" "}
                  <button
                    onClick={() => setAuthView("signin")}
                    className="text-primary hover:underline font-medium"
                  >
                    Sign in
                  </button>
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
