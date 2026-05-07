"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TermsContent } from "@/components/legal/terms-content";
import { PrivacyContent } from "@/components/legal/privacy-content";
import { TokushohoContent } from "@/components/legal/tokushoho-content";

type LegalTab = "terms" | "privacy" | "tokushoho";

type LegalDialogProps = {
  /**
   * モーダルを開くトリガー要素。`<a>`等を渡すとそのままトリガーになる。
   * 省略時は内部でテキストリンクを表示。
   */
  trigger?: React.ReactNode;
  /**
   * 初期表示するタブ。
   */
  defaultTab?: LegalTab;
};

/**
 * 利用規約・プライバシーポリシー・特商法表記をタブ切替で表示するダイアログ。
 *
 * 主用途: 登録フォーム上で開いてもReactフォームのstateが消えないようにする。
 * /terms /privacy /tokushoho ページとは別経路だが本文コンポーネントを共有しているので
 * 内容の齟齬は生じない。
 */
export function LegalDialog({ trigger, defaultTab = "terms" }: LegalDialogProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          trigger ? (
            (trigger as React.ReactElement<Record<string, unknown>>)
          ) : (
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
            >
              利用規約・プライバシーポリシー・特商法表記
            </button>
          )
        }
      />
      <DialogContent
        // h-[85vh] を fallback (iOS 15.4 未満で dvh 未対応時の squash 防止)。
        // 後続の dvh が対応 browser で上書き。max-h-[calc(100svh-4rem)] で
        // status bar / 通知バー領域に被らないよう保証。
        className="flex h-[85vh] max-h-[calc(100svh-4rem)] w-full max-w-3xl flex-col gap-3 overflow-hidden p-4 sm:max-w-3xl supports-[height:1dvh]:h-[85dvh]"
      >
        <DialogTitle className="text-base font-semibold">
          法務文書
        </DialogTitle>
        <DialogDescription>
          以下の3点をご確認のうえ、登録画面に戻ってチェックボックスにご同意ください。
        </DialogDescription>
        <Tabs
          defaultValue={defaultTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList variant="line" className="w-full justify-start gap-2">
            <TabsTrigger value="terms">利用規約</TabsTrigger>
            <TabsTrigger value="privacy">プライバシー</TabsTrigger>
            <TabsTrigger value="tokushoho">特商法</TabsTrigger>
          </TabsList>
          {/* iOS Safari の rubber-band scroll chain で backdrop がめくれる事故を遮断
              (overscroll-contain) + Webkit momentum scroll 確保 */}
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
