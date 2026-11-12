// RAW sends a client's own request through: the account's sign-in in the
// three headers that bind it, and everything else — User-Agent, X-IDE-*,
// X-Agent-*, the body — as the client made it. This is the domestic
// WorkBuddy build, whose chats go to copilot.tencent.com. The switch is
// off by default, so an ordinary route keeps WorkBuddy's own client
// headers.
import { afterEach, expect, test } from "bun:test"
import { WorkBuddyAuthPlugin } from "./index.mjs"

const realFetch = globalThis.fetch
afterEach(() => (globalThis.fetch = realFetch))

const account = { type: "oauth", access: "access", uid: "uid", expires: Date.now() + 3600_000 }
const ENDPOINT = "https://copilot.tencent.com/v2/chat/completions"
const UA = "CLI/2.180.0 CodeBuddy/2.180.0"

test("raw sends the client's headers and body, the account the only change", async () => {
  let seen
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: new Headers(init.headers), body: init.body }
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  }
  const hooks = await WorkBuddyAuthPlugin({ client: {}, magpie: { option: (_id, key) => key === "raw" } })
  const loader = await hooks.auth.loader(async () => account)
  const body = JSON.stringify({
    model: "deepseek-v4.1-flash",
    stream: true,
    max_completion_tokens: 128000,
    messages: [
      { role: "developer", content: "You are helpful." },
      { role: "user", content: "Reply with exactly OK." },
    ],
  })
  const res = await loader.fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "user-agent": UA,
      "x-ide-type": "CodeBuddy",
      "x-ide-name": "CodeBuddy",
      "x-agent-purpose": "conversation",
      "x-agent-intent": "craft",
      authorization: "Bearer client",
      "content-length": "999",
      "x-custom": "kept",
    },
    body,
  })

  expect(res.status).toBe(200)
  expect(seen.url).toBe(ENDPOINT)
  // the account's three
  expect(seen.headers.get("authorization")).toBe("Bearer access")
  expect(seen.headers.get("x-user-id")).toBe("uid")
  expect(seen.headers.get("x-domain")).toBe("copilot.tencent.com")
  // the client's own, untouched
  expect(seen.headers.get("user-agent")).toBe(UA)
  expect(seen.headers.get("x-ide-type")).toBe("CodeBuddy")
  expect(seen.headers.get("x-ide-name")).toBe("CodeBuddy")
  expect(seen.headers.get("x-agent-purpose")).toBe("conversation")
  expect(seen.headers.get("x-agent-intent")).toBe("craft")
  expect(seen.headers.get("x-custom")).toBe("kept")
  // transport's own: fetch recomputes the length, and no gzip is added
  expect(seen.headers.get("content-length")).toBeNull()
  expect(seen.headers.get("content-encoding")).toBeNull()
  // the bytes as the client wrote them, not the chat rewrites
  expect(seen.body).toBe(body)
})

test("without raw the plugin still sends as WorkBuddy's client", async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init.headers), body: init.body })
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  }
  const hooks = await WorkBuddyAuthPlugin({ client: {} })
  const loader = await hooks.auth.loader(async () => account)
  await loader.fetch(ENDPOINT, {
    method: "POST",
    headers: { "user-agent": UA },
    body: JSON.stringify({ model: "deepseek-v4.1-flash", messages: [{ role: "user", content: "OK" }] }),
  })

  const sent = calls.find((c) => c.url.endsWith("/v2/chat/completions"))
  expect(sent.headers.get("user-agent")).toBe("WorkBuddy/5.9.3 WorkBuddy/5.9.3 CLI/2.165.0")
})

test("magpie's raw header sends as raw without the option", async () => {
  let seen
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), headers: new Headers(init.headers), body: init.body }
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  }
  const hooks = await WorkBuddyAuthPlugin({ client: {} })
  const loader = await hooks.auth.loader(async () => account)
  const body = JSON.stringify({ model: "deepseek-v4.1-flash", messages: [{ role: "user", content: "OK" }] })
  await loader.fetch(ENDPOINT, {
    method: "POST",
    headers: { "user-agent": UA, "x-magpie-raw": "1" },
    body,
  })

  expect(seen.headers.get("user-agent")).toBe(UA)
  expect(seen.headers.get("x-magpie-raw")).toBeNull()
  expect(seen.body).toBe(body)
})
