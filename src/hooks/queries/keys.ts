export const queryKeys = {
  profile: {
    all: ["profiles"] as const,
    detail: (id: string) => ["profiles", id] as const,
    me: () => ["profiles", "me"] as const,
  },
  connections: {
    all: ["connections"] as const,
    list: (filter?: Record<string, unknown>) =>
      ["connections", "list", filter] as const,
  },
  notifications: {
    all: ["notifications"] as const,
    list: (unreadOnly?: boolean) =>
      ["notifications", "list", { unreadOnly }] as const,
    unreadCount: () => ["notifications", "unread-count"] as const,
  },
  matching: {
    all: ["matching"] as const,
    scores: (filter?: Record<string, unknown>) =>
      ["matching", "scores", filter] as const,
    detail: (userId: string) => ["matching", "detail", userId] as const,
    mutual: () => ["matching", "mutual"] as const,
  },
  members: {
    all: ["members"] as const,
    list: (search: string, filters?: Record<string, unknown>) =>
      ["members", "list", search, filters] as const,
  },
  bookmarks: {
    all: ["bookmarks"] as const,
    list: () => ["bookmarks", "list"] as const,
  },
  aiProfile: {
    all: ["ai-profile"] as const,
    analysisCount: () => ["ai-profile", "analysis-count"] as const,
  },
  meetings: {
    all: ["meetings"] as const,
    list: () => ["meetings", "list"] as const,
  },
  feedback: {
    all: ["feedback"] as const,
    byTarget: (targetId: string) => ["feedback", targetId] as const,
  },
} as const;
