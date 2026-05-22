import { signIn, auth } from "@/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: {
    from?: string;
    error?: string;
    email?: string;
  };
}

export default async function LoginPage({ searchParams }: PageProps) {
  const session = await auth();
  if (session) {
    redirect(searchParams.from || "/");
  }

  const error = searchParams.error;
  const email = searchParams.email;

  return (
    <main className="flex min-h-screen items-center justify-center bg-paper px-6">
      <div className="w-full max-w-md text-center">
        <div className="mb-12 flex flex-col items-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.svg"
            alt="Abbode"
            className="h-12 w-auto md:h-14"
          />
          <span className="font-paris mt-1 text-2xl italic text-berry md:text-3xl">
            Icons
          </span>
        </div>

        <h1 className="font-display text-3xl font-medium tracking-tight text-espresso md:text-4xl">
          Sign in to continue
        </h1>
        <p className="font-ui mt-3 text-sm leading-relaxed text-ink-soft">
          Use your Abbode Google account, or the Google account associated with
          your partner email.
        </p>

        {error === "AccessDenied" && (
          <div className="font-ui mt-6 rounded-lg border border-tomato/30 bg-pink-soft px-4 py-3 text-left text-sm text-cherry">
            <p className="font-semibold">Access denied</p>
            <p className="mt-1">
              {email ? (
                <>
                  <span className="font-medium">{email}</span> isn&apos;t on the
                  approved list.
                </>
              ) : (
                "Your account isn't on the approved list."
              )}{" "}
              Ask the Abbode team to add you to the access sheet, then try
              again.
            </p>
          </div>
        )}

        <form
          action={async () => {
            "use server";
            await signIn("google", {
              redirectTo: searchParams.from || "/",
            });
          }}
          className="mt-8"
        >
          <button
            type="submit"
            className="font-ui group inline-flex w-full items-center justify-center gap-3 rounded-full bg-espresso px-6 py-3.5 text-sm font-semibold text-porcelain shadow-sm transition-all hover:bg-berry hover:shadow-md focus-ring"
          >
            <GoogleLogo />
            Continue with Google
          </button>
        </form>

        <p className="font-ui mt-10 text-xs text-ink-muted">
          By signing in you agree that file downloads are tracked. Distribute
          only to authorized recipients.
        </p>
      </div>
    </main>
  );
}

function GoogleLogo() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path fill="#FFFCF7" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z" />
      <path fill="#FFFCF7" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z" />
      <path fill="#FFFCF7" d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.997 8.997 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332Z" />
      <path fill="#FFFCF7" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.167 6.656 3.58 9 3.58Z" />
    </svg>
  );
}
