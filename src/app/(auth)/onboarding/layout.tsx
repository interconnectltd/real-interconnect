import Image from "next/image";

// Provider は root layout に移動済 (route group 横断時の cache 維持)
export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border/50">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
          <Image
            src="/interconnect-logo-header.png"
            alt="INTER CONNECT"
            width={723}
            height={139}
            priority
            sizes="180px"
            className="h-7 w-auto"
          />
        </div>
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-8">
        <div className="w-full max-w-2xl">{children}</div>
      </main>
    </div>
  );
}
