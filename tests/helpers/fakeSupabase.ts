/**
 * Minimal in-memory fake of the supabase-js query builder, covering only
 * the operations this codebase's stores actually use (select/insert/upsert/
 * delete/eq/in/order/range/limit/maybeSingle). Not a general-purpose
 * PostgREST mock - just enough to unit-test the store modules without a
 * real database, mirroring the same "mock the boundary, verify our own
 * logic" approach used for the Stripe SDK elsewhere in this test suite.
 */
type Row = Record<string, unknown>;

const PRIMARY_KEY: Record<string, string> = {
  billing_accounts: "id",
  execution_ledger: "id",
  payout_accounts: "executor_id",
  stripe_events: "event_id",
  tasks: "id",
  benchmark_runs: "id",
  provider_performance: "key",
  execution_quotes: "id",
  provider_overrides: "provider_id",
};

export function createFakeSupabase() {
  const tables = new Map<string, Row[]>();

  function getRows(name: string): Row[] {
    if (!tables.has(name)) tables.set(name, []);
    return tables.get(name)!;
  }

  function from(tableName: string) {
    const pk = PRIMARY_KEY[tableName];
    const filters: Array<(row: Row) => boolean> = [];
    let orderCol: string | null = null;
    let orderAsc = true;
    let rangeFrom: number | null = null;
    let rangeTo: number | null = null;
    let limitN: number | null = null;
    let mode: "select" | "insert" | "upsert" | "delete" = "select";
    let pendingRows: Row[] = [];

    function applyReadOps(rows: Row[]): Row[] {
      let result = rows.filter((r) => filters.every((f) => f(r)));
      if (orderCol) {
        const col = orderCol;
        result = [...result].sort((a, b) => {
          const av = a[col] as string | number;
          const bv = b[col] as string | number;
          const cmp = av < bv ? -1 : av > bv ? 1 : 0;
          return orderAsc ? cmp : -cmp;
        });
      }
      if (rangeFrom != null && rangeTo != null) result = result.slice(rangeFrom, rangeTo + 1);
      if (limitN != null) result = result.slice(0, limitN);
      return result;
    }

    async function execute(): Promise<{ data: Row[] | null; error: null }> {
      const rows = getRows(tableName);
      if (mode === "select") {
        return { data: applyReadOps(rows), error: null };
      }
      if (mode === "insert") {
        rows.push(...pendingRows);
        return { data: pendingRows, error: null };
      }
      if (mode === "upsert") {
        for (const incoming of pendingRows) {
          const idx = rows.findIndex((r) => r[pk] === incoming[pk]);
          if (idx >= 0) rows[idx] = { ...rows[idx], ...incoming };
          else rows.push(incoming);
        }
        return { data: pendingRows, error: null };
      }
      if (mode === "delete") {
        const toDelete = applyReadOps(rows);
        for (const row of toDelete) {
          const idx = rows.indexOf(row);
          if (idx >= 0) rows.splice(idx, 1);
        }
        return { data: toDelete, error: null };
      }
      return { data: [], error: null };
    }

    const builder = {
      select() {
        mode = "select";
        return builder;
      },
      insert(rowsIn: Row | Row[]) {
        pendingRows = Array.isArray(rowsIn) ? rowsIn : [rowsIn];
        mode = "insert";
        return builder;
      },
      upsert(rowsIn: Row | Row[]) {
        pendingRows = Array.isArray(rowsIn) ? rowsIn : [rowsIn];
        mode = "upsert";
        return builder;
      },
      delete() {
        mode = "delete";
        return builder;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => r[col] === val);
        return builder;
      },
      gte(col: string, val: string) {
        filters.push((r) => (r[col] as string) >= val);
        return builder;
      },
      lte(col: string, val: string) {
        filters.push((r) => (r[col] as string) <= val);
        return builder;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes(r[col]));
        return builder;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orderCol = col;
        orderAsc = opts?.ascending ?? true;
        return builder;
      },
      range(from2: number, to: number) {
        rangeFrom = from2;
        rangeTo = to;
        return builder;
      },
      limit(n: number) {
        limitN = n;
        return builder;
      },
      async maybeSingle() {
        const res = await execute();
        return { data: res.data?.[0] ?? null, error: null };
      },
      then(resolve: (value: { data: Row[] | null; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
        return execute().then(resolve, reject);
      },
    };

    return builder;
  }

  return { from, tables };
}

export type FakeSupabase = ReturnType<typeof createFakeSupabase>;
