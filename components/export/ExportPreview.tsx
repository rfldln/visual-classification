"use client";

export function ExportPreview({ csv, title }: { csv: string | undefined; title: string }) {
  if (!csv) return null;
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const header = lines[0]?.split(",") ?? [];
  const rows = lines.slice(1, 21).map((l) => splitCsvLine(l));

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-4 py-2 text-sm font-semibold">{title}</div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-zinc-900 text-zinc-400">
            <tr>
              {header.map((h, i) => (
                <th key={i} className="px-2 py-1.5 text-left font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-zinc-900">
                {r.map((c, j) => (
                  <td key={j} className="px-2 py-1 text-zinc-300">{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function splitCsvLine(line: string): string[] {
  // Tiny CSV parser good enough for preview of our own well-formed CSV
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
