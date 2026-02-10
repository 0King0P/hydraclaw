import Docker from 'dockerode';
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
    name: 'docker_ps',
    description: 'List running Docker containers with their ID, name, image, status, and port mappings.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'docker_images',
    description: 'List Docker images available locally with their repository, tag, ID, and size.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'docker_run',
    description: 'Run a new Docker container from an image. Returns the container ID.',
    parameters: {
      type: 'object',
      properties: {
        image: {
          type: 'string',
          description: 'Docker image to run (e.g. "nginx:latest", "python:3.12")',
        },
        command: {
          type: 'string',
          description: 'Optional command to run inside the container',
        },
        env: {
          type: 'object',
          description: 'Environment variables as key-value pairs (e.g. { "NODE_ENV": "production" })',
        },
        ports: {
          type: 'object',
          description: 'Port mappings as host:container pairs (e.g. { "8080": "80", "3000": "3000" })',
        },
      },
      required: ['image'],
    },
  },
  {
    name: 'docker_stop',
    description: 'Stop a running Docker container.',
    parameters: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name to stop',
        },
      },
      required: ['containerId'],
    },
  },
  {
    name: 'docker_logs',
    description: 'Get stdout/stderr logs from a Docker container.',
    parameters: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name',
        },
        tail: {
          type: 'number',
          description: 'Number of lines from the end of the log to return. Defaults to 100.',
        },
      },
      required: ['containerId'],
    },
  },
  {
    name: 'docker_exec',
    description: 'Execute a command inside a running Docker container and return the output.',
    parameters: {
      type: 'object',
      properties: {
        containerId: {
          type: 'string',
          description: 'Container ID or name',
        },
        command: {
          type: 'string',
          description: 'Command to execute inside the container (e.g. "ls -la /app")',
        },
      },
      required: ['containerId', 'command'],
    },
  },
];

export class DockerTool implements Tool {
  readonly id = 'docker';
  readonly name = 'Docker';
  readonly version = '1.0.0';
  readonly type = 'tool' as const;

  private logger!: Logger;
  private docker!: Docker;

  async init(ctx: PluginContext): Promise<void> {
    this.logger = ctx.logger.child({ plugin: 'docker' });

    const config = ctx.config as Record<string, unknown>;
    const dockerOptions: Docker.DockerOptions = {};

    if (config.socketPath) {
      dockerOptions.socketPath = config.socketPath as string;
    }
    if (config.host) {
      dockerOptions.host = config.host as string;
      dockerOptions.port = (config.port as number) ?? 2376;
    }

    this.docker = new Docker(dockerOptions);
    this.logger.info('Docker tool initialized');
  }

  async destroy(): Promise<void> {
    this.logger.info('Docker tool destroyed');
  }

  definitions(): ToolDefinition[] {
    return DEFINITIONS;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    try {
      switch (call.name) {
        case 'docker_ps':
          return await this.dockerPs(call);
        case 'docker_images':
          return await this.dockerImages(call);
        case 'docker_run':
          return await this.dockerRun(call);
        case 'docker_stop':
          return await this.dockerStop(call);
        case 'docker_logs':
          return await this.dockerLogs(call);
        case 'docker_exec':
          return await this.dockerExec(call);
        default:
          return { toolCallId: call.id, content: `Unknown tool: ${call.name}`, isError: true };
      }
    } catch (err) {
      return {
        toolCallId: call.id,
        content: `Docker error: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  private async dockerPs(call: ToolCall): Promise<ToolResult> {
    this.logger.debug('Listing containers');
    const containers = await this.docker.listContainers({ all: true });

    const result = containers.map((c) => ({
      id: c.Id.substring(0, 12),
      names: c.Names.map((n) => n.replace(/^\//, '')),
      image: c.Image,
      state: c.State,
      status: c.Status,
      ports: c.Ports.map((p) => ({
        ip: p.IP,
        privatePort: p.PrivatePort,
        publicPort: p.PublicPort,
        type: p.Type,
      })),
      created: new Date(c.Created * 1000).toISOString(),
    }));

    return {
      toolCallId: call.id,
      content: JSON.stringify({ containers: result, total: result.length }, null, 2),
    };
  }

  private async dockerImages(call: ToolCall): Promise<ToolResult> {
    this.logger.debug('Listing images');
    const images = await this.docker.listImages();

    const result = images.map((img) => ({
      id: img.Id.replace('sha256:', '').substring(0, 12),
      repoTags: img.RepoTags,
      size: img.Size,
      sizeHuman: `${(img.Size / 1024 / 1024).toFixed(1)} MB`,
      created: new Date(img.Created * 1000).toISOString(),
    }));

    return {
      toolCallId: call.id,
      content: JSON.stringify({ images: result, total: result.length }, null, 2),
    };
  }

  private async dockerRun(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as {
      image: string;
      command?: string;
      env?: Record<string, string>;
      ports?: Record<string, string>;
    };

    this.logger.info(`Running container from image: ${args.image}`);

    const createOptions: Docker.ContainerCreateOptions = {
      Image: args.image,
      Tty: false,
      HostConfig: {},
    };

    // Set command
    if (args.command) {
      createOptions.Cmd = args.command.split(' ');
    }

    // Set environment variables
    if (args.env) {
      createOptions.Env = Object.entries(args.env).map(([k, v]) => `${k}=${v}`);
    }

    // Set port bindings
    if (args.ports) {
      const exposedPorts: Record<string, object> = {};
      const portBindings: Record<string, Array<{ HostPort: string }>> = {};

      for (const [hostPort, containerPort] of Object.entries(args.ports)) {
        const key = `${containerPort}/tcp`;
        exposedPorts[key] = {};
        portBindings[key] = [{ HostPort: hostPort }];
      }

      createOptions.ExposedPorts = exposedPorts;
      createOptions.HostConfig!.PortBindings = portBindings;
    }

    const container = await this.docker.createContainer(createOptions);
    await container.start();

    const inspect = await container.inspect();

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        containerId: inspect.Id.substring(0, 12),
        name: inspect.Name.replace(/^\//, ''),
        image: args.image,
        status: 'running',
      }, null, 2),
    };
  }

  private async dockerStop(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { containerId: string };

    this.logger.info(`Stopping container: ${args.containerId}`);
    const container = this.docker.getContainer(args.containerId);
    await container.stop();

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        containerId: args.containerId,
        status: 'stopped',
      }, null, 2),
    };
  }

  private async dockerLogs(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { containerId: string; tail?: number };
    const tail = args.tail ?? 100;

    this.logger.debug(`Getting logs for: ${args.containerId} (tail: ${tail})`);
    const container = this.docker.getContainer(args.containerId);

    const logStream = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      follow: false,
    });

    // The logs come as a Buffer or string
    const logs = logStream.toString('utf-8');

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        containerId: args.containerId,
        logs,
        tail,
      }, null, 2),
    };
  }

  private async dockerExec(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments as { containerId: string; command: string };

    this.logger.info(`Executing in ${args.containerId}: ${args.command}`);
    const container = this.docker.getContainer(args.containerId);

    const execInstance = await container.exec({
      Cmd: ['sh', '-c', args.command],
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await execInstance.start({ Detach: false, Tty: false });

    // Collect output
    const output = await new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });

    const inspectResult = await execInstance.inspect();

    return {
      toolCallId: call.id,
      content: JSON.stringify({
        containerId: args.containerId,
        command: args.command,
        output,
        exitCode: inspectResult.ExitCode,
      }, null, 2),
      isError: inspectResult.ExitCode !== 0,
    };
  }
}

export default DockerTool;
