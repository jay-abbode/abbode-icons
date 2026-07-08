import Header from "@/components/Header";
import ContactSheetGenerator from "@/components/ContactSheetGenerator";
import VisualIndexPanel from "@/components/VisualIndexPanel";

export const dynamic = "force-dynamic";

export default function ContactSheetPage({
  searchParams,
}: {
  searchParams: { load?: string };
}) {
  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-6xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="mb-8">
          <p className="font-ui mb-2 text-xs uppercase tracking-[0.25em] text-berry">
            Contact sheets
          </p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-espresso md:text-5xl">
            Generate a contact sheet
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
            Type a theme and a number of icons — Claude picks the ones that fit
            and lays them out on a clean sheet. Tweak the selection, then export
            as PNG, PDF, or HTML.
          </p>
        </div>

        <ContactSheetGenerator loadId={searchParams.load} />
        <VisualIndexPanel />
      </main>
    </>
  );
}
