import { redirect } from "next/navigation";
import { companionAppOrigin } from "../(marketing)/public-origin";

export default function GetStartedPage() {
  redirect(`${companionAppOrigin}/`);
}
