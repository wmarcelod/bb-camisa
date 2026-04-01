import { listCollectionSessions } from "@/lib/server/repository";

export const dynamic = "force-dynamic";

type CollectionPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function CollectionPage({ searchParams }: CollectionPageProps) {
  const params = await searchParams;
  const token = params.token;
  const authorized =
    Boolean(process.env.ADMIN_ACCESS_TOKEN) && token === process.env.ADMIN_ACCESS_TOKEN;

  if (!authorized) {
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

  const sessions = await listCollectionSessions();

  return (
    <main className="page-shell">
      <section className="panel collection-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Coleta</p>
            <h2>Sessoes salvas</h2>
          </div>
          <a
            className="primary-button collection-link"
            href={`/api/admin/export?token=${token}`}
          >
            Baixar tudo
          </a>
        </div>

        <div className="collection-list">
          {sessions.length ? (
            sessions.map((session) => (
              <article className="collection-row" key={session.id}>
                <div className="collection-meta">
                  <strong>{session.id}</strong>
                  <span>Criada em {new Date(session.created_at).toLocaleString("pt-BR")}</span>
                  <span>Atualizada em {new Date(session.updated_at).toLocaleString("pt-BR")}</span>
                </div>
                <div className="collection-stats">
                  <span>Uploads: {session.upload_count}</span>
                  <span>Resultados: {session.result_count}</span>
                  <span>Selecionadas: {session.kept_count}</span>
                </div>
                <a
                  className="ghost-button collection-link"
                  href={`/api/admin/export?token=${token}&sessionId=${session.id}`}
                >
                  Baixar sessao
                </a>
              </article>
            ))
          ) : (
            <p className="collection-empty">Nenhuma sessao encontrada.</p>
          )}
        </div>
      </section>
    </main>
  );
}
