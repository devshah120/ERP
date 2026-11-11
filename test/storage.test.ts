import { describe, it, expect } from "vitest";
import { detectFileType, safeFileName } from "@/lib/storage/service";

describe("storage file checks", () => {
  it("identifies files by their contents, not their name", () => {
    expect(detectFileType(Buffer.from("%PDF-1.7\n...")))?.toEqual({ mime: "application/pdf", ext: "pdf" });
    expect(detectFileType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])))?.toEqual({ mime: "image/png", ext: "png" });
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])))?.toEqual({ mime: "image/jpeg", ext: "jpg" });
  });

  it("rejects anything else, whatever it is called", () => {
    expect(detectFileType(Buffer.from("hello, I am not an image"))).toBeNull();
    expect(detectFileType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(detectFileType(Buffer.from("MZ\x90\x00"))).toBeNull(); // Windows executable
    expect(detectFileType(Buffer.alloc(0))).toBeNull();
  });

  it("makes download names safe for headers and file systems", () => {
    expect(safeFileName("Rent agreement 2026.pdf")).toBe("Rent agreement 2026.pdf");
    expect(safeFileName('..\\..\\etc/passwd"<x>.pdf')).toBe(".._.._etc_passwd_x_.pdf");
    expect(safeFileName("   ")).toBe("document");
    expect(safeFileName("a".repeat(400)).length).toBe(150);
  });
});
