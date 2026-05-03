import type { Metadata } from "next";
import { TokushohoContent } from "@/components/legal/tokushoho-content";

export const metadata: Metadata = {
  title: "特定商取引法に基づく表記",
  robots: { index: true, follow: true },
};

export default function TokushohoPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <TokushohoContent />
    </div>
  );
}
