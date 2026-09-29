import { downloadMemoryBackup } from "@web/files/download";
import { apiOrigin } from "../environment";

export const exportMemory = () => downloadMemoryBackup(apiOrigin);
