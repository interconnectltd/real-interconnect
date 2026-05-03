import type { Metadata } from "next";
import { TermsContent } from "@/components/legal/terms-content";

export const metadata: Metadata = {
  title: "利用規約",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <TermsContent />
    </div>
  );
}
