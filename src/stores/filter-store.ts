import { create } from "zustand";

interface FilterStore {
  // Member search
  memberSearch: string;
  memberIndustryFilter: string[];
  setMemberSearch: (q: string) => void;
  setMemberIndustryFilter: (industries: string[]) => void;
  resetMemberFilters: () => void;

  // Matching filters
  matchingSortBy: "score" | "recent";
  matchingMinScore: number;
  setMatchingSortBy: (sort: "score" | "recent") => void;
  setMatchingMinScore: (min: number) => void;

  // Connection tab
  connectionTab: "all" | "pending" | "sent";
  setConnectionTab: (tab: "all" | "pending" | "sent") => void;
}

export const useFilterStore = create<FilterStore>((set) => ({
  memberSearch: "",
  memberIndustryFilter: [],
  setMemberSearch: (q) => set({ memberSearch: q }),
  setMemberIndustryFilter: (industries) =>
    set({ memberIndustryFilter: industries }),
  resetMemberFilters: () =>
    set({ memberSearch: "", memberIndustryFilter: [] }),

  matchingSortBy: "score",
  matchingMinScore: 0,
  setMatchingSortBy: (sort) => set({ matchingSortBy: sort }),
  setMatchingMinScore: (min) => set({ matchingMinScore: min }),

  connectionTab: "all",
  setConnectionTab: (tab) => set({ connectionTab: tab }),
}));
