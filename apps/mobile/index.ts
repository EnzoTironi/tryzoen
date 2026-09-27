// Eve's stream lifecycle needs these built-ins before its modules initialize.
/* oxlint-disable import/no-unassigned-import -- Core-js installs missing native runtime built-ins before the SDK loads. */
import "core-js/actual/symbol/dispose";
import "core-js/actual/symbol/async-dispose";
import "core-js/actual/symbol/async-iterator";
import "core-js/actual/promise/with-resolvers";
/* oxlint-enable import/no-unassigned-import */
import { registerRootComponent } from "expo";
import { App } from "./src/app";

registerRootComponent(App);
