import { defineDynamic } from "eve/skills";
import workspace from "../../../../../agent/skills/workspace";

export default defineDynamic({ events: workspace.events });
