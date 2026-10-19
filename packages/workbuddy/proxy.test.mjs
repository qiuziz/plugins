import { afterAll, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { WorkBuddyAIAuthPlugin, _internal } from "./index.mjs"

const { proxyFor } = _internal

const dir = mkdtempSync(join(tmpdir(), "workbuddy-proxy-"))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function config(name, value) {
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify(value))
  return file
}

test("no config file means no proxy", () => {
  expect(proxyFor({ accountId: "a@example.com" }, join(dir, "missing.json"))).toBeUndefined()
})

test("an account's own proxy is used", () => {
  const file = config("accounts.json", {
    accounts: {
      "a@example.com": "http://127.0.0.1:7890",
      "b@example.com": "direct",
      "c@example.com": "none",
    },
    default: "http://127.0.0.1:7899",
  })
  expect(proxyFor({ accountId: "a@example.com" }, file)).toBe("http://127.0.0.1:7890")
  expect(proxyFor({ accountId: "b@example.com" }, file)).toBeUndefined()
  expect(proxyFor({ accountId: "c@example.com" }, file)).toBeUndefined()
  expect(proxyFor({ accountId: "missing@example.com" }, file)).toBe("http://127.0.0.1:7899")
})

test("a flat map and an object value both work", () => {
  const file = config("flat.json", {
    "a@example.com": { proxy: "http://127.0.0.1:7891" },
    "b@example.com": "http://127.0.0.1:7892",
  })
  expect(proxyFor({ accountId: "a@example.com" }, file)).toBe("http://127.0.0.1:7891")
  expect(proxyFor({ accountId: "b@example.com" }, file)).toBe("http://127.0.0.1:7892")
})

test("the uid is a fallback key", () => {
  const file = config("uid.json", { accounts: { "uid-1": "http://127.0.0.1:7893" } })
  expect(proxyFor({ accountId: "a@example.com", uid: "uid-1" }, file)).toBe("http://127.0.0.1:7893")
})

test("a missing account object means no proxy", () => {
  expect(proxyFor(undefined, join(dir, "missing.json"))).toBeUndefined()
})

test("the chat loader sends the account's proxy", async () => {
  const file = join(homedir(), ".config", "magpie", "workbuddy-proxies.json")
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ accounts: { "a@example.com": "http://127.0.0.1:7890" } }))

  const realFetch = globalThis.fetch
  const seen = []
  globalThis.fetch = async (_url, init) => {
    seen.push(init?.proxy)
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
  }
  try {
    const hooks = await WorkBuddyAIAuthPlugin({ client: {} })
    const loader = await hooks.auth.loader(async () => ({
      type: "oauth",
      access: "access",
      uid: "uid",
      accountId: "a@example.com",
      expires: Date.now() + 3600_000,
    }))
    await loader.fetch("https://www.workbuddy.ai/v2/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model: "deepseek-v4.1-flash",
        messages: [{ role: "user", content: "hi" }],
      }),
    })
    expect(seen).toContain("http://127.0.0.1:7890")
  } finally {
    globalThis.fetch = realFetch
  }
})
