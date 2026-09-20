import { Link } from "wouter";

export default function NotFound() {
  return (
    <div className="flex h-screen items-center justify-center bg-background text-foreground">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold font-mono text-primary">404</h1>
        <p className="text-muted-foreground text-lg">The requested path could not be found.</p>
        <Link href="/" className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground h-10 px-6 font-medium shadow hover:bg-primary/90 transition-colors">
          Return to Dashboard
        </Link>
      </div>
    </div>
  );
}
