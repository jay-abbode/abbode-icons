import { google } from "googleapis";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Loads service-account credentials in this order:
 *
 *   1. Local development: a file named `google-credentials.json` in the
 *      project root (gitignored — never committed).
 *   2. Production (Vercel): GOOGLE_SERVICE_ACCOUNT_EMAIL and
 *      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY environment variables.
 */
function getCredentials(): { client_email: string; private_key: string } {
  // Option 1: JSON file in project root (local dev)
  const localPath = join(process.cwd(), "google-credentials.json");
  if (existsSync(localPath)) {
    const parsed = JSON.parse(readFileSync(localPath, "utf-8"));
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(
        "google-credentials.json is missing client_email or private_key. " +
          "Make sure you downloaded the service-account JSON from Google Cloud, not some other JSON."
      );
    }
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key,
    };
  }

  // Option 2: environment variables (production)
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
  if (email && privateKey) {
    return {
      client_email: email,
      // Env-var private keys have literal "\n"; convert to real newlines.
      private_key: privateKey.replace(/\\n/g, "\n"),
    };
  }

  throw new Error(
    "No Google credentials found. For local development, save your service-account " +
      "JSON file from Google Cloud as `google-credentials.json` in the project root."
  );
}

function getAuthClient() {
  const creds = getCredentials();
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: [
      // Full read/write — needed so we can append rows to the COMMENTS tab.
      // Drive stays read-only since we only ever read PNG files.
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });
}

export function getSheetsClient() {
  return google.sheets({ version: "v4", auth: getAuthClient() });
}

export function getDriveClient() {
  return google.drive({ version: "v3", auth: getAuthClient() });
}
