import { CollectionDashboard } from "@/components/collection-dashboard";
import { isAdminToken } from "@/lib/server/admin";

export const dynamic = "force-dynamic";

type CollectionPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function CollectionPage({ searchParams }: CollectionPageProps) {
  const params = await searchParams;
  const token = params.token;

  if (!isAdminToken(token)) {
    return (
      <main className="page-shell">
        <section className="panel collection-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Coleta</p>
              <h2>Acesso restrito</h2>
            </div>
          </div>
          <p className="collection-empty">
            Abra esta pagina com <code>?token=...</code>.
          </p>
        </section>
      </main>
    );
  }

  return <CollectionDashboard token={token ?? ""} />;
}
