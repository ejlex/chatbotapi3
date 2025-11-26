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

  if (session.completed) {
    // Start a fresh session if the user messages again after completion.
    sessions[userId] = {
      data: {},
      currentStep: "name",
      completed: false,
    };
    session = sessions[userId];
  } else {
    sessions[userId] = session;
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
    await saveRegistration(finalData, userId);

    return res.json({
      reply: "Registration complete!",
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
  const { error } = await supabase.from("registrations").insert({
    user_id: userId,
    ...data,
  });

  if (error) {
    console.error("Failed to save registration:", error);
    throw new Error("Failed to save registration");
  }
}

export default router;
