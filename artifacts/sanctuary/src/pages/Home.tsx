import { Link, useLocation } from "wouter";
import { PenLine, Bell } from "lucide-react";
import { useUser } from "@clerk/react";
import {
  useGetNotifications,
  useMarkNotificationsSeen,
} from "@workspace/api-client-react";
import { useEffect } from "react";

export default function Home() {
  const { isSignedIn } = useUser();
  const [, setLocation] = useLocation();

  const { data: notifications, isSuccess: notifLoaded } = useGetNotifications({
    query: { enabled: isSignedIn === true },
  });

  const markSeenMutation = useMarkNotificationsSeen();

  const totalNew = isSignedIn
    ? (notifications?.newMessageReactions ?? 0) +
      (notifications?.newLetterComments ?? 0)
    : 0;

  // Only auto-redirect once notification data has actually loaded and shows nothing new
  useEffect(() => {
    if (!isSignedIn || !notifLoaded) return;
    if (totalNew === 0) {
      const t = setTimeout(() => setLocation("/sanctuary"), 400);
      return () => clearTimeout(t);
    }
  }, [isSignedIn, notifLoaded, totalNew, setLocation]);

  const handleEnter = () => {
    if (isSignedIn) {
      markSeenMutation.mutate();
    }
    setLocation(isSignedIn ? "/sanctuary" : "/sign-in");
  };

  // Compose the notification message
  const buildNotifText = () => {
    const parts: string[] = [];
    if ((notifications?.newMessageReactions ?? 0) > 0) {
      const n = notifications!.newMessageReactions;
      parts.push(`${n} new reaction${n === 1 ? "" : "s"} on your messages`);
    }
    if ((notifications?.newLetterComments ?? 0) > 0) {
      const n = notifications!.newLetterComments;
      parts.push(`${n} new note${n === 1 ? "" : "s"} on your letters`);
    }
    if ((notifications?.totalLetterReactions ?? 0) > 0 && parts.length === 0) {
      const n = notifications!.totalLetterReactions;
      parts.push(`${n} emoji reaction${n === 1 ? "" : "s"} on your letters`);
    }
    return parts.join(" · ");
  };

  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground relative overflow-hidden">
      <div
        className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]"
        style={{
          backgroundImage:
            "url('https://grainy-gradients.vercel.app/noise.svg')",
        }}
      ></div>
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>

      <header className="w-full flex justify-between items-center px-6 md:px-12 py-8 z-10 relative">
        <div className="flex items-center gap-3 text-primary">
          <PenLine size={24} className="stroke-1" />
          <span className="font-serif text-xl tracking-wide font-medium">
            The Room
          </span>
        </div>
        {!isSignedIn && (
          <Link
            href="/sign-in"
            className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors duration-300"
          >
            Sign In
          </Link>
        )}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 z-10 relative max-w-3xl mx-auto space-y-8 md:space-y-12">
        <div className="space-y-4 md:space-y-6">
          <h1 className="font-serif text-4xl md:text-7xl font-medium tracking-tight leading-tight">
            A quiet room <br />{" "}
            <span className="text-primary italic">for two.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-xl mx-auto font-light">
            Leave letters and whispers for each other. Zero noise, zero
            pressure, zero public performance. Your most private digital space.
          </p>
        </div>

        {/* Notification banner — only for signed-in users with new activity */}
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
          {isSignedIn ? "Enter the Room" : "Enter the Room"}
        </button>
      </main>

      <footer className="w-full py-8 text-center text-muted-foreground/60 text-sm z-10 relative font-light">
        <p>A private, intentional digital space.</p>
      </footer>
    </div>
  );
}
