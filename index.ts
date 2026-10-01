import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export function speechText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " Code is available in the written response. ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[`*_#>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .split(/\s+/)
    .join(" ");
}

export async function summarize(text: string, ctx: ExtensionContext, signal: AbortSignal): Promise<string> {
  if (!ctx.model) return speechText(text);
  const stream = ctx.modelRegistry.streamSimple(ctx.model, {
    messages: [
      {
        role: "system",
        timestamp: Date.now(),
        content: await readFile(new URL("./prompt.md", import.meta.url), "utf8"),
      },
      { role: "user", content: text, timestamp: Date.now() },
    ],
  }, { signal });
  const result = await stream.result();
  if (result.stopReason === "error" || result.stopReason === "aborted") {
    throw new Error(result.errorMessage || "Summary request failed");
  }
  const summary = speechText(result.content.filter((part) => part.type === "text").map((part) => part.text).join(" "));
  if (!summary) throw new Error("Summary request returned no text");
  return summary;
}

export function say(text: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // Standard input keeps response text out of shell commands and command options.
    const child = spawn("/usr/bin/say", [], { stdio: ["pipe", "ignore", "pipe"], signal });
    let error = "";
    child.stderr?.on("data", (chunk) => { error = (error + chunk.toString()).slice(-1000); });
    child.on("error", reject);
    child.stdin?.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(error || `say exited with code ${code}`));
    });
    child.stdin?.end(text);
  });
}

interface Dependencies {
  platform: string;
  summarize: typeof summarize;
  say: typeof say;
}

export function install(pi: ExtensionAPI, deps: Dependencies): void {
  if (deps.platform !== "darwin") return;
  let pending: string | undefined;
  let operation: AbortController | undefined;

  const cancel = () => {
    operation?.abort();
    operation = undefined;
  };

  pi.on("agent_start", () => {
    cancel();
    pending = undefined;
  });
  // Observe the written answer without changing it or its generating prompt.
  pi.on("message_end", ({ message }) => {
    if (message.role !== "assistant") return;
    pending = undefined;
    if (message.stopReason !== "stop" && message.stopReason !== "length") return;
    const text = message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n").trim();
    if (text) pending = text;
  });
  pi.on("session_shutdown", () => {
    cancel();
    pending = undefined;
  });
  pi.on("agent_settled", async (_event, ctx) => {
    const text = pending;
    pending = undefined;
    if (!text || !ctx.isIdle() || ctx.hasPendingMessages()) return;

    cancel();
    const controller = new AbortController();
    operation = controller;
    try {
      let summary: string;
      try {
        summary = await deps.summarize(text, ctx, controller.signal);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (ctx.hasUI) ctx.ui.notify("Voice summary failed.", "warning");
        return;
      }
      if (!summary || controller.signal.aborted || !ctx.isIdle() || ctx.hasPendingMessages()) return;
      await deps.say(summary, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted && ctx.hasUI) {
        ctx.ui.notify(`Voice output failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
      }
    } finally {
      if (operation === controller) operation = undefined;
    }
  });
}

export default function voice(pi: ExtensionAPI): void {
  install(pi, { platform: process.platform, summarize, say });
}
