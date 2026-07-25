import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useGetMe, getGetMeQueryKey } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";

import { lazy, Suspense } from 'react';
import Home from './pages/Home';
import OnboardingModal from './components/OnboardingModal';

const Sanctuary = lazy(() => import('./pages/Sanctuary'));

const queryClient = new QueryClient();

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(38 85% 60%)",
    colorForeground: "hsl(40 20% 88%)",
    colorMutedForeground: "hsl(40 10% 55%)",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "hsl(220 13% 13%)",
    colorInput: "hsl(220 13% 20%)",
    colorInputForeground: "hsl(40 20% 88%)",
    colorNeutral: "hsl(220 13% 20%)",
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-card border-card-border rounded-2xl w-[440px] max-w-full overflow-hidden shadow-2xl",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-serif text-2xl font-medium tracking-tight",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-medium",
    formFieldLabel: "text-foreground",
    footerActionLink: "text-primary hover:text-primary/90 transition-colors",
    footerActionText: "text-muted-foreground",
    dividerText: "text-muted-foreground",
    identityPreviewEditButton: "text-primary hover:text-primary/90",
    formFieldSuccessText: "text-green-500",
    alertText: "text-foreground",
    logoBox: "mb-2",
    logoImage: "",
    socialButtonsBlockButton: "border-border hover:bg-muted/50 transition-colors",
    formButtonPrimary: "bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium",
    formFieldInput: "bg-input border-border focus:border-primary text-foreground placeholder:text-muted-foreground/50",
    footerAction: "mt-4",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border-destructive text-destructive",
    otpCodeFieldInput: "border-border text-foreground focus:border-primary",
    formFieldRow: "mb-4",
    main: "w-full",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        afterSignInUrl={`${basePath}/sanctuary`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        afterSignUpUrl={`${basePath}/sanctuary`}
      />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      {/* Signed-in users see Home.tsx — it handles the notification check
          and auto-redirects to /sanctuary once notification data loads */}
      <Show when="signed-in">
        <Home />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

/**
 * Onboarding gate — sits between Clerk auth and the main workspace.
 *
 * Flow:
 *  1. Signed out          → redirect to landing page
 *  2. Signed in, loading  → full-screen spinner (avoids flash of wrong content)
 *  3. isProfileComplete=false → OnboardingModal (blocks the workspace)
 *  4. isProfileComplete=true  → Sanctuary (main workspace)
 */
function OnboardingGate() {
  const { data: me, isLoading, isError } = useGetMe();
  const qc = useQueryClient();

  // If the API errors (expired token, network, etc.) redirect home rather than spinning forever
  if (isError) {
    return <Redirect to="/" />;
  }

  // While /me is resolving, hold a neutral loading screen
  if (isLoading || !me) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" />
      </div>
    );
  }

  // Profile incomplete — show onboarding modal over a blurred workspace skeleton
  if (!me.isProfileComplete) {
    return (
      <>
        {/* Muted workspace skeleton so the modal has context behind it */}
        <div className="fixed inset-0 bg-background pointer-events-none" />
        <OnboardingModal
          onComplete={() => {
            // /me cache was already busted inside OnboardingModal on success;
            // an extra invalidation here ensures the gate re-evaluates.
            qc.invalidateQueries({ queryKey: getGetMeQueryKey() });
          }}
        />
      </>
    );
  }

  return (
    <Suspense fallback={
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground/50" />
      </div>
    }>
      <Sanctuary />
    </Suspense>
  );
}

function SanctuaryPortal() {
  return (
    <>
      <Show when="signed-in">
        <OnboardingGate />
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      afterSignInUrl={`${basePath}/sanctuary`}
      afterSignUpUrl={`${basePath}/sanctuary`}
      localization={{
        signIn: {
          start: {
            title: "Welcome back to The Room",
            subtitle: "Enter the quiet room",
          },
        },
        signUp: {
          start: {
            title: "Join The Room",
            subtitle: "A private place for two",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <ClerkQueryClientCacheInvalidator />
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sanctuary" component={SanctuaryPortal} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route path="*">
              <Redirect to="/" />
            </Route>
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
