import 'dotenv/config';
import OpenAI from 'openai';
import { SCHEMA } from '../src/schemas/notification.schema.js';
import { prisma } from '../src/db.js';

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
          'For postGroup, use the post\'s stated classification (e.g. "Group \'B\' Gazetted" -> B). ' +
          'For categoryRelaxationApplies and categoryRelaxationRules: find the notification\'s general ' +
          'age relaxation section (it usually lists years granted per category like SC/ST/OBC/EWS/PwBD) ' +
          'and apply those same values to every post as the default — do not leave them null just because ' +
          'a specific post\'s own paragraph does not restate the table. Only deviate from that default for ' +
          'a post if the text explicitly grants it different or additional relaxation than the general rule. ' +
          'Use null for anything else not explicitly stated in the text — never guess or infer a default.',
      },
      { role: 'user', content: rawText },
    ],
    response_format: { type: 'json_schema', json_schema: SCHEMA },
  });

interface ExtractedPost {
  postName: string;
  postGroup: 'A' | 'B' | 'C' | 'D' | null;
  payLevel: string | null;
  minAge: number | null;
  maxAge: number | null;
  educationRequired: string | null;
  minEducationLevel: 'TENTH' | 'TWELFTH' | 'DIPLOMA' | 'BACHELORS' | 'MASTERS' | 'PHD' | null;
  minMarksPercent: number | null;
  categoryRelaxationApplies: boolean | null;
  categoryRelaxationRules: Record<string, number | null>;
}

interface ExtractedNotification {
  jobName: string;
  applyStartDate: string | null;
  applyEndDate: string | null;
  posts: ExtractedPost[];
}

const jobData: ExtractedNotification = JSON.parse(response.choices[0].message.content!);

await prisma.post.createMany({
  data: jobData.posts.map((post: ExtractedPost) => {
    return {
      ...post,
      sourceId: sourceId,
    }
  })
})

console.log(`------------JOBS--------------`)
console.log(jobData.jobName, jobData.applyStartDate, jobData.applyEndDate)
console.log('------------JOBS--------------')

  
  return jobData;
}
