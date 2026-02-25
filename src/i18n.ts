import { invoke } from "@tauri-apps/api/core";

let translations: Record<string, any> = {};

export async function loadTranslations(): Promise<void> {
  translations = await invoke("get_translations");
}

export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split(".");
  let val: any = translations;
  for (const part of parts) {
    if (val == null || typeof val !== "object") return key;
    val = val[part];
  }
  if (typeof val !== "string") {
    // Could be array or object — return key
    if (val == null) return key;
    return JSON.stringify(val);
  }
  if (params) {
    return val.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`));
  }
  return val;
}

export function tRaw(key: string): any {
  const parts = key.split(".");
  let val: any = translations;
  for (const part of parts) {
    if (val == null || typeof val !== "object") return undefined;
    val = val[part];
  }
  return val;
}
