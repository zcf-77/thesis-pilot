import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** 同一套交互检查可以验证 HTTP 构建产物或可独立打开的单文件展台。 */
export function appUrl(route: string): string {
  const file = process.env.PLAYWRIGHT_FILE;
  return (file ? pathToFileURL(resolve(file)).href : "/") + "#" + route;
}
