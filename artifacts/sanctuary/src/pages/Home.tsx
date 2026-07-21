import { Link } from "wouter";
import { PenLine } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-[100dvh] w-full flex flex-col bg-background text-foreground relative overflow-hidden">
      <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: "url('https://grainy-gradients.vercel.app/noise.svg')" }}></div>
      <div className="absolute inset-0 z-0 pointer-events-none opacity-20 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background"></div>
      
      <header className="w-full flex justify-between items-center px-6 md:px-12 py-8 z-10 relative">
        <div className="flex items-center gap-3 text-primary">
          <PenLine size={24} className="stroke-1" />
          <span className="font-serif text-xl tracking-wide font-medium">The Room</span>
        </div>
        <Link href="/sign-in" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors duration-300">
          Sign In
        </Link>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 z-10 relative max-w-3xl mx-auto space-y-12">
        <div className="space-y-6">
          <h1 className="font-serif text-5xl md:text-7xl font-medium tracking-tight leading-tight">
            A quiet room <br /> <span className="text-primary italic">for two.</span>
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-xl mx-auto font-light">
            Leave letters and whispers for each other. Zero noise, zero pressure, zero public performance. Your most private digital space.
          </p>
        </div>

        <Link 
          href="/sign-up" 
          className="inline-flex items-center justify-center px-8 py-4 bg-primary text-primary-foreground rounded-full font-medium hover:bg-primary/90 transition-all duration-300 hover-elevate shadow-lg hover:shadow-primary/25"
        >
          Enter the The Room
        </Link>
      </main>

      <footer className="w-full py-8 text-center text-muted-foreground/60 text-sm z-10 relative font-light">
        <p>A private, intentional digital space.</p>
      </footer>
    </div>
  );
}
