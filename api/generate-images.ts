import type { VercelRequest, VercelResponse } from '@vercel/node';
import { GoogleGenAI } from '@google/genai';

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
    const { prompts } = req.body;

    if (!prompts || !Array.isArray(prompts)) {
      return res.status(400).json({ error: 'Missing or invalid prompts array' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const ai = new GoogleGenAI({
      apiKey: apiKey,
    });

    const images: string[] = [];

    for (const prompt of prompts) {
      try {
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash-image',
          contents: prompt,
        });

        if (response && response.candidates && response.candidates.length > 0) {
          const candidate = response.candidates[0];
          
          if (candidate && candidate.content && candidate.content.parts) {
            const parts = candidate.content.parts;
            const imagePart = parts.find(part => part.inlineData);

            if (imagePart && imagePart.inlineData && imagePart.inlineData.data) {
              images.push(imagePart.inlineData.data);
            } else {
              console.error(`No image generated for: ${prompt}`);
              images.push('');
            }
          } else {
            console.error(`Invalid response structure for: ${prompt}`);
            images.push('');
          }
        } else {
          console.error(`No candidates for: ${prompt}`);
          images.push('');
        }
      } catch (error) {
        console.error(`Error generating image for prompt: ${prompt}`, error);
        images.push('');
      }
    }

    return res.status(200).json({ 
      images,
      contentType: 'image/png'
    });
  } catch (error) {
    console.error('Images generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: errorMessage });
  }
}