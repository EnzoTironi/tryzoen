import { Client } from "eve/client";
import { browserWorkspaceHeaders } from "@web/workspaces/navigation";
export const browserSessionClient = new Client({
  host: "",
  headers: browserWorkspaceHeaders,
  redirect: "error",
});
