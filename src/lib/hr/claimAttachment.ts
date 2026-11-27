/** Streams a claim's bill with safe headers (same rules as Storage downloads). */
export function attachmentResponse(file: { data: Buffer; mimeType: string; fileName: string }, download: boolean): Response {
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
