import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { install, speechText, summarize } from "../index.ts";

function fixture(options: { platform?: string; failSummary?: boolean; failSpeech?: boolean } = {}) {
  const handlers = new Map<string, (event: any, ctx: ExtensionContext) => any>();
  const spoken: string[] = [];
  const warnings: string[] = [];
  const summaryInputs: string[] = [];
  let summaries = 0;
  let idle = true;
  let queued = false;
  const ctx = {
    isIdle: () => idle,
    hasPendingMessages: () => queued,
    hasUI: true,
    ui: { notify: (text: string) => warnings.push(text) },
  } as unknown as ExtensionContext;
  const pi = { on: (name: string, handler: any) => handlers.set(name, handler) } as unknown as ExtensionAPI;
  install(pi, {
    platform: options.platform ?? "darwin",
    summarize: async (text) => {
      summaryInputs.push(text);
      summaries++;
      if (options.failSummary) throw new Error("offline");
      return "The work is complete. All tests passed.";
    },
    say: async (text) => {
      if (options.failSpeech) throw new Error("audio unavailable");
      spoken.push(text);
    },
  });
  const emit = (name: string, event = {}) => handlers.get(name)?.(event, ctx);
  const message = (text: string, stopReason = "stop") => emit("message_end", {
    message: { role: "assistant", stopReason, content: [{ type: "thinking", thinking: "secret" }, { type: "text", text }] },
  });
  return { emit, message, spoken, warnings, summaryInputs, handlers, ctx, pi,
    summaries: () => summaries,
    setIdle: (value: boolean) => { idle = value; },
    setQueued: (value: boolean) => { queued = value; },
  };
}

test("speaks once only after settlement, using the final answer", async () => {
  const f = fixture();
  f.emit("agent_start");
  f.message("Working...", "toolUse");
  f.message("Done.");
  assert.deepEqual(f.spoken, []);
  await f.emit("agent_settled");
  await f.emit("agent_settled");
  assert.deepEqual(f.spoken, ["Done."]);
  assert.equal(f.summaries(), 0);
});

test("keeps detailed written results unchanged and summarizes them separately", async () => {
  const f = fixture();
  const text = "# Detailed results\n" + "Result detail. ".repeat(100) + "\n\n\`\`\`ts\nconst result = true;\n\`\`\`";
  const message = { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] };
  const original = structuredClone(message);
  assert.equal(await f.emit("message_end", { message }), undefined);
  await f.emit("agent_settled");
  assert.deepEqual(message, original);
  assert.deepEqual(f.summaryInputs, [text]);
  assert.deepEqual(f.spoken, ["The work is complete. All tests passed."]);
  assert.equal(f.handlers.has("before_agent_start"), false);
  assert.equal(f.handlers.has("context"), false);
});

test("reads up to 200 spoken words directly and summarizes longer responses", async () => {
  for (const words of [199, 200, 201]) {
    const f = fixture();
    const text = "Detail ".repeat(words).trim();
    f.message(text);
    await f.emit("agent_settled");
    assert.deepEqual(f.spoken, [words <= 200 ? text : "The work is complete. All tests passed."]);
    assert.equal(f.summaries(), words <= 200 ? 0 : 1);
  }
});

test("uses cleaned speech text to select direct reading", async () => {
  const f = fixture({ failSummary: true });
  f.message("**Done.** [Tests passed](https://example.com).\n```ts\n" + "code ".repeat(100) + "\n```");
  await f.emit("agent_settled");
  assert.deepEqual(f.spoken, ["Done. Tests passed. Code is available in the written response."]);
  assert.equal(f.summaries(), 0);
  assert.deepEqual(f.warnings, []);
});

test("does not request a summary or speak when cleaned text is empty", async () => {
  const f = fixture();
  f.message("https://example.com");
  await f.emit("agent_settled");
  assert.equal(f.summaries(), 0);
  assert.deepEqual(f.spoken, []);
});

