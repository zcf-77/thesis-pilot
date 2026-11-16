import { createRouter, createWebHashHistory } from "vue-router";
import { accountRoute, configurationsRoute, flowsRoute, jobsRoute, projectsRoute } from "./workspaceRoutes";

const workspace = () => import("./WorkspaceShell.vue");

export const formalRouter = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "workspace-root", component: workspace },
    { path: "/projects", name: projectsRoute.name, component: workspace },
    { path: "/flows", name: flowsRoute.name, component: workspace },
    { path: "/configurations", name: configurationsRoute.name, component: workspace },
    { path: "/account", name: accountRoute.name, component: workspace },
    { path: "/jobs", name: jobsRoute.name, component: workspace },
    { path: "/projects/:projectId/write", name: "workspace-writing", component: workspace },
    { path: "/projects/:projectId/materials", name: "workspace-materials", component: workspace },
    { path: "/projects/:projectId/tasks", name: "workspace-tasks", component: workspace },
    { path: "/projects/:projectId/feedback", name: "workspace-feedback", component: workspace },
    { path: "/projects/:projectId/review", name: "workspace-review", component: workspace },
    { path: "/projects/:projectId/jobs", name: "workspace-project-jobs", component: workspace },
    { path: "/projects/:projectId/jobs/:jobId", name: "workspace-job", component: workspace },
    { path: "/projects/:projectId/documents/:documentId/versions/:version", name: "workspace-version", component: workspace },
    { path: "/:pathMatch(.*)*", name: "workspace-invalid", component: workspace },
  ],
});
