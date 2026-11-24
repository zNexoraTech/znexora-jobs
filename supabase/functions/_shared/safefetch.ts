// Fetch a public HTTPS URL safely: no private/internal addresses (SSRF), limited redirects,
// timeout and size limit. Used for employer-supplied feed URLs.

const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 15000;

function isPrivateIPv4(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = p;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) || a >= 224;
}

function isPrivateIPv6(ip: string): boolean {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe8") || s.startsWith("fe9") || s.startsWith("fea") || s.startsWith("feb") || s.startsWith("ff")) return true;
  const v4 = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) return isPrivateIPv4(v4[1]);
  return false;
}

export async function assertPublicHost(url: URL): Promise<void> {
  if (url.protocol !== "https:") throw new Error("only https URLs are allowed");
  if (url.username || url.password) throw new Error("credentials in URL are not allowed");
  if (url.port && url.port !== "443") throw new Error("only port 443 is allowed");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    throw new Error("internal host names are not allowed");
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) { if (isPrivateIPv4(host)) throw new Error("private address"); return; }
  if (host.includes(":")) { if (isPrivateIPv6(host)) throw new Error("private address"); return; }
  // Resolve and check every address (blocks DNS names pointing at internal ranges)
  const v4 = await Deno.resolveDns(host, "A").catch(() => [] as string[]);
  const v6 = await Deno.resolveDns(host, "AAAA").catch(() => [] as string[]);
  if (!v4.length && !v6.length) throw new Error("host does not resolve");
  if (v4.some(isPrivateIPv4) || v6.some(isPrivateIPv6)) throw new Error("host resolves to a private address");
}

export async function safeFetchText(input: string, maxRedirects = 3): Promise<string> {
  let url = new URL(input);
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicHost(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: "manual",
        signal: ctrl.signal,
        headers: { "User-Agent": "ZNexoraJobsFeedBot/1.0 (+job feed import with employer permission)", "Accept": "text/html,application/xml,text/xml;q=0.9,*/*;q=0.5" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`redirect without location (${res.status})`);
        url = new URL(loc, url);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) return "";
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) { await reader.cancel(); throw new Error("feed is larger than 3 MB"); }
        chunks.push(value);
      }
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { buf.set(c, off); off += c.byteLength; }
      return new TextDecoder("utf-8", { fatal: false }).decode(buf);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("too many redirects");
}