test("does not speak aborted, failed, empty, or tool-only responses", async () => {
  for (const reason of ["aborted", "error", "toolUse"]) {
    const f = fixture();
    f.message("Earlier response.");
    f.message("Incomplete.", reason);
    await f.emit("agent_settled");
    assert.equal(f.spoken.length, 0);
  }
  const f = fixture();
  f.message("");
  await f.emit("agent_settled");
  assert.equal(f.summaries(), 0);
});

test("does not register speech on other platforms", () => {
  assert.equal(fixture({ platform: "linux" }).handlers.size, 0);
});

test("skips queued work and non-idle sessions", async () => {
  for (const state of ["queued", "busy"]) {
    const f = fixture();
    f.message("Done.");
    if (state === "queued") f.setQueued(true);
    else f.setIdle(false);
    await f.emit("agent_settled");
    assert.equal(f.summaries(), 0);
  }
});

test("clears stale responses on a new run or session shutdown", async () => {
  for (const event of ["agent_start", "session_shutdown"]) {
    const f = fixture();
    f.message("Old answer.");
    f.emit(event);
    await f.emit("agent_settled");
    assert.equal(f.spoken.length, 0);
  }
});

test("does not read a long response when its summary fails", async () => {
  const f = fixture({ failSummary: true });
  f.message("Detail ".repeat(201));
  await f.emit("agent_settled");
  assert.deepEqual(f.spoken, []);
  assert.equal(f.warnings.length, 1);
});

test("speech errors do not escape the callback", async () => {
  const f = fixture({ failSpeech: true });
  f.message("Done.");
  await f.emit("agent_settled");
  assert.match(f.warnings[0], /audio unavailable/);
});

test("new work and shutdown cancel summary generation without speech", async () => {
  for (const event of ["agent_start", "session_shutdown"]) {
    const f = fixture();
    let captured: AbortSignal | undefined;
    let finish!: () => void;
    install(f.pi, {
      platform: "darwin",
      summarize: async (_text, _ctx, signal) => {
        captured = signal;
        await new Promise<void>((resolve) => { finish = resolve; });
        return "Done.";
      },
      say: async (text) => { f.spoken.push(text); },
    });
    f.message("Detail ".repeat(201));
    const settled = f.emit("agent_settled");
    f.emit(event);
    assert.equal(captured?.aborted, true);
    finish();
    await settled;
    assert.equal(f.spoken.length, 0);
  }
});

test("removes Markdown, URLs, and code without shortening written text", () => {
  assert.equal(speechText("# **Done** [tests](https://example.com) `passed`."), "Done tests passed.");
  assert.equal(speechText("1. First item.\n2. Second item.\n- Third item."), "First item. Second item. Third item.");
  assert.doesNotMatch(speechText("Result.\n```sh\nrm -rf /\n```"), /rm -rf/);
  assert.equal(speechText("word ".repeat(100)).split(" ").length, 100);
  assert.equal(speechText(""), "");
});

test("model call contains only final answer data, not tools or history", async () => {
  const f = fixture();
  let request: any;
  const ctx = {
    ...f.ctx,
    model: { id: "test-model" },
    modelRegistry: {
      streamSimple: (_model: unknown, context: unknown, options: unknown) => {
        request = { context, options };
        return { result: async () => ({
          stopReason: "stop", content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "**Tests passed.**" }],
        }) };
      },
    },
  } as unknown as ExtensionContext;
  const signal = new AbortController().signal;
  assert.equal(await summarize("Final result.", ctx, signal), "Tests passed.");
  assert.equal(request.context.messages.length, 2);
  assert.equal(request.context.messages[1].content, "Final result.");
  assert.equal(request.options.signal, signal);
  assert.equal(request.context.tools, undefined);
});

test("rejects summary requests without a model", async () => {
  await assert.rejects(summarize("Detail ".repeat(46), fixture().ctx, new AbortController().signal), /No model/);
});

test("rejects empty and failed model summaries", async () => {
  for (const result of [
    { stopReason: "error", errorMessage: "offline", content: [] },
    { stopReason: "stop", content: [] },
  ]) {
    const ctx = {
      model: {},
      modelRegistry: { streamSimple: () => ({ result: async () => result }) },
    } as unknown as ExtensionContext;
    await assert.rejects(summarize("Done.", ctx, new AbortController().signal));
  }
});
