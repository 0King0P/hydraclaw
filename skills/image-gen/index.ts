import type { Skill } from '@hydraclaw/skills';

const imageGenSkill: Skill = {
  id: 'image-gen',
  name: 'Image Generation',
  description: 'Generate images using DALL-E, Stable Diffusion, and other AI image models',
  version: '1.0.0',
  author: 'HydraClaw',

  triggers: [
    { type: 'command', pattern: '/imagine', description: 'Generate an image' },
    { type: 'command', pattern: '/image', description: 'Generate an image' },
    { type: 'keyword', pattern: 'generate image,create image,draw,illustration,picture of', description: 'Image generation keywords' },
    { type: 'regex', pattern: '(generate|create|make|draw)\\s+(an?\\s+)?(image|picture|illustration|art)', description: 'Image generation patterns' },
  ],

  tools: [
    {
      name: 'image_generate_dalle',
      description: 'Generate an image using OpenAI DALL-E',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Image description prompt' },
          model: { type: 'string', enum: ['dall-e-2', 'dall-e-3'], description: 'DALL-E model version' },
          size: { type: 'string', enum: ['256x256', '512x512', '1024x1024', '1792x1024', '1024x1792'], description: 'Image dimensions' },
          quality: { type: 'string', enum: ['standard', 'hd'], description: 'Image quality (DALL-E 3 only)' },
          style: { type: 'string', enum: ['vivid', 'natural'], description: 'Image style (DALL-E 3 only)' },
          n: { type: 'number', description: 'Number of images to generate (1-10 for DALL-E 2, 1 for DALL-E 3)' },
        },
        required: ['prompt'],
      },
      async handler(args) {
        const { prompt, model, size, quality, style, n } = args as {
          prompt: string; model?: string; size?: string; quality?: string;
          style?: string; n?: number;
        };

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return 'Error: OPENAI_API_KEY environment variable is not set';

        const selectedModel = model ?? 'dall-e-3';
        const body: Record<string, unknown> = {
          model: selectedModel,
          prompt,
          size: size ?? '1024x1024',
          n: selectedModel === 'dall-e-3' ? 1 : (n ?? 1),
        };

        if (selectedModel === 'dall-e-3') {
          body.quality = quality ?? 'standard';
          body.style = style ?? 'vivid';
        }

        const response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          return `Error generating image: ${response.status} ${await response.text()}`;
        }

        const data = await response.json() as {
          data: { url: string; revised_prompt?: string }[];
        };

        return data.data.map((img, i) => {
          const lines = [`Image ${i + 1}: ${img.url}`];
          if (img.revised_prompt) {
            lines.push(`  Revised prompt: ${img.revised_prompt}`);
          }
          return lines.join('\n');
        }).join('\n\n');
      },
    },
    {
      name: 'image_generate_sd',
      description: 'Generate an image using Stable Diffusion (via Stability AI API)',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Image description prompt' },
          negativePrompt: { type: 'string', description: 'What to avoid in the image' },
          width: { type: 'number', description: 'Image width (multiple of 64, 128-1024)' },
          height: { type: 'number', description: 'Image height (multiple of 64, 128-1024)' },
          steps: { type: 'number', description: 'Diffusion steps (10-50)' },
          cfgScale: { type: 'number', description: 'Prompt adherence strength (1-35)' },
          seed: { type: 'number', description: 'Random seed for reproducibility' },
        },
        required: ['prompt'],
      },
      async handler(args) {
        const { prompt, negativePrompt, width, height, steps, cfgScale, seed } = args as {
          prompt: string; negativePrompt?: string; width?: number; height?: number;
          steps?: number; cfgScale?: number; seed?: number;
        };

        const apiKey = process.env.STABILITY_API_KEY;
        if (!apiKey) return 'Error: STABILITY_API_KEY environment variable is not set';

        const body: Record<string, unknown> = {
          text_prompts: [
            { text: prompt, weight: 1.0 },
            ...(negativePrompt ? [{ text: negativePrompt, weight: -1.0 }] : []),
          ],
          cfg_scale: cfgScale ?? 7,
          width: width ?? 1024,
          height: height ?? 1024,
          steps: steps ?? 30,
          samples: 1,
        };

        if (seed !== undefined) body.seed = seed;

        const response = await fetch(
          'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: JSON.stringify(body),
          }
        );

        if (!response.ok) {
          return `Error generating image: ${response.status} ${await response.text()}`;
        }

        const data = await response.json() as {
          artifacts: { base64: string; seed: number; finishReason: string }[];
        };

        return data.artifacts.map((artifact, i) => {
          return `Image ${i + 1}: [base64 data, ${artifact.base64.length} chars] (seed: ${artifact.seed}, finish: ${artifact.finishReason})`;
        }).join('\n');
      },
    },
    {
      name: 'image_edit',
      description: 'Edit an image using DALL-E (inpainting/variations)',
      parameters: {
        type: 'object',
        properties: {
          imageUrl: { type: 'string', description: 'URL of the source image' },
          prompt: { type: 'string', description: 'Edit instruction' },
          operation: { type: 'string', enum: ['edit', 'variation'], description: 'Operation type' },
        },
        required: ['imageUrl', 'prompt'],
      },
      async handler(args) {
        const { imageUrl, prompt, operation } = args as {
          imageUrl: string; prompt: string; operation?: string;
        };

        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) return 'Error: OPENAI_API_KEY environment variable is not set';

        // Download the image
        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) return `Error fetching source image: ${imageResponse.status}`;

        const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

        if (operation === 'variation') {
          const formData = new FormData();
          formData.append('image', new Blob([imageBuffer]), 'image.png');
          formData.append('n', '1');
          formData.append('size', '1024x1024');

          const response = await fetch('https://api.openai.com/v1/images/variations', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}` },
            body: formData,
          });

          if (!response.ok) return `Error: ${response.status} ${await response.text()}`;

          const data = await response.json() as { data: { url: string }[] };
          return `Variation: ${data.data[0]?.url ?? 'No URL returned'}`;
        }

        // Edit operation requires mask - return guidance
        return `Image edit requested for: ${prompt}\nSource: ${imageUrl} (${imageBuffer.length} bytes)\nNote: Full inpainting requires a mask image. Use the image generation tool for best results.`;
      },
    },
  ],

  systemPromptAddition: 'You can generate images using DALL-E 3, DALL-E 2, and Stable Diffusion XL. Use /imagine or /image to create images from text descriptions.',

  async init(config) {
    const hasOpenAI = !!process.env.OPENAI_API_KEY || !!config.openaiKey;
    const hasStability = !!process.env.STABILITY_API_KEY || !!config.stabilityKey;

    if (!hasOpenAI && !hasStability) {
      console.warn('[image-gen-skill] No image generation API keys found. Set OPENAI_API_KEY and/or STABILITY_API_KEY.');
    }
  },
};

export default imageGenSkill;
