import { decide } from '../llm.js';
import * as queue from '../core/queue.js';

export const SOCIAL_TOOL = {
  name: 'submit_posts',
  description: 'Submit the drafted social media posts. You must always answer by calling this tool.',
  input_schema: {
    type: 'object',
    properties: {
      posts: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            platform: { type: 'string', enum: ['facebook', 'instagram'] },
            caption: { type: 'string', description: 'Final caption text including hashtags for Instagram.' },
            image_idea: { type: 'string', description: 'What photo/video Abdul should attach (we cannot generate images).' },
            link: { type: 'string', description: 'Optional website link (Facebook only).' },
          },
          required: ['platform', 'caption', 'image_idea'],
        },
      },
    },
    required: ['posts'],
  },
};

export function socialSystem({ kb, voice }) {
  return `You write social media posts for JTH Tourism (Jet To Holidays Tourism LLC), a UAE inbound tourism company run personally by Abdul Rehman.

Rules:
- Use ONLY facts from BUSINESS KNOWLEDGE. Never invent prices, offers, discounts, awards, reviews or availability. If you want to mention a price it must appear there.
- Genuine, specific and useful. No fake urgency, no clickbait, no made-up testimonials, no claims about competitors.
- Facebook: 2-4 short lines, friendly, one clear call to action (message us on WhatsApp / visit the website).
- Instagram: a strong first line, 3-6 short lines, 8-12 relevant hashtags at the end.
- Each post must be different in angle and wording. Suggest the exact photo/video Abdul should attach in "image_idea".
${voice ? `\n## Brand voice and content pillars\n${voice}\n` : ''}
## BUSINESS KNOWLEDGE
${kb || '(empty - keep to general, non-specific content)'}
`;
}

/** Drafts posts and puts them in the approval queue. Nothing is published here. */
export async function draftPosts({ llm, kb, voice, topic, platforms = ['facebook', 'instagram'], count = 2, scheduled_at = null }) {
  const r = await decide(llm, {
    system: socialSystem({ kb, voice }),
    user: `Write ${count} post(s) for each of these platforms: ${platforms.join(', ')}.\nTopic / goal: ${topic}\nCall submit_posts.`,
    tool: SOCIAL_TOOL,
  });
  if (!r.input) throw new Error(`Could not draft posts: ${r.error || 'model declined'}`);
  return (r.input.posts || []).filter((p) => platforms.includes(p.platform) && p.caption?.trim()).map((p) => queue.add({
    type: 'social_post',
    title: `${p.platform}: ${p.caption.split('\n')[0].slice(0, 60)}`,
    preview: p.caption,
    payload: { platform: p.platform, caption: p.caption.trim(), link: p.link || '', image_idea: p.image_idea, image_url: '' },
    scheduled_at,
  }));
}
