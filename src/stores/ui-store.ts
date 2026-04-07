import { create } from "zustand";

interface ConfirmDialogConfig {
  title: string;
  description: string;
  onConfirm: () => void;
  destructive?: boolean;
}

interface UIStore {
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  profileModalUserId: string | null;
  openProfileModal: (userId: string) => void;
  closeProfileModal: () => void;

  confirmDialog: (ConfirmDialogConfig & { open: true }) | null;
  showConfirmDialog: (config: ConfirmDialogConfig) => void;
  closeConfirmDialog: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  profileModalUserId: null,
  openProfileModal: (userId) => set({ profileModalUserId: userId }),
  closeProfileModal: () => set({ profileModalUserId: null }),

  confirmDialog: null,
  showConfirmDialog: (config) =>
    set({ confirmDialog: { ...config, open: true } }),
  closeConfirmDialog: () => set({ confirmDialog: null }),
}));
