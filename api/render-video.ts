import type { VercelRequest, VercelResponse } from '@vercel/node';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { writeFile, readFile, unlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';

// Установить путь к FFmpeg
ffmpeg.setFfmpegPath(ffmpegPath.path);

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

  const sessionId = uuidv4();
  const tempDir = join(os.tmpdir(), `video-${sessionId}`);

  try {
    const { audioUrl, images, duration } = req.body;

    if (!audioUrl || !images || !Array.isArray(images) || !duration) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    console.log(`[${sessionId}] Starting render: ${images.length} images, ${duration}s duration`);

    // Создать временную директорию
    if (!existsSync(tempDir)) {
      await mkdir(tempDir, { recursive: true });
    }

    // Скачать аудио
    console.log(`[${sessionId}] Downloading audio...`);
    const audioPath = join(tempDir, 'audio.mp3');
    const audioResponse = await fetch(audioUrl);
    if (!audioResponse.ok) {
      throw new Error(`Failed to download audio: ${audioResponse.status}`);
    }
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
    await writeFile(audioPath, audioBuffer);

    // Скачать изображения
    console.log(`[${sessionId}] Downloading ${images.length} images...`);
    const imagePaths: string[] = [];
    
    for (let i = 0; i < images.length; i++) {
      const imagePath = join(tempDir, `image_${String(i).padStart(3, '0')}.png`);
      const imageResponse = await fetch(images[i]);
      
      if (!imageResponse.ok) {
        console.error(`Failed to download image ${i}: ${imageResponse.status}`);
        continue;
      }
      
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      await writeFile(imagePath, imageBuffer);
      imagePaths.push(imagePath);
    }

    if (imagePaths.length === 0) {
      throw new Error('No images were downloaded successfully');
    }

    console.log(`[${sessionId}] Downloaded ${imagePaths.length} images successfully`);

    // Создать concat файл для FFmpeg
    const filelistPath = join(tempDir, 'filelist.txt');
    const imageDuration = duration / imagePaths.length;
    let filelistContent = '';
    
    for (let i = 0; i < imagePaths.length; i++) {
      // Использовать абсолютные пути с правильными слешами
      const normalizedPath = imagePaths[i].replace(/\\/g, '/');
      filelistContent += `file '${normalizedPath}'\n`;
      filelistContent += `duration ${imageDuration.toFixed(2)}\n`;
    }
    // Добавить последнее изображение еще раз
    const lastImagePath = imagePaths[imagePaths.length - 1].replace(/\\/g, '/');
    filelistContent += `file '${lastImagePath}'\n`;
    
    await writeFile(filelistPath, filelistContent);
    console.log(`[${sessionId}] Created concat file`);

    // Путь к выходному файлу
    const outputPath = join(tempDir, 'output.mp4');

    // Рендерить видео через FFmpeg
    console.log(`[${sessionId}] Starting FFmpeg render...`);
    
    await new Promise<void>((resolve, reject) => {
      ffmpeg()
        .input(filelistPath)
        .inputOptions(['-f', 'concat', '-safe', '0'])
        .input(audioPath)
        .outputOptions([
          '-c:v', 'libx264',
          '-tune', 'stillimage',
          '-c:a', 'aac',
          '-b:a', '192k',
          '-pix_fmt', 'yuv420p',
          '-shortest',
          '-movflags', '+faststart', // Для лучшей совместимости
        ])
        .output(outputPath)
        .on('start', (commandLine) => {
          console.log(`[${sessionId}] FFmpeg command: ${commandLine}`);
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`[${sessionId}] Processing: ${progress.percent.toFixed(1)}% done`);
          }
        })
        .on('end', () => {
          console.log(`[${sessionId}] FFmpeg render completed`);
          resolve();
        })
        .on('error', (err) => {
          console.error(`[${sessionId}] FFmpeg error:`, err);
          reject(err);
        })
        .run();
    });

    // Прочитать результат
    console.log(`[${sessionId}] Reading output file...`);
    const videoBuffer = await readFile(outputPath);
    const videoBase64 = videoBuffer.toString('base64');

    console.log(`[${sessionId}] Video size: ${(videoBuffer.length / 1024 / 1024).toFixed(2)} MB`);

    // Очистить временные файлы
    console.log(`[${sessionId}] Cleaning up...`);
    try {
      await unlink(audioPath);
      await unlink(filelistPath);
      await unlink(outputPath);
      for (const path of imagePaths) {
        await unlink(path);
      }
    } catch (cleanupError) {
      console.error(`[${sessionId}] Cleanup error:`, cleanupError);
    }

    console.log(`[${sessionId}] Render complete!`);

    return res.status(200).json({
      video: videoBase64,
      contentType: 'video/mp4',
      size: videoBuffer.length,
    });

  } catch (error) {
    console.error(`[${sessionId}] Render error:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    // Попытаться очистить временные файлы даже при ошибке
    try {
      if (existsSync(tempDir)) {
        const files = await readFile(tempDir).catch(() => []);
        // Очистка...
      }
    } catch {}

    return res.status(500).json({ error: errorMessage });
  }
}

export const config = {
  maxDuration: 300, // 5 минут (требует Pro план для > 10 секунд)
};