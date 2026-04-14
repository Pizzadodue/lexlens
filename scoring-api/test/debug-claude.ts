import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(
  join(__dirname, "../prompts/scoring-system.txt"),
  "utf-8"
);

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const text = [
  "To provide quality health care for all Americans. This Act shall establish a public",
  "option for health insurance coverage available to all citizens regardless of employment status.",
  "Coverage shall include preventive care, mental health services, prescription drugs.",
  "Funding shall be provided through a surtax on incomes exceeding $400,000 per annum.",
].join(" ");

console.log("Calling Claude...\n");
const resp = await client.messages.create({
  model: "claude-haiku-4-5-20251001",
  max_tokens: 512,
  system: [
    {
      type: "text",
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" },
    },
  ],
  messages: [
    {
      role: "user",
      content: `Language: en\nJurisdiction: US\n\n${text}`,
    },
  ],
});

console.log("Stop reason:", resp.stop_reason);
console.log("Content type:", resp.content[0]?.type);
if (resp.content[0]?.type === "text") {
  console.log("Raw response:\n", resp.content[0].text);
  try {
    const parsed = JSON.parse(resp.content[0].text);
    console.log("\nParsed JSON:", JSON.stringify(parsed, null, 2));
  } catch (e) {
    console.log("\nFailed to parse as JSON:", e);
  }
}
console.log("\nUsage:", JSON.stringify(resp.usage));
