import { LogoSpinner } from "@/components/ui/logo-spinner";

export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LogoSpinner size="lg" showText />
    </div>
  );
}
