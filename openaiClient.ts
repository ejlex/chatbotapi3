import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;

if (!apiKey) {
  throw new Error("OPENAI_API_KEY is required to call the OpenAI API.");
}

export const openai = new OpenAI({ apiKey });

export async function createChatCompletion(prompt: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 120,
    temperature: 0.2,
  });

  const message =
    response.choices[0]?.message?.content?.trim() ??
    "";

  if (!message) {
    throw new Error("Empty response from OpenAI.");
  }

  return message;
}
