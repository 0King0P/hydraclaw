import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import OpenAI from 'openai';
import type {
  Tool,
  ToolDefinition,
  ToolCall,
  ToolResult,
  PluginContext,
  Logger,
} from '@hydraclaw/core';

const DEFINITIONS: ToolDefinition[] = [
  {
    name: 'image_generate',
    description: 'Generate an image from a text description using DALL-E or a configured image generation provider. Returns the image as base64 or saves to a file.',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Text description of the image to generate',
        },
        size: {
          type: 'string',
          description: 'Image size. Options: "1024x1024", "1792x1024", "1024x1792". Defaults to "1024x1024".',
        },
        model: {
          type: 'string',
          description: 'Model to use. Defaults to config value or "dall-e-3".',
        },
        savePath: {
          type: 'string',
          description: 'Optional file path to save the image. If not provided, returns base64 data.',
        },
        quality: {
          type: 'string',
          description: 'Image quality: "standard" or "hd". Defaults to "standard".',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'image_edit',
    description: 'Edit an existing image based on a text prompt. The image is sent to the API along with instructions for modification.',
    parameters: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: 'Path to the source image file (PNG format)',
        },
        prompt: {
          type: 'string',
          description: 'Instructions for how to edit the image',
        },
        savePath: {
          type: 'string',
          description: 'Optional file path to save the edited image. If not provided, returns base64 data.',
        },
      },
      required: ['imagePath', 'prompt'],
    },
  },
  {
    name: 'image_variations',
    description: 'Generate variations of an existing image. The API creates similar but distinct versions of the source image.',
    parameters: {
      type: 'object',
      properties: {
        imagePath: {
          type: 'string',
          description: 'Path to the source image file (PNG format)',
        },
        n: {
          type: 'number',
          description: 'Number of variations to generate (1-10). Defaults to 1.',
        },
        savePath: {
          type: 'string',
          description: 'Optional directory path to save variation images. Files will be named variation_1.png, variation_2.png, etc.',
        },
      },
      required: ['imagePath'],
    },
  },
];

export class ImageGenTool implements Tool {
  readonly id = 'imagegen';
  readonly name = 'Image Generator';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;
  private client!: OpenAI;
  private defaultModel = 'dall-e-3';

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'imagegen' });

    const config = ctx.config as Record<string, unknown>;
    const apiKey = (config.apiKey as string) ?? process.env.OPENAI_API_KEY ?? '';
    const baseURL = config.baseUrl as string | undefined;

    if (config.model) {
      this.defaultModel = config.model as string;
    }

    this.client = new OpenAI({
      apiKey,
      baseURL,
    });

    this.logger.info(`Image Generator tool initialized (model: ${this.defaultModel})`);
  }

  async destroy(): Promise<void> {
    this.logger.info('Image Generator tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'image_generate':
          return await this.imageGenerate(call);
        case 'image_edit':
          return await this.imageEdit(call);
        case 'image_variations':
          return await this.imageVariations(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Image generation error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private async saveBase64Image(base64Data: string, filePath: string): Promise<void> {
    const absPath = resolve(filePath);
    await mkdir(dirname(absPath), { recursive: true });
    const buffer = Buffer.from(base64Data, 'base64');
    await writeFile(absPath, buffer);
  }

  private async imageGenerate(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as {
      prompt: string;
      size?: string;
      model?: string;
      savePath?: string;
      quality?: string;
    };

    const model = args.model ?? this.defaultModel;
    const size = (args.size ?? '1024x1024') as '1024x1024' | '1792x1024' | '1024x1792';
    const quality = (args.quality ?? 'standard') as 'standard' | 'hd';

    this.logger.info(`Generating image: "${args.prompt.substring(0, 80)}..." (model: ${model}, size: ${size})`);

    const response = await this.client.images.generate({
      model,
      prompt: args.prompt,
      n: 1,
      size,
      quality,
      response_format: 'b64_json',
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('No image data returned from API');
    }
    const imageData = response.data[0];
    const base64 = imageData.b64_json!;
    const revisedPrompt = imageData.revised_prompt;

    if (args.savePath) {
      await this.saveBase64Image(base64, args.savePath);
      return {
        toolCallId: call.id,
        content: JSON.stringify({
          savedTo: resolve(args.savePath),
          model,
          size,
          quality,
          revisedPrompt: revisedPrompt ?? null,
        }, null, 2),
      };
    }

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        base64: base64.substring(0, 200) + '...[truncated]',
        base64Length: base64.length,
        model,
        size,
        quality,
        revisedPrompt: revisedPrompt ?? null,
      }, null, 2),
    };
  }

  private async imageEdit(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as {
      imagePath: string;
      prompt: string;
      savePath?: string;
    };

    const absImagePath = resolve(args.imagePath);
    this.logger.info(`Editing image: ${absImagePath}`);

    const imageBuffer = await readFile(absImagePath);
    const imageFile = new File([imageBuffer], 'image.png', { type: 'image/png' });

    const response = await this.client.images.edit({
      image: imageFile,
      prompt: args.prompt,
      n: 1,
      size: '1024x1024',
      response_format: 'b64_json',
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('No image data returned from edit API');
    }
    const base64 = response.data[0].b64_json!;

    if (args.savePath) {
      await this.saveBase64Image(base64, args.savePath);
      return {
        toolCallId: call.id,
        content: JSON.stringify({
          savedTo: resolve(args.savePath),
          sourceImage: absImagePath,
          prompt: args.prompt,
        }, null, 2),
      };
    }

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        base64: base64.substring(0, 200) + '...[truncated]',
        base64Length: base64.length,
        sourceImage: absImagePath,
        prompt: args.prompt,
      }, null, 2),
    };
  }

  private async imageVariations(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as {
      imagePath: string;
      n?: number;
      savePath?: string;
    };

    const absImagePath = resolve(args.imagePath);
    const n = Math.min(Math.max(args.n ?? 1, 1), 10);

    this.logger.info(`Generating ${n} variation(s) of: ${absImagePath}`);

    const imageBuffer = await readFile(absImagePath);
    const imageFile = new File([imageBuffer], 'image.png', { type: 'image/png' });

    const response = await this.client.images.createVariation({
      image: imageFile,
      n,
      size: '1024x1024',
      response_format: 'b64_json',
    });

    if (!response.data || response.data.length === 0) {
      throw new Error('No variation data returned from API');
    }
    const variations = response.data;

    if (args.savePath) {
      const saveDir = resolve(args.savePath);
      await mkdir(saveDir, { recursive: true });

      const savedFiles: string[] = [];
      for (let i = 0; i < variations.length; i++) {
        const filePath = `${saveDir}/variation_${i + 1}.png`;
        await this.saveBase64Image(variations[i].b64_json!, filePath);
        savedFiles.push(filePath);
      }

      return {
        toolCallId: call.id,
        content: JSON.stringify({
          savedTo: savedFiles,
          sourceImage: absImagePath,
          count: variations.length,
        }, null, 2),
      };
    }

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        variations: variations.map((v, i) => ({
          index: i + 1,
          base64: v.b64_json!.substring(0, 100) + '...[truncated]',
          base64Length: v.b64_json!.length,
        })),
        sourceImage: absImagePath,
        count: variations.length,
      }, null, 2),
    };
  }
}

export default ImageGenTool;
