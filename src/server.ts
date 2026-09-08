import 'dotenv/config';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openai } from './lib/ai.js';
import { PDFParse } from 'pdf-parse';
import { prisma } from './db.js';
import { getMatchesForUser, ageOn, getEffectiveMaxAge } from '../scripts/match.js';
import { EducationLevel } from '../generated/prisma/index.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const DOWNLOAD_DIR = path.resolve(__dirname, '../downloads');

let cachedPdfText: string | null = null;

async function getCachedPdfText(): Promise<string> {
  if (cachedPdfText) return cachedPdfText;
  const pdfPath = path.join(DOWNLOAD_DIR, 'ssc-cgl-2026.pdf');
  const pdfBuffer = await fs.readFile(pdfPath);
  const parser = new PDFParse({ data: pdfBuffer });
  const result = await parser.getText();
  cachedPdfText = result.text;
  return cachedPdfText;
}

function sliceRelevantText(fullText: string, postName: string): string {
  const lowerText = fullText.toLowerCase();
  const lowerName = postName.toLowerCase();
  const index = lowerText.indexOf(lowerName);

  if (index !== -1) {
    const start = Math.max(0, index - 300);
    const end = Math.min(fullText.length, index + 2700);
    return fullText.slice(start, end);
  }

  const qualIndex = lowerText.indexOf('essential educational qualifications');
  if (qualIndex !== -1) {
    return fullText.slice(qualIndex, qualIndex + 3000);
  }

  return fullText.slice(0, 3000);
}

const VALID_LEVELS = new Set<string>([
  'TENTH',
  'TWELFTH',
  'DIPLOMA',
  'BACHELORS',
  'MASTERS',
  'PHD',
]);

interface MatchRequestBody {
  userId?: string;
  name?: string;
  dob?: string;
  category?: string | null;
  educations?: Array<{
    level: EducationLevel;
    marksPercent?: number | string | null;
  }>;
}

