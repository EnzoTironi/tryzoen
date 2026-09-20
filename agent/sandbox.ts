import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// Skills and scratch files use Eve's virtual filesystem on every host.
// Shell execution is disabled in the authored tools; customer code uses QuickJS.
export default defineSandbox({ backend: justbash({ autoInstall: false }) });
