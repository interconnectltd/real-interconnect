"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api-client";
import { useUIStore } from "@/stores/ui-store";

export function UpgradeDialog() {
  const { upgradeDialogOpen, closeUpgradeDialog } = useUIStore();
  const [loading, setLoading] = useState(false);

  const handleSubscribe = async () => {
    setLoading(true);
    try {
      const res = await api.post<{ url: string }>("/billing/checkout");
      if (res?.url) window.location.href = res.url;
    } catch {
      setLoading(false);
    }
  };

  return (
    <Dialog open={upgradeDialogOpen} onOpenChange={closeUpgradeDialog}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>有料プランが必要です</DialogTitle>
          <DialogDescription>
            この機能は Standard プラン以上でご利用いただけます。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 flex flex-col gap-2">
          <Button
            variant="default"
            onClick={handleSubscribe}
            disabled={loading}
            className="w-full"
          >
            {loading ? "遷移中…" : "プランをアップグレード"}
          </Button>
          <Button
            variant="outline"
            onClick={closeUpgradeDialog}
            className="w-full"
          >
            あとで
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
