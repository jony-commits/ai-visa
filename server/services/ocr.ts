import { AI_MODEL_DOCUMENT, getGeminiClient, hasLiveGeminiKey } from './aiProvider.ts';

export interface OcrResult {
  provider: string;
  rawText: string;
  pageCountEstimate: number;
}

export async function runDocumentOcr(params: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
  allowExternalAi: boolean;
}): Promise<OcrResult> {
  // 1. Live multimodal OCR using Gemini when external AI consent + key are available
  if (
    params.allowExternalAi &&
    hasLiveGeminiKey() &&
    ['image/jpeg', 'image/png', 'application/pdf'].includes(params.mimeType)
  ) {
    try {
      const ai = getGeminiClient();
      const response = await ai.models.generateContent({
        model: AI_MODEL_DOCUMENT,
        contents: {
          parts: [
            {
              inlineData: {
                mimeType: params.mimeType,
                data: params.buffer.toString('base64'),
              },
            },
            {
              text: 'Transcribe all visible text, labels, dates, numbers, and table entries from this document verbatim. Do not interpret or fabricate illegible text; mark illegible regions as [ILLEGIBLE].',
            },
          ],
        },
      });
      const text = (response.text || '').trim();
      if (text.length > 0) {
        return {
          provider: 'GEMINI_MULTIMODAL_OCR',
          rawText: text,
          pageCountEstimate: Math.max(1, (text.match(/page\s+\d+/gi) || []).length),
        };
      }
    } catch {
      // Fall through to deterministic text extraction fallback if Gemini call fails
    }
  }

  // 2. Deterministic text extraction for structured UTF-8 PDF / text payloads in offline/test mode
  const utf8Text = params.buffer.toString('utf8');
  const printableLines = utf8Text
    .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 3 && !l.startsWith('%PDF') && !l.startsWith('%%EOF'));

  const extracted = printableLines.join('\n').slice(0, 10000);
  return {
    provider: 'DETERMINISTIC_TEXT_OCR',
    rawText:
      extracted ||
      `Binary ${params.mimeType} (${params.buffer.length} bytes) uploaded as ${params.filename}. Enable External AI Consent with a configured Gemini key or enter fields manually.`,
    pageCountEstimate: 1,
  };
}
