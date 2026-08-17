import { createFileRoute, useRouter } from "@tanstack/react-router";
import { ChevronLeft, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useT } from "@/lib/i18n";

export const Route = createFileRoute("/legal/$slug")({
  head: () => ({
    meta: [
      { title: "Legal — badiyos Partner" },
      { name: "description", content: "Privacy Policy and Terms & Conditions for badiyos Partner." },
    ],
  }),
  component: LegalScreen,
});

type LegalPage = {
  slug: string;
  title: string;
  content: string;
  effective_date: string | null;
  last_updated_at: string;
};

function LegalScreen() {
  const t = useT();
  const { slug } = Route.useParams();
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ["legal-page", slug],
    queryFn: async (): Promise<LegalPage | null> => {
      const { data, error } = await supabase
        .from("legal_pages")
        .select("slug,title,content,effective_date,last_updated_at")
        .eq("slug", slug)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data as LegalPage | null;
    },
  });

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col bg-background pb-[max(env(safe-area-inset-bottom),2rem)]">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-background px-6 pb-4 pt-[calc(var(--safe-top)+1.5rem)]">
        <button
          type="button"
          onClick={() => router.history.back()}
          aria-label={t("common.back")}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-foreground hover:bg-muted"
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
        <h1 className="text-[20px] font-bold text-foreground">{data?.title ?? t("legal.title")}</h1>
      </header>

      <div className="flex-1 px-6 py-5">
        {isLoading && (
          <div className="flex justify-center pt-16">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        )}
        {!isLoading && (error || !data) && (
          <p className="pt-12 text-center text-[14px] text-[color:var(--text-secondary)]">
            {t("legal.error")}
          </p>
        )}
        {data && (
          <article className="select-text">
            {(data.effective_date || data.last_updated_at) && (
              <p className="mb-4 text-[12px] text-[color:var(--text-secondary)]">
                {t("legal.updated")}{" "}
                {new Date(data.effective_date ?? data.last_updated_at).toLocaleDateString()}
              </p>
            )}
            <Markdown text={data.content} />
          </article>
        )}
      </div>
    </div>
  );
}

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  return parts.map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(p)) return <em key={i}>{p.slice(1, -1)}</em>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(p);
    if (link) {
      return (
        <a key={i} href={link[2]} target="_blank" rel="noreferrer" className="font-semibold text-primary underline">
          {link[1]}
        </a>
      );
    }
    return <span key={i}>{p}</span>;
  });
}

function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let list: string[] = [];

  const flush = () => {
    if (!list.length) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="mb-4 list-disc space-y-1.5 pl-5 text-[15px] leading-relaxed text-foreground">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>,
    );
    list = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) {
      flush();
      return;
    }
    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) {
      list.push(bullet[1]);
      return;
    }
    flush();
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const size = level <= 1 ? "text-[20px]" : level === 2 ? "text-[17px]" : "text-[15px]";
      blocks.push(
        <h2 key={idx} className={`mt-5 mb-2 font-bold text-foreground ${size}`}>
          {inline(h[2])}
        </h2>,
      );
      return;
    }
    blocks.push(
      <p key={idx} className="mb-3 text-[15px] leading-relaxed text-foreground">
        {inline(line)}
      </p>,
    );
  });
  flush();

  return <>{blocks}</>;
}
