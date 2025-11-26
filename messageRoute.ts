import { Request, Response, Router } from "express";
import { createChatCompletion } from "./openaiClient";
import { supabase } from "./supabaseClient";

interface RegistrationData {
  name: string;
  dateOfBirth: string;
  gender: "male" | "female" | "other";
  usesBudgetApp: boolean;
  budgetAppName?: string;
}

type RegistrationStep =
  | "name"
  | "dateOfBirth"
  | "gender"
  | "usesBudgetApp"
  | "budgetAppName";

interface SessionState {
  data: Partial<RegistrationData>;
  currentStep: RegistrationStep;
  completed: boolean;
}

const sessions: Record<string, SessionState> = {};
const steps: RegistrationStep[] = [
  "name",
  "dateOfBirth",
  "gender",
  "usesBudgetApp",
  "budgetAppName",
];
const dobRegex = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const router = Router();
router.get("/", (_req: Request, res: Response) => {
  res.send("Chatbot API is running.");
});

router.post("/message", async (req: Request, res: Response) => {
  const { userId, message } = req.body ?? {};

  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  let session: SessionState =
    sessions[userId] ??
    {
      data: {},
      currentStep: "name" as RegistrationStep,
      completed: false,
    };

  sessions[userId] = session;

  if (session.completed) {
    const reply = await buildWelcomeMessage(session.data);
    return res.json({
      reply,
      done: true,
      data: session.data,
    });
  }

  const text =
    message === undefined || message === null ? "" : String(message);

  if (!text.trim()) {
    session.currentStep = "name";
    return res.json({
      reply: "What is your name?",
      done: false,
    });
  }

  collectFields(session, text);

  const nextField = findNextField(session.data);

  if (!nextField) {
    const finalData: RegistrationData = {
      name: session.data.name as string,
      dateOfBirth: session.data.dateOfBirth as string,
      gender: session.data.gender as RegistrationData["gender"],
      usesBudgetApp: session.data.usesBudgetApp as boolean,
      budgetAppName: session.data.budgetAppName,
    };

    session.completed = true;
    session.data = finalData;
    await saveRegistration(finalData, userId);
    const reply = await buildWelcomeMessage(finalData);

    return res.json({
      reply,
      done: true,
      data: finalData,
    });
  }

  session.currentStep = nextField;
  const reply = promptFor(nextField, session.data);

  return res.json({
    reply,
    done: false,
  });
});

router.post("/llm-echo", async (req: Request, res: Response) => {
  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== "string") {
    return res.status(400).json({ error: "prompt is required" });
  }

  try {
    const response = await createChatCompletion(prompt);
    return res.json({ reply: response });
  } catch (error) {
    console.error("OpenAI request failed", error);
    return res
      .status(503)
      .json({ error: "OpenAI request failed; please try again later." });
  }
});

function collectFields(session: SessionState, message: string): void {
  const lower = message.toLowerCase();
  const updates: Partial<RegistrationData> = {};

  if (!session.data.name) {
    const nameMatch = message.match(
      /\b(?:name is|i am|i'm)\s+([A-Za-z][\w\s'-]{1,60})/i
    );
    if (nameMatch) {
      updates.name = nameMatch[1].trim();
    } else if (session.currentStep === "name") {
      updates.name = message.trim();
    }
  }

  if (!session.data.dateOfBirth) {
    const dobMatch = message.match(/\b\d{4}-\d{2}-\d{2}\b/);
    if (dobMatch && dobRegex.test(dobMatch[0])) {
      updates.dateOfBirth = dobMatch[0];
    }
  }

  if (!session.data.gender) {
    if (lower.includes("male")) updates.gender = "male";
    else if (lower.includes("female")) updates.gender = "female";
    else if (lower.includes("other")) updates.gender = "other";
  }

  if (session.data.usesBudgetApp === undefined) {
    if (/\b(yes|yep|yeah|sure|true)\b/i.test(lower)) {
      updates.usesBudgetApp = true;
    } else if (/\b(no|nope|nah|false)\b/i.test(lower)) {
      updates.usesBudgetApp = false;
      updates.budgetAppName = undefined;
    }
  }

  if (
    (session.data.usesBudgetApp || updates.usesBudgetApp) &&
    !session.data.budgetAppName
  ) {
    const appNameMatch = message.match(
      /\b(?:app|application|called|using)\s+([A-Za-z][\w\s'-]{1,60})/i
    );
    if (appNameMatch) {
      updates.budgetAppName = appNameMatch[1].trim();
    } else if (
      (session.data.usesBudgetApp || updates.usesBudgetApp) &&
      session.currentStep === "budgetAppName"
    ) {
      updates.budgetAppName = message.trim();
    }
  }

  session.data = { ...session.data, ...updates };
}

function findNextField(
  data: Partial<RegistrationData>
): RegistrationStep | null {
  for (const step of steps) {
    if (step === "budgetAppName" && data.usesBudgetApp === false) {
      continue;
    }
    if (data[step] === undefined || data[step] === "") {
      return step;
    }
  }
  return null;
}

function promptFor(
  step: RegistrationStep,
  data: Partial<RegistrationData>
): string {
  switch (step) {
    case "name":
      return "What is your name?";
    case "dateOfBirth":
      return "What is your date of birth? (YYYY-MM-DD)";
    case "gender":
      return 'What is your gender? Please reply "male", "female", or "other".';
    case "usesBudgetApp":
      return "Do you use a budget app? (yes/no)";
    case "budgetAppName":
      return data.usesBudgetApp
        ? "What is the name of the budget app you use?"
        : "What is the name of your budget app?";
    default:
      return "Thanks for the details!";
  }
}

async function saveRegistration(
  data: RegistrationData,
  userId: string
): Promise<void> {
  const payload = {
    user_id: userId,
    name: data.name,
    date_of_birth: data.dateOfBirth,
    gender: data.gender,
    uses_budget_app: data.usesBudgetApp,
    budget_app_name: data.usesBudgetApp ? data.budgetAppName ?? null : null,
    completed: true,
  };

  const { error } = await supabase.from("registrations").insert(payload);

  if (error) {
    console.error("Failed to save registration:", error);
    throw new Error("Failed to save registration");
  }
}

async function buildWelcomeMessage(
  data: Partial<RegistrationData>
): Promise<string> {
  const name = data.name ?? "friend";
  const dob = data.dateOfBirth ? `, born ${data.dateOfBirth}` : "";
  const gender = data.gender ? `, gender: ${data.gender}` : "";
  const budgetApp =
    data.usesBudgetApp === undefined
      ? ""
      : data.usesBudgetApp
        ? `, budget app: ${data.budgetAppName ?? "unspecified"}`
        : ", no budget app";

  const fallback = `Registration complete for ${name}${dob}${gender}${budgetApp}. Welcome!`;

  const prompt = `Create a warm, concise welcome message for a user who completed registration.
Include their name and any provided details. Keep it under 40 words and avoid bullet points.
Details:
- Name: ${name}
- Date of birth: ${data.dateOfBirth ?? "not provided"}
- Gender: ${data.gender ?? "not provided"}
- Uses budget app: ${
    data.usesBudgetApp === undefined ? "not provided" : data.usesBudgetApp
  }
- Budget app name: ${data.budgetAppName ?? "not provided"}`;

  try {
    return await createChatCompletion(prompt);
  } catch (error) {
    console.error("Failed to generate welcome message:", error);
    return fallback;
  }
}

export default router;
