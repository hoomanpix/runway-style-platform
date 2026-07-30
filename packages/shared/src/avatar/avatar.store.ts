import { create } from "zustand";

export type AvatarStatus = "idle" | "uploading" | "processing" | "ready";

export interface AvatarState {
  status: AvatarStatus;
  photos: string[];
  setPhotos: (photos: string[]) => void;
  setStatus: (status: AvatarStatus) => void;
}

export const useAvatarStore = create<AvatarState>((set) => ({
  status: "idle",
  photos: [],
  setPhotos: (photos) => set({ photos }),
  setStatus: (status) => set({ status }),
}));
