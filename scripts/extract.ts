import 'dotenv/config';
import OpenAI from 'openai';
import { SCHEMA } from '../src/schemas/notification.schema.js';
import { prisma } from '../src/index.js';

const openai = new OpenAI();



export async function extractNotification(rawText: string, sourceId: string) {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      {
        role: 'system',
        content:
          'This is an Indian government job notification with a lot of boilerplate mixed in. ' +
          'Find and extract only the details that determine whether a candidate is eligible for each post. ' +
          'For minEducationLevel, classify the stated requirement into the closest bucket ' +
          '(e.g. "Bachelor\'s Degree" -> BACHELORS); use null if the requirement is too specific ' +
          'or unusual to classify confidently — do not guess. ' +
          'Use null for anything else not explicitly stated in the text — never guess or infer a default.',
      },
      { role: 'user', content: rawText },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
  });

interface ExtractedPost {
  postName: string;
  payLevel: string | null;
  minAge: number | null;
  maxAge: number | null;
  educationRequired: string | null;
  minEducationLevel: 'TENTH' | 'TWELFTH' | 'DIPLOMA' | 'BACHELORS' | 'MASTERS' | 'PHD' | null;
  minMarksPercent: number | null;
}

interface ExtractedNotification {
  jobName: string;
  applyStartDate: string | null;
  applyEndDate: string | null;
  categoryRelaxationApplies: boolean | null;
  categoryRelaxationRules: Record<string, number | null>;
  posts: ExtractedPost[];
}

const jobData: ExtractedNotification = JSON.parse(response.choices[0].message.content!);

// Relaxation rules apply to the whole notification, so they live on Source.
await prisma.source.update({
  where: { id: sourceId },
  data: { categoryRelaxationRules: jobData.categoryRelaxationRules },
});

await prisma.post.createMany({
  data: jobData.posts.map((post: ExtractedPost) => {
    return {
      ...post,
      sourceId: sourceId,
      // categoryRelaxationApplies is notification-level too — carry it onto
      // every row so matching queries can filter on it directly.
      categoryRelaxationApplies: jobData.categoryRelaxationApplies,
    }
  })
})

console.log(`------------JOBS--------------`)
console.log(jobData.jobName, jobData.applyStartDate, jobData.applyEndDate, jobData.categoryRelaxationApplies)
console.log('------------JOBS--------------')

  
  return jobData;
}
