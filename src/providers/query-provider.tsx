"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, type ReactNode } from "react";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // staleTime を 5min に延長 → cache validity 内は再 fetch 不要
            staleTime: 5 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
            retry: 2,
            retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
            // staleTime 中の mount 再 fetch を抑止 (B4対策)
            refetchOnMount: false,
            // window focus 時の自動 refetch を停止 (タブ復帰時に全 query が
            // 一斉再 fetch されると loading 表示でチラつくため)。staleTime 内
            // であれば cache を尊重し、明示的に refetch したい場合は
            // invalidateQueries / refetch を呼ぶ。
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
