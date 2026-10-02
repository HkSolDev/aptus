import type http from 'node:http';
import { prisma } from '../db.js';
import { readBody, sendJson } from '../lib/http.js';
import fs from 'node:fs/promises';
import { openai } from '../lib/ai.js';
import { extractTextWindow } from '../lib/text-window.js';
import { ageOn } from '../../scripts/match.js';
import { PDFParse } from 'pdf-parse';

let cachedPdfText: string | null = null;

async function getCachedPdfText(): Promise<string> {
  if (cachedPdfText) return cachedPdfText;
  const pdfPath = new URL('../../downloads/ssc-cgl-2026.pdf', import.meta.url);
  const pdfBuffer = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  cachedPdfText = result.text;
  return cachedPdfText;
}

export async function handleExplain(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  try {
    const rawBody = await readBody(req);
    const body = JSON.parse(rawBody || '{}');

    if (!body.postId || typeof body.postId !== 'string') {
      sendJson(res, 400, { error: 'postId is required' });
      return;
    }

    const post = await prisma.post.findUnique({
      where: { id: body.postId },
      include: { source: true },
    });

    if (!post) {
      sendJson(res, 404, { error: 'Post not found' });
      return;
    }

    // userId is optional — without it, the explanation just covers the
    // post generically instead of relative to a specific candidate.
    const user =
      body.userId && typeof body.userId === 'string'
        ? await prisma.user.findUnique({
            where: { id: body.userId },
            include: { educations: true },
          })
        : null;

    const fullText = await getCachedPdfText();
    const textSlice = extractTextWindow(fullText, post.postName, {
      charsBefore: 300,
      charsAfter: 2700,
      fallbacks: ['essential educational qualifications'],
      fallbackToStart: true,
    });

    const candidateSection = user
      ? `Candidate Details:
- Age: ${ageOn(user.dob)}
- Category: ${user.category}
- Education history: ${user.educations
          .map(
            (e) =>
              `${e.level}${e.marksPercent != null ? ` (${e.marksPercent}%)` : ''}`,
          )
          .join(', ')}

`
      : '';

    const userContent = `${candidateSection}Post Details:
- Name: ${post.postName}
- Minimum Age: ${post.minAge ?? 'Not specified'}
- Maximum Age: ${post.maxAge ?? 'Not specified'}
- Minimum Education Level: ${post.minEducationLevel ?? 'Not specified'}
- Minimum Marks Percent: ${post.minMarksPercent != null ? `${post.minMarksPercent}%` : 'Not specified'}
- Education Required: ${post.educationRequired ?? 'Not specified'}
- Pay Level: ${post.payLevel ?? 'Not specified'}

Notification Excerpt:
${textSlice}`;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: user
            ? "You are explaining a specific government job posting's requirements to a named candidate, using their own details, in plain simple language. Do not state a final yes/no eligibility verdict — that's already decided elsewhere by exact rules. Instead, point out specifically which of the post's requirements are unclear or unstated for THIS candidate (e.g. their marks weren't checked against a requirement, or a field was missing), and explain what they should manually verify against the notification excerpt. Keep it a few short sentences."
            : "You are explaining a specific government job posting's requirements to a candidate in plain, simple language. Use only the notification text and the structured fields given. Do not state whether the candidate is or isn't eligible — that's already decided elsewhere. Just clarify what the post requires (education, age, pay, application process) in a few short sentences.",
        },
        {
          role: 'user',
          content: userContent,
        },
      ],
    });

    const explanation =
      response.choices[0]?.message?.content?.trim() ||
      'No explanation generated.';

    sendJson(res, 200, { explanation });
  } catch (err) {
    console.error('[Error] POST /api/explain failed:', err);
    sendJson(res, 500, { error: 'Failed to generate explanation' });
  }
}
