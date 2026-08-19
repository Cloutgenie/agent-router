export interface SavedView {
  name: string;
  minScore: number;
  minConfidence: number;
  verifiedOnly: boolean;
}

const STORAGE_KEY = "task-dropoff:saved-views";

export const BUILT_IN_VIEWS: SavedView[] = [
  { name: "High-confidence buyers", minScore: 0, minConfidence: 0.8, verifiedOnly: false },
  { name: "Strong security signal", minScore: 70, minConfidence: 0, verifiedOnly: false },
  { name: "Top opportunities", minScore: 80, minConfidence: 0, verifiedOnly: false },
  { name: "Verified only", minScore: 0, minConfidence: 0, verifiedOnly: true },
];

export function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedView[]) : [];
  } catch {
    return [];
  }
}

export function saveSavedView(view: SavedView): SavedView[] {
  const existing = loadSavedViews().filter((v) => v.name !== view.name);
  const next = [...existing, view];
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}

export function deleteSavedView(name: string): SavedView[] {
  const next = loadSavedViews().filter((v) => v.name !== name);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  return next;
}