function sendJson(
  res: http.ServerResponse,
  statusCode: number,
  data: unknown,
): void {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1e6) {
        req.destroy();
        reject(new Error('Request payload too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host || 'localhost'}`);

  // Route 1: GET / (and HEAD /) -> serve static public/index.html
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname === '/') {
    try {
      const filePath = path.join(PUBLIC_DIR, 'index.html');
      const html = await fs.readFile(filePath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      sendJson(res, 500, { error: 'Failed to read public/index.html' });
    }
    return;
  }

  // Route 2: POST /api/match
  if (req.method === 'POST' && url.pathname === '/api/match') {
    try {
      const rawBody = await readBody(req);
      const body: MatchRequestBody = JSON.parse(rawBody || '{}');

      if (!body.dob || Number.isNaN(Date.parse(body.dob))) {
        sendJson(res, 400, { error: 'A valid Date of Birth (dob) is required' });
        return;
      }

      if (!Array.isArray(body.educations) || body.educations.length === 0) {
        sendJson(res, 400, {
          error: 'At least one education entry is required',
        });
        return;
      }

      // Deduplicate by education level to satisfy @@unique([userId, level])
      const eduMap = new Map<EducationLevel, number | null>();
      for (const edu of body.educations) {
        if (!VALID_LEVELS.has(edu.level)) {
          sendJson(res, 400, { error: `Invalid education level: ${edu.level}` });
          return;
        }
        const marks =
          edu.marksPercent != null && edu.marksPercent !== ''
            ? Number(edu.marksPercent)
            : null;
        eduMap.set(edu.level, Number.isFinite(marks) ? marks : null);
      }

      // Update existing user or create a new user with nested education records
      const existingUser = body.userId
        ? await prisma.user.findUnique({
            where: { id: body.userId },
          })
        : null;

      let user;
      if (existingUser) {
        await prisma.$transaction([
          prisma.user.update({
            where: { id: existingUser.id },
            data: {
              name: body.name?.trim() || null,
              dob: new Date(body.dob),
              category: body.category || 'UNSPECIFIED',
            },
          }),
          prisma.education.deleteMany({
            where: { userId: existingUser.id },
          }),
          prisma.education.createMany({
            data: Array.from(eduMap.entries()).map(([level, marksPercent]) => ({
              userId: existingUser.id,
              level,
              marksPercent,
            })),
          }),
        ]);

        user = await prisma.user.findUniqueOrThrow({
          where: { id: existingUser.id },
          include: { educations: true },
        });
      } else {
        user = await prisma.user.create({
          data: {
            name: body.name?.trim() || null,
            dob: new Date(body.dob),
            category: body.category || 'UNSPECIFIED',
            educations: {
              create: Array.from(eduMap.entries()).map(([level, marksPercent]) => ({
                level,
                marksPercent,
              })),
            },
          },
          include: { educations: true },
        });
      }

      // Run existing matching logic from scripts/match.ts
      const matchedPosts = await getMatchesForUser(user.id);

      // Query checked sources
      const sources = await prisma.source.findMany({
        select: { name: true },
      });
      const sourcesChecked = sources.map((s) => s.name);

      const userAge = ageOn(user.dob);
      const marksByLevel = new Map(
        user.educations.map((e) => [e.level, e.marksPercent]),
      );

      const matches = [];
      const needsManualCheck = [];

      for (const post of matchedPosts) {
        const { effectiveMaxAge, relaxation } = getEffectiveMaxAge(
          post,
          user.category,
        );

        const userMarksAtLevel = post.minEducationLevel
          ? marksByLevel.get(post.minEducationLevel)
          : undefined;
        const marksMissing =
          post.minMarksPercent !== null && userMarksAtLevel == null;

        // A post requires manual verification if any matching parameter was null
        const isNullFieldPost =
          post.minAge === null ||
          post.maxAge === null ||
          post.minEducationLevel === null ||
          marksMissing;

        if (isNullFieldPost) {
          const reasons: string[] = [];
          if (post.minEducationLevel === null) {
            reasons.push('Education qualification requires manual verification');
          }
          if (post.minAge === null) {
            reasons.push('Minimum age limit not specified in notification');
          }
          if (post.maxAge === null) {
            reasons.push('Maximum age limit not specified in notification');
          }
          if (marksMissing) {
            reasons.push(
              `Notification requires min ${post.minMarksPercent}% marks (not provided)`,
            );
          }

          needsManualCheck.push({
            id: post.id,
            postName: post.postName,
            sourceName: post.source.name,
            sourceUrl: post.source.url,
            payLevel: post.payLevel,
            educationRequired: post.educationRequired,
            reason: reasons.join('; '),
          });
        } else {
          matches.push({
            id: post.id,
            postName: post.postName,
            sourceName: post.source.name,
            sourceUrl: post.source.url,
            payLevel: post.payLevel,
            userAge,
            minAge: post.minAge,
            maxAge: post.maxAge,
            effectiveMaxAge,
            ageComparison: `Age ${userAge} (Allowed: ${post.minAge}–${effectiveMaxAge})`,
            categoryRelaxationApplied:
              relaxation > 0 ? `+${relaxation} yrs (${user.category})` : null,
          });
        }
      }

      sendJson(res, 200, {
        userId: user.id,
        matches,
        needsManualCheck,
        sourcesChecked,
      });
    } catch (err) {
      console.error('[Error] POST /api/match failed:', err);
      sendJson(res, 500, { error: 'Internal Server Error' });
    }
    return;
  }

  // Route 3: POST /api/explain
  if (req.method === 'POST' && url.pathname === '/api/explain') {
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
      const textSlice = sliceRelevantText(fullText, post.postName);

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
    return;
  }

  sendJson(res, 404, { error: 'Not Found' });
});

const DEFAULT_PORT = Number(process.env.PORT) || 3000;

if (import.meta.url === `file://${process.argv[1]}`) {
  function listen(port: number) {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening);
      if (err.code === 'EADDRINUSE' && !process.env.PORT) {
        listen(port + 1);
      } else {
        console.error(`Failed to start server on port ${port}:`, err.message);
        process.exit(1);
      }
    };

    const onListening = () => {
      server.removeListener('error', onError);
      console.log(`Server listening on http://localhost:${port}`);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  }

  listen(DEFAULT_PORT);
}

