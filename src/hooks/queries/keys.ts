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
  meetings: {
    all: ["meetings"] as const,
    list: () => ["meetings", "list"] as const,
  },
  feedback: {
    all: ["feedback"] as const,
    byTarget: (targetId: string) => ["feedback", targetId] as const,
  },
  agency: {
    all: ["agency"] as const,
    me: () => ["agency", "me"] as const,
    applicationMe: () => ["agency", "application", "me"] as const,
    links: () => ["agency", "links"] as const,
    referrals: () => ["agency", "referrals"] as const,
    clicks: () => ["agency", "clicks"] as const,
    commissions: (filter?: Record<string, unknown>) =>
      ["agency", "commissions", filter] as const,
  },
  adminAgency: {
    all: ["admin-agency"] as const,
    applications: (status?: string) =>
      ["admin-agency", "applications", { status }] as const,
    agencies: (status?: string) =>
      ["admin-agency", "agencies", { status }] as const,
  },
} as const;
