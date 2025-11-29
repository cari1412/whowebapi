import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AssemblyAI } from 'assemblyai';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { audioFileUrl } = req.body;

    if (!audioFileUrl) {
      return res.status(400).json({ error: 'Missing audioFileUrl' });
    }

    const client = new AssemblyAI({
      apiKey: process.env.ASSEMBLYAI_API_KEY!,
    });

    const transcript = await client.transcripts.transcribe({
      audio: audioFileUrl,
    });

    if (!transcript.words) {
      return res.status(500).json({ error: 'No captions generated' });
    }

    const captions = transcript.words.map((word) => ({
      text: word.text,
      start: word.start,
      end: word.end,
      confidence: word.confidence,
    }));

    return res.status(200).json({ captions });
  } catch (error) {
    console.error('Caption generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
}