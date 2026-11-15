import { createPinia } from "pinia";
import { createApp } from "vue";
import WorkspaceRoot from "./WorkspaceRoot.vue";
import { formalRouter } from "./workspace/formalRouter";
import "./design/styles/index.css";
import "./lab/lab.css";

createApp(WorkspaceRoot).use(createPinia()).use(formalRouter).mount("#app");
