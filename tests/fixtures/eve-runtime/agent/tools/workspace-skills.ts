import { defineDynamic } from "eve/tools";
import workspaceSkills from "../../../../../agent/tools/workspace-skills";

export default defineDynamic({ events: workspaceSkills.events });
