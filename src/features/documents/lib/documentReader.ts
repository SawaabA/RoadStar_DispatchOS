import { encodeImage, prepareImage, VISION_PAYLOAD_CHARS } from "./documents";

// Prepares an intake document for extraction without any server-side
// dependencies. A PDF with a text layer is sent as text. A scanned PDF has
// pages but no text, so its first pages are rendered to images instead.
// Photos and rendered pages are sized to the vision model's input budget.

const MIN_TEXT_CHARACTERS = 120;
const MAX_TEXT_PAGES = 3;
const MAX_RENDER_PAGES = 2;
const RENDER_MAX_EDGE_PX = 1600;
const MAX_TEXT_LENGTH = 100_000;
const TOO_DETAILED = "This page is too detailed to read automatically. Photograph just the document, closer up.";

export type ReadDocument =
  | { mode: "text"; text: string; pages: number }
  | { mode: "images"; images: string[]; pages: number };

export class DocumentReadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentReadError";
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("The file could not be read."));
    reader.readAsDataURL(blob);
  });
}

async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import("pdfjs-dist"), import("pdfjs-dist/build/pdf.worker.min.mjs?url")]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function readDocumentForExtraction(file: File): Promise<ReadDocument> {
  if (/^image\/(jpeg|png|webp)$/.test(file.type)) {
    try {
      const image = await prepareImage(file, VISION_PAYLOAD_CHARS);
      return { mode: "images", images: [await blobToDataUrl(image)], pages: 1 };
    } catch (error) {
      throw new DocumentReadError(error instanceof Error ? error.message : "That photo could not be read.");
    }
  }
  if (file.type !== "application/pdf") throw new DocumentReadError("Choose a PDF, JPEG, PNG or WebP file.");

  const pdfjs = await loadPdfjs();
  // In pdfjs-dist 6 the loading task owns the worker-side document, so cleanup
  // goes through the task rather than the document proxy.
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") throw new DocumentReadError("This PDF is password protected. Export an unlocked copy or photograph the page.");
    throw new DocumentReadError("This file is not a readable PDF.");
  }

  try {
    if (!pdf.numPages) throw new DocumentReadError("This PDF has no pages.");

    let text = "";
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_TEXT_PAGES); pageNumber += 1) {
      const content = await (await pdf.getPage(pageNumber)).getTextContent();
      for (const item of content.items) {
        if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
      }
      text += "\n";
    }
    if (text.replace(/\s+/g, "").length >= MIN_TEXT_CHARACTERS) {
      return { mode: "text", text: text.trim().slice(0, MAX_TEXT_LENGTH), pages: pdf.numPages };
    }

    const canvases: HTMLCanvasElement[] = [];
    for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, MAX_RENDER_PAGES); pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const natural = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, RENDER_MAX_EDGE_PX / Math.max(natural.width, natural.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new DocumentReadError("This browser cannot render PDF pages.");
      await page.render({ canvasContext: context, canvas, viewport }).promise;
      canvases.push(canvas);
    }

    // Pages share one budget. When two pages cannot both fit legibly, the first
    // page alone gets all of it: rate confirmations lead with the load details.
    if (canvases.length > 1) {
      try {
        const images: string[] = [];
        for (const canvas of canvases) images.push(await blobToDataUrl(await encodeImage(canvas, Math.floor(VISION_PAYLOAD_CHARS / canvases.length))));
        return { mode: "images", images, pages: pdf.numPages };
      } catch {
        // Fall through to the first page alone.
      }
    }
    try {
      return { mode: "images", images: [await blobToDataUrl(await encodeImage(canvases[0]!, VISION_PAYLOAD_CHARS))], pages: pdf.numPages };
    } catch {
      throw new DocumentReadError(TOO_DETAILED);
    }
  } finally {
    await loadingTask.destroy();
  }
}
