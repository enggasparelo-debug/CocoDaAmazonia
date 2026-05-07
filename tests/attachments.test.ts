import { describe, expect, it, vi } from "vitest";
import { uploadAttachment } from "../lib/attachments";
import type { SupabaseClient } from "@supabase/supabase-js";

function fakeSupabase(args: {
  uploadError?: { message: string } | null;
  publicUrl?: string;
}): { client: SupabaseClient; capturedPath: { current: string } } {
  const captured = { current: "" };
  const upload = vi.fn(async (path: string) => {
    captured.current = path;
    return { error: args.uploadError ?? null };
  });
  const getPublicUrl = vi.fn((_path: string) => ({
    data: { publicUrl: args.publicUrl ?? "https://x/y" },
  }));
  const from = vi.fn(() => ({ upload, getPublicUrl }));
  const client = {
    storage: { from },
  } as unknown as SupabaseClient;
  return { client, capturedPath: captured };
}

function fakeFile(name: string, type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("uploadAttachment", () => {
  it("monta path tenant/table/row/timestamp_filename", async () => {
    const { client, capturedPath } = fakeSupabase({ publicUrl: "https://ok" });
    const file = fakeFile("comprovante.png");
    const out = await uploadAttachment(client, {
      tenantId: "t1",
      table: "sale_payments",
      rowId: "r1",
      file,
    });
    expect(out.url).toBe("https://ok");
    expect(out.error).toBeNull();
    expect(capturedPath.current).toMatch(
      /^t1\/sale_payments\/r1\/\d+_comprovante\.png$/
    );
  });

  it("sanitiza caracteres não-alfanuméricos no nome do arquivo", async () => {
    const { client, capturedPath } = fakeSupabase({});
    const file = fakeFile("foto com espaço & acento ção.jpg");
    await uploadAttachment(client, {
      tenantId: "t1",
      table: "x",
      rowId: "y",
      file,
    });
    // Espaços, & e acentos viram _ (cada char não-ASCII ou especial)
    expect(capturedPath.current).toMatch(/foto_com_espa_o___acento___o\.jpg$/);
  });

  it("retorna erro quando upload falha", async () => {
    const { client } = fakeSupabase({
      uploadError: { message: "bucket cheio" },
    });
    const out = await uploadAttachment(client, {
      tenantId: "t",
      table: "x",
      rowId: "y",
      file: fakeFile("a.png"),
    });
    expect(out.url).toBeNull();
    expect(out.error).toBe("bucket cheio");
  });

  it("usa diferentes timestamps em uploads consecutivos (path único)", async () => {
    const { client, capturedPath } = fakeSupabase({});
    await uploadAttachment(client, {
      tenantId: "t",
      table: "x",
      rowId: "y",
      file: fakeFile("a.png"),
    });
    const first = capturedPath.current;
    // Espera 5ms pra timestamp diferente
    await new Promise((r) => setTimeout(r, 5));
    await uploadAttachment(client, {
      tenantId: "t",
      table: "x",
      rowId: "y",
      file: fakeFile("a.png"),
    });
    expect(capturedPath.current).not.toBe(first);
  });
});
