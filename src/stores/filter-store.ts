import { create } from "zustand";
import type { MemberSortBy } from "@/lib/constants";

interface FilterStore {
  // Member search
  memberSearch: string;
  memberIndustryFilter: string[];
  memberSortBy: MemberSortBy;
  memberPositionFilter: string;
  setMemberSearch: (q: string) => void;
  setMemberIndustryFilter: (industries: string[]) => void;
  setMemberSortBy: (sort: MemberSortBy) => void;
  setMemberPositionFilter: (position: string) => void;
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
  memberSortBy: "score",
  memberPositionFilter: "",
  setMemberSearch: (q) => set({ memberSearch: q }),
  setMemberIndustryFilter: (industries) =>
    set({ memberIndustryFilter: industries }),
  setMemberSortBy: (sort) => set({ memberSortBy: sort }),
  setMemberPositionFilter: (position) => set({ memberPositionFilter: position }),
  resetMemberFilters: () =>
    set({ memberSearch: "", memberIndustryFilter: [], memberSortBy: "score", memberPositionFilter: "" }),

  matchingSortBy: "score",
  matchingMinScore: 0,
  setMatchingSortBy: (sort) => set({ matchingSortBy: sort }),
  setMatchingMinScore: (min) => set({ matchingMinScore: min }),

  connectionTab: "all",
  setConnectionTab: (tab) => set({ connectionTab: tab }),
}));
