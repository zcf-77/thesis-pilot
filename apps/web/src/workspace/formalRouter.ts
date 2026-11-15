import { createRouter, createWebHashHistory } from "vue-router";
import { accountRoute, projectsRoute } from "./workspaceRoutes";

const workspace = () => import("./WorkspaceShell.vue");

export const formalRouter = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "workspace-root", component: workspace },
    { path: "/projects", name: projectsRoute.name, component: workspace },
    { path: "/account", name: accountRoute.name, component: workspace },
    { path: "/projects/:projectId/write", name: "workspace-writing", component: workspace },
    { path: "/projects/:projectId/documents/:documentId/versions/:version", name: "workspace-version", component: workspace },
    { path: "/:pathMatch(.*)*", name: "workspace-invalid", component: workspace },
  ],
});
