import { downloadMemoryBackup } from "@web/files/download";
import { chooseMemoryArchive } from "@web/files/memory";
import { apiOrigin } from "../environment";

export const exportMemory = () => downloadMemoryBackup(apiOrigin);
export const inspectMemory = () => chooseMemoryArchive(apiOrigin);
