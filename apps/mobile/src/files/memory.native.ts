import { sharePrivateArchive } from "./archive.native";

export const exportMemory = () =>
  sharePrivateArchive({
    path: "/api/workspaces/memory/backup",
    filename: "zoen-learned-memory.zip",
    mimeType: "application/zip",
    title: "Save memory backup",
  });
