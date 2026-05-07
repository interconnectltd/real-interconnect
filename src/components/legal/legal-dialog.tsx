"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TermsContent } from "@/components/legal/terms-content";
import { PrivacyContent } from "@/components/legal/privacy-content";
import { TokushohoContent } from "@/components/legal/tokushoho-content";

export type LegalTab = "terms" | "privacy" | "tokushoho";

/**
 * 利用規約・プライバシーポリシー・特商法表記をタブ切替で表示するダイアログ。
 *
 * Wave9 修正 (2026-05-07):
 *   旧設計では trigger ボタンを `<DialogTrigger render={...}>` で wrap していたが、
 *   Base UI の internal click handler が React 19 の concurrent render と相性悪く、
 *   モバイル実機で「タップしても出ない」事故が発生する事があった。
 *   → 新設計: 完全に **外部 controlled** で `open`/`onOpenChange`/`tab` を受け取り、
 *     trigger は呼出側で普通の `<button onClick={() => setOpen(true)}>` として書く。
 *     これにより BaseUI の slot 化レイヤを介さず click が確実に発火する。
 *
 *   また 4 inst 同居で発生していた backdrop 残留事故 (Wave7 G C-1) も
 *   呼出側でシングルインスタンスを保持する事で根治可能。
 */
type LegalDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 表示するタブ */
  tab?: LegalTab;
  onTabChange?: (tab: LegalTab) => void;
};

export function LegalDialog({
  open,
  onOpenChange,
  tab = "terms",
  onTabChange,
}: LegalDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        // h-[85vh] を fallback (iOS 15.4 未満で dvh 未対応時の squash 防止)。
        // 後続の dvh が対応 browser で上書き。max-h-[calc(100svh-4rem)] で
        // status bar / 通知バー領域に被らないよう保証。
        className="flex h-[85vh] max-h-[calc(100svh-4rem)] w-full max-w-3xl flex-col gap-3 overflow-hidden p-4 sm:max-w-3xl supports-[height:1dvh]:h-[85dvh]"
      >
        <DialogTitle className="text-base font-semibold">法務文書</DialogTitle>
        <DialogDescription>
          以下の3点をご確認のうえ、登録画面に戻ってチェックボックスにご同意ください。
        </DialogDescription>
        <Tabs
          value={tab}
          onValueChange={(v: string) => onTabChange?.(v as LegalTab)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList variant="line" className="w-full justify-start gap-2">
            <TabsTrigger value="terms">利用規約</TabsTrigger>
            <TabsTrigger value="privacy">プライバシー</TabsTrigger>
            <TabsTrigger value="tokushoho">特商法</TabsTrigger>
          </TabsList>
          {/* iOS Safari の rubber-band scroll chain で backdrop がめくれる事故を遮断 */}
          <div
            className="-mx-4 flex-1 overflow-y-auto overscroll-contain px-4 pt-4"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            <TabsContent value="terms" className="focus-visible:outline-none">
              <TermsContent />
            </TabsContent>
            <TabsContent value="privacy" className="focus-visible:outline-none">
              <PrivacyContent />
            </TabsContent>
            <TabsContent value="tokushoho" className="focus-visible:outline-none">
              <TokushohoContent />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
